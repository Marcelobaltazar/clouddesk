// ─── desk-send-email — operador responde uma conversa de e-mail pelo painel ────
//
// Exige um OPERADOR autenticado (JWT + desk_agents). Envia a resposta como
// support@cloudfy.email na thread do Gmail do cliente, grava a mensagem 'agent'
// e pausa a IA (atendimento humano assumiu).

import { corsHeaders } from '../_shared/cors.ts';
import { newServiceClient } from '../_shared/supabase.ts';
import { verifyOperator } from '../_shared/widget-auth.ts';
import { sendEmail } from '../_shared/gmail.ts';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface SendRequest {
  conversation_id?: string;
  text?: string;
  /** agente que está respondendo — para o nome no remetente e sender_id */
  agent_id?: string;
  agent_name?: string;
  /** resolver a conversa após enviar */
  resolve?: boolean;
}

interface ConvRow {
  id: string;
  channel: string;
  user_email: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  email_references: string | null;
  email_subject: string | null;
  subject: string | null;
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const operatorId = await verifyOperator(req);
    if (!operatorId) {
      return json({ error: 'Apenas operadores autenticados' }, 401);
    }

    const body: SendRequest = await req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!body.conversation_id || !text) {
      return json({ error: 'conversation_id e text obrigatórios' }, 400);
    }

    const service = newServiceClient();

    const { data: conv, error } = await service
      .from('desk_conversations')
      .select('id, channel, user_email, email_thread_id, email_message_id, email_references, email_subject, subject')
      .eq('id', body.conversation_id)
      .maybeSingle();

    if (error || !conv) return json({ error: 'Conversa não encontrada' }, 404);
    const c = conv as unknown as ConvRow;

    if (c.channel !== 'email') {
      return json({ error: 'Esta conversa não é de e-mail' }, 400);
    }
    if (!c.user_email) {
      return json({ error: 'Conversa sem e-mail do cliente' }, 400);
    }

    // Envia como support@cloudfy.email na thread do cliente.
    const sent = await sendEmail({
      to: c.user_email,
      subject: replySubject(c.email_subject || c.subject || 'Suporte Cloudfy'),
      text,
      threadId: c.email_thread_id ?? undefined,
      inReplyTo: c.email_message_id,
      references: c.email_references,
      fromName: body.agent_name ? `${body.agent_name} — Cloudfy` : 'Suporte Cloudfy',
    });

    // Grava a mensagem do operador.
    await service.from('desk_messages').insert({
      conversation_id: c.id,
      sender_type: 'agent',
      sender_id: body.agent_id ?? null,
      content: text,
      content_type: 'text',
      ai_generated: false,
      is_private_note: false,
      metadata: { email: { message_id: sent.id } },
    });

    // Resposta humana pausa a IA e (opcional) resolve.
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { ai_active: false, updated_at: now };
    if (body.resolve) {
      update.status = 'resolved';
      update.resolved_at = now;
      update.ai_active = true; // reabertura futura volta a IA
    }
    await service.from('desk_conversations').update(update).eq('id', c.id);

    return json({ ok: true, message_id: sent.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[desk-send-email] fatal:', msg);
    return json({ error: msg }, 500);
  }
});
