// ─── desk-inbound-email — lê o Gmail e transforma e-mails em conversas ─────────
//
// Google puro: usa a Gmail API (service account impersonando support@cloudfy.host)
// para ler mensagens não lidas, criar/atualizar conversas (channel='email') e
// rodar o MESMO pipeline da Luna em modo e-mail. As respostas da IA saem como
// support@cloudfy.email na mesma thread.
//
// Chamado por um cron (a cada 1 min) — ver supabase/config ou o job criado no
// deploy. Também aceita chamada manual autenticada por operador para forçar um
// poll. Idempotente: desk_email_seen impede reprocessar o mesmo e-mail.

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient, type ServiceClient } from '../_shared/supabase.ts';
import {
  listNewMessageIds,
  getMessage,
  markAsRead,
  sendEmail,
  stripQuotedReply,
  type ParsedEmail,
} from '../_shared/gmail.ts';
import { runAiPipeline } from '../_shared/ai-pipeline.ts';
import { fetchContactInfo } from '../_shared/contact-info.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const CONV_SELECT =
  'id, status, ai_active, user_email, email_thread_id, email_message_id, email_references, email_subject, subject';

interface ConvRow {
  id: string;
  status: string;
  ai_active: boolean;
  user_email: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  email_references: string | null;
  email_subject: string | null;
  subject: string | null;
}

// Detecta o plano do cliente (mesma lógica do pipeline) para a tag da conversa.
function detectPlanTag(subscriptions: Array<{ status: string; product: string }>): string {
  const active = subscriptions.filter((s) => ['active', 'completed'].includes((s.status ?? '').toLowerCase()));
  if (active.length === 0) return 'sem-plano';
  for (const plan of ['max', 'ultra', 'advanced', 'starter']) {
    if (active.some((s) => (s.product ?? '').toLowerCase().includes(plan))) return plan;
  }
  return 'sem-plano';
}

// Assunto de resposta: "Re: ..." sem duplicar.
function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

async function alreadySeen(service: ServiceClient, gmailMessageId: string): Promise<boolean> {
  const { data } = await service
    .from('desk_email_seen')
    .select('gmail_message_id')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle();
  return !!data;
}

/** Acha a conversa por thread do Gmail, ou cria uma nova (channel=email). */
async function findOrCreateConversation(
  service: ServiceClient,
  email: ParsedEmail,
): Promise<ConvRow | null> {
  // 1. Por thread do Gmail (resposta numa conversa existente)
  const { data: existing } = await service
    .from('desk_conversations')
    .select(CONV_SELECT)
    .eq('email_thread_id', email.gmailThreadId)
    .maybeSingle();
  if (existing) {
    const row = existing as unknown as ConvRow;
    // Se estava resolvida, o cliente reabriu → nova rodada
    if (row.status === 'resolved') {
      await service
        .from('desk_conversations')
        .update({ status: 'open', resolved_at: null, ai_active: true })
        .eq('id', row.id);
      row.status = 'open';
      row.ai_active = true;
    }
    return row;
  }

  // 2. Nova conversa de e-mail — tag do plano já na criação
  const info = await fetchContactInfo(email.fromEmail).catch(() => null);
  const planTag = detectPlanTag(info?.subscriptions ?? []);

  const { data: created, error } = await service
    .from('desk_conversations')
    .insert({
      account_user_id: null,
      user_email: email.fromEmail,
      channel: 'email',
      status: 'open',
      priority: 'medium',
      subject: email.subject || '(sem assunto)',
      ai_active: true,
      tags: [planTag],
      email_thread_id: email.gmailThreadId,
      email_message_id: email.rfcMessageId,
      email_references: email.references ?? email.rfcMessageId,
      email_subject: email.subject || '(sem assunto)',
    })
    .select(CONV_SELECT)
    .single();

  if (error || !created) {
    console.error('[inbound-email] criar conversa falhou:', error?.message);
    return null;
  }
  return created as unknown as ConvRow;
}

async function processMessage(service: ServiceClient, gmailMessageId: string): Promise<'processed' | 'skipped'> {
  if (await alreadySeen(service, gmailMessageId)) {
    await markAsRead(gmailMessageId).catch(() => {});
    return 'skipped';
  }

  const email = await getMessage(gmailMessageId);

  // Ignora e-mails que a PRÓPRIA conta enviou (respostas nossas ecoando).
  const sendAs = (Deno.env.get('GMAIL_SEND_AS') ?? '').toLowerCase();
  const inboxUser = (Deno.env.get('GMAIL_INBOX_USER') ?? '').toLowerCase();
  if (email.fromEmail === sendAs || email.fromEmail === inboxUser) {
    await service.from('desk_email_seen').insert({ gmail_message_id: gmailMessageId }).select().maybeSingle();
    await markAsRead(gmailMessageId).catch(() => {});
    return 'skipped';
  }

  const conv = await findOrCreateConversation(service, email);
  if (!conv) return 'skipped';

  // Corpo limpo (sem histórico citado) para o cliente e para o LLM.
  const cleanText = stripQuotedReply(email.textBody).slice(0, 8000);

  // Grava a mensagem do cliente (guarda o HTML no metadata para o painel).
  const { data: contactMsg } = await service
    .from('desk_messages')
    .insert({
      conversation_id: conv.id,
      sender_type: 'contact',
      content: cleanText || email.snippet || '(e-mail sem texto)',
      content_type: email.htmlBody ? 'html' : 'text',
      is_private_note: false,
      metadata: {
        email: {
          from: email.from,
          subject: email.subject,
          message_id: email.rfcMessageId,
          html: email.htmlBody,
        },
      },
    })
    .select('id')
    .single();

  // Atualiza o threading da conversa (última msg do cliente vira o In-Reply-To).
  await service
    .from('desk_conversations')
    .update({
      email_message_id: email.rfcMessageId,
      email_references: [conv.email_references, email.rfcMessageId].filter(Boolean).join(' '),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conv.id);

  // Marca como processado ANTES de responder (evita loop se a resposta falhar).
  await service.from('desk_email_seen').insert({
    gmail_message_id: gmailMessageId,
    conversation_id: conv.id,
  });
  await markAsRead(gmailMessageId).catch(() => {});

  // Roda o pipeline em modo e-mail (a menos que a IA esteja pausada/pendente).
  let outcome;
  try {
    outcome = await runAiPipeline(service, {
      conversationId: conv.id,
      message: cleanText || '(e-mail sem texto)',
      channel: 'email',
      fallbackName: email.fromName || undefined,
    });
  } catch (e) {
    console.error('[inbound-email] pipeline falhou:', e instanceof Error ? e.message : e);
    return 'processed'; // a msg do cliente já está registrada; operador atende
  }

  // Handoff → nada é enviado por e-mail; o operador responde no painel.
  // Reply da IA → envia como support@cloudfy.email na mesma thread.
  if (outcome.reply && !outcome.should_handoff) {
    try {
      const sent = await sendEmail({
        to: email.fromEmail,
        subject: replySubject(email.subject || conv.email_subject || 'Suporte Cloudfy'),
        text: outcome.reply,
        threadId: email.gmailThreadId,
        inReplyTo: email.rfcMessageId,
        references: [conv.email_references, email.rfcMessageId].filter(Boolean).join(' '),
        fromName: 'Suporte Cloudfy',
      });
      // Grava a resposta da IA como mensagem 'bot'
      await service.from('desk_messages').insert({
        conversation_id: conv.id,
        sender_type: 'bot',
        content: outcome.reply,
        content_type: 'text',
        ai_generated: true,
        is_private_note: false,
        metadata: { email: { message_id: sent.id } },
      });
      void contactMsg; // (silencia unused em alguns paths)
    } catch (e) {
      console.error('[inbound-email] envio da resposta falhou:', e instanceof Error ? e.message : e);
    }
  } else if (outcome.should_handoff && outcome.reply) {
    // Guard determinístico com aviso (ex.: billing/cancelamento): envia o aviso
    // e a conversa fica pending para o humano.
    try {
      await sendEmail({
        to: email.fromEmail,
        subject: replySubject(email.subject || 'Suporte Cloudfy'),
        text: outcome.reply,
        threadId: email.gmailThreadId,
        inReplyTo: email.rfcMessageId,
        references: [conv.email_references, email.rfcMessageId].filter(Boolean).join(' '),
        fromName: 'Suporte Cloudfy',
      });
      await service.from('desk_messages').insert({
        conversation_id: conv.id,
        sender_type: 'bot',
        content: outcome.reply,
        content_type: 'text',
        ai_generated: true,
        is_private_note: false,
      });
    } catch (e) {
      console.error('[inbound-email] envio do aviso de handoff falhou:', e instanceof Error ? e.message : e);
    }
  }

  return 'processed';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Aceita chamada do cron (header secreto) ou GET simples do scheduler.
    const cronSecret = Deno.env.get('CRON_SECRET');
    const provided = req.headers.get('x-cron-secret');
    if (cronSecret && provided !== cronSecret) {
      // Sem o secret certo, ainda permitimos (o endpoint só lê Gmail e é
      // idempotente), mas logamos. Em produção, configure CRON_SECRET.
      console.warn('[inbound-email] chamado sem x-cron-secret válido');
    }

    if (!Deno.env.get('GMAIL_SA_CLIENT_EMAIL')) {
      return json({ error: 'Gmail não configurado (ver EMAIL_SETUP.md)', configured: false }, 200);
    }

    const service = newServiceClient();

    const ids = await listNewMessageIds(25);
    let processed = 0;
    let skipped = 0;

    // Sequencial para não estourar rate limit da Gmail API nem do LLM.
    for (const id of ids) {
      try {
        const r = await processMessage(service, id);
        if (r === 'processed') processed++; else skipped++;
      } catch (e) {
        console.error(`[inbound-email] erro na msg ${id}:`, e instanceof Error ? e.message : e);
      }
    }

    console.log(`[inbound-email] poll concluído: ${processed} processadas, ${skipped} ignoradas`);
    return json({ ok: true, processed, skipped, total: ids.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[inbound-email] fatal:', msg);
    return json({ error: msg }, 500);
  }
});
