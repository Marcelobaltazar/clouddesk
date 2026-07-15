// ─── desk-widget-api — gateway ÚNICO do chat widget ─────────────────────────────
//
// O widget (bundle público em cloudfy.space) NÃO tem mais nenhum acesso direto às
// tabelas desk_* (policies anônimas removidas na migration 20260714000000). Toda
// operação passa por aqui, com:
//
//   • Identidade verificada (HMAC user_hash estilo Intercom, ou operador logado
//     para preview) — _shared/widget-auth.ts
//   • Rate limiting persistente por e-mail — _shared/rate-limit.ts
//   • Escritas 100% server-side com service role (o cliente não consegue mais
//     forjar mensagens de bot/sistema nem mexer em conversas de terceiros)
//   • Validação de posse em TODA ação sobre uma conversa (user_email da conversa
//     precisa bater com o e-mail verificado)
//
// Ações: hello | bootstrap | start | send | messages | csat | resend_credentials

import { newServiceClient, type ServiceClient } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { resolveWidgetIdentity } from '../_shared/widget-auth.ts';
import { checkRateRules, type RateRule } from '../_shared/rate-limit.ts';
import {
  fetchContactInfo,
  validateAndResendCredentials,
  type ContactInfoResult,
} from '../_shared/contact-info.ts';
import { runAiPipeline, type MessageMetadata } from '../_shared/ai-pipeline.ts';
import { broadcastToConversation } from '../_shared/broadcast.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type WidgetAction =
  | 'hello'
  | 'bootstrap'
  | 'start'
  | 'send'
  | 'messages'
  | 'csat'
  | 'resend_credentials';

interface WidgetApiRequest {
  action?: WidgetAction;
  email?: string;
  user_hash?: string;
  name?: string;
  message?: string;
  source?: 'quick_reply' | 'text';
  conversation_id?: string;
  rating?: number;
  comment?: string;
  infra_id?: string;
  account_user_id?: string;
  /** Imagem anexada pelo cliente: data URL base64 (image/png|jpeg|webp|gif, ≤4MB) */
  image_data?: string;
}

interface ConversationRow {
  id: string;
  status: string;
  created_at: string;
  subject: string | null;
  assigned_agent_id: string | null;
  ai_active: boolean;
  user_email: string | null;
  account_user_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  content: string;
  created_at: string;
  ai_generated: boolean;
  is_private_note: boolean;
  metadata: Record<string, unknown> | null;
}

const CONV_SELECT = 'id, status, created_at, subject, assigned_agent_id, ai_active, user_email, account_user_id';
const MSG_SELECT = 'id, conversation_id, sender_type, content, created_at, ai_generated, is_private_note, metadata';

const MAX_MESSAGE_CHARS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Mensagem de sistema no handoff IA → humano (era hardcoded no widget; agora é
// inserida server-side para nenhum cliente conseguir pular/forjar).
const HANDOFF_MESSAGE = `Vou encaminhar sua solicitação para nossa equipe.

⏰ Nosso SLA:
- Seg a Sex, 9h às 19h
- Resposta em até 12 horas úteis
- Fora do horário: fila para próximo dia útil

📚 Central de ajuda: https://clouddesk.apps.cloudfy.cloud/ajuda
💬 Discord: https://discord.gg/uDftSRtfKe`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Limpa texto do cliente para ARMAZENAMENTO (mantém o que ele digitou, sem
 *  caracteres invisíveis de controle e com teto de tamanho). A sanitização
 *  anti-injeção para o LLM acontece dentro do pipeline. */
function cleanForStorage(text: string): string {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .slice(0, MAX_MESSAGE_CHARS)
    .trim();
}

const serviceClient = newServiceClient;

/** Carrega a conversa SOMENTE se pertence ao e-mail verificado. */
async function loadOwnedConversation(
  service: ServiceClient,
  conversationId: string,
  email: string,
): Promise<ConversationRow | null> {
  if (!UUID_RE.test(conversationId)) return null;
  const { data, error } = await service
    .from('desk_conversations')
    .select(CONV_SELECT)
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ConversationRow;
  if ((row.user_email ?? '').trim().toLowerCase() !== email) return null;
  return row;
}

async function findOpenConversation(
  service: ServiceClient,
  email: string,
): Promise<ConversationRow | null> {
  // ilike é usado só para case-insensitivity em dados legados — escapa os
  // wildcards do LIKE para o e-mail nunca virar padrão de busca.
  const emailPattern = email.replace(/([%_\\])/g, '\\$1');
  const { data, error } = await service
    .from('desk_conversations')
    .select(CONV_SELECT)
    .ilike('user_email', emailPattern)
    .neq('status', 'resolved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[widget-api] findOpenConversation:', error.message);
    return null;
  }
  return (data as unknown as ConversationRow) ?? null;
}

async function listMessages(service: ServiceClient, conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await service
    .from('desk_messages')
    .select(MSG_SELECT)
    .eq('conversation_id', conversationId)
    .eq('is_private_note', false)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.warn('[widget-api] listMessages:', error.message);
    return [];
  }
  return (data ?? []) as unknown as MessageRow[];
}

async function insertMessage(
  service: ServiceClient,
  conversationId: string,
  senderType: 'contact' | 'bot' | 'system',
  content: string,
  aiGenerated = false,
  metadata: (MessageMetadata & { attachments?: unknown[] }) | null = null,
  contentType: 'text' | 'image' = 'text',
): Promise<MessageRow | null> {
  const { data, error } = await service
    .from('desk_messages')
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      ai_generated: aiGenerated,
      content_type: contentType,
      is_private_note: false,
      metadata: metadata ?? {},
    })
    .select(MSG_SELECT)
    .single();
  if (error) {
    console.error('[widget-api] insertMessage:', error.message);
    return null;
  }
  return data as unknown as MessageRow;
}

function publicConversation(row: ConversationRow): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    subject: row.subject,
    assigned_agent_id: row.assigned_agent_id,
    ai_active: row.ai_active,
  };
}

async function createConversation(
  service: ServiceClient,
  email: string,
  subject: string,
): Promise<ConversationRow | null> {
  const { data: created, error: createErr } = await service
    .from('desk_conversations')
    .insert({
      account_user_id: null,
      user_email: email,
      channel: 'chat',
      status: 'open',
      priority: 'medium',
      subject: subject.slice(0, 60),
      ai_active: true,
    })
    .select(CONV_SELECT)
    .single();
  if (createErr || !created) {
    console.error('[widget-api] criar conversa falhou:', createErr?.message);
    return null;
  }
  return created as unknown as ConversationRow;
}

// ─── Upload de imagem (P2) ─────────────────────────────────────────────────────
// Recebe um data URL base64, valida tipo/tamanho e sobe para o bucket público
// desk-attachments (caminho com UUID — não adivinhável). O upload é feito com
// service role; o cliente nunca escreve no Storage diretamente.

const IMAGE_DATAURL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

async function uploadImage(
  service: ServiceClient,
  conversationId: string,
  dataUrl: string,
): Promise<{ url: string } | { error: string }> {
  const match = dataUrl.match(IMAGE_DATAURL_RE);
  if (!match) return { error: 'Formato de imagem inválido (use PNG, JPG, WebP ou GIF)' };

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const contentType = `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`;

  let bytes: Uint8Array;
  try {
    const binary = atob(match[2]);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { error: 'Imagem corrompida' };
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { error: 'Imagem muito grande (máximo 4MB)' };
  }
  if (bytes.byteLength < 100) {
    return { error: 'Imagem vazia' };
  }

  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await service.storage
    .from('desk-attachments')
    .upload(path, bytes, { contentType, upsert: false });

  if (upErr) {
    console.error('[widget-api] upload de imagem falhou:', upErr.message);
    return { error: 'Não foi possível enviar a imagem. Tente novamente.' };
  }

  const { data: pub } = service.storage.from('desk-attachments').getPublicUrl(path);
  if (!pub?.publicUrl) return { error: 'Não foi possível enviar a imagem. Tente novamente.' };

  return { url: pub.publicUrl };
}

// ─── Turno de conversa (start/send compartilham isto) ─────────────────────────

async function runTurn(
  service: ServiceClient,
  conversation: ConversationRow,
  message: string,
  source: 'quick_reply' | 'text',
  fallbackName?: string,
  imageDataUrl?: string,
): Promise<Record<string, unknown>> {
  const newMessages: MessageRow[] = [];

  // P2: imagem anexada → sobe para o Storage e vira attachment da mensagem
  let imageUrl: string | null = null;
  if (imageDataUrl) {
    const uploaded = await uploadImage(service, conversation.id, imageDataUrl);
    if ('error' in uploaded) {
      return { error: uploaded.error, status: 400 };
    }
    imageUrl = uploaded.url;
  }

  const contactContent = message || (imageUrl ? '📷 Imagem' : '');
  const contactMsg = await insertMessage(
    service,
    conversation.id,
    'contact',
    contactContent,
    false,
    imageUrl ? { attachments: [{ type: 'image', url: imageUrl }] } : null,
    imageUrl ? 'image' : 'text',
  );
  if (!contactMsg) {
    return { error: 'Não foi possível registrar sua mensagem. Tente novamente.', status: 500 };
  }
  newMessages.push(contactMsg);

  let outcome;
  try {
    outcome = await runAiPipeline(service, {
      conversationId: conversation.id,
      message: message || 'O cliente enviou uma imagem (analise-a).',
      source,
      fallbackName,
      imageUrl,
    });
  } catch (e) {
    console.error('[widget-api] pipeline error:', e instanceof Error ? e.message : e);
    // A mensagem do cliente FOI registrada — operadores verão na inbox mesmo
    // com a IA fora do ar. Devolve estado sem resposta de bot.
    return {
      conversation: publicConversation(conversation),
      messages: newMessages,
      ai_error: true,
    };
  }

  if (outcome.should_handoff) {
    // Aviso customizado ao cliente ANTES do encaminhamento (ex.: infra
    // bloqueada por pagamento → mensagem das 4h vinda do guard determinístico)
    if (outcome.reply) {
      const botMsg = await insertMessage(service, conversation.id, 'bot', outcome.reply, true);
      if (botMsg) newMessages.push(botMsg);
    }
    if (!outcome.skip_handoff_notice) {
      const sysMsg = await insertMessage(service, conversation.id, 'system', HANDOFF_MESSAGE);
      if (sysMsg) newMessages.push(sysMsg);
    }
  } else if (outcome.reply) {
    const botMsg = await insertMessage(
      service,
      conversation.id,
      'bot',
      outcome.reply,
      true,
      outcome.metadata,
    );
    if (botMsg) newMessages.push(botMsg);
  }

  // Estado fresco da conversa (pipeline pode ter mudado status/ai_active)
  const { data: fresh } = await service
    .from('desk_conversations')
    .select(CONV_SELECT)
    .eq('id', conversation.id)
    .maybeSingle();
  const freshConv = (fresh as unknown as ConversationRow) ?? conversation;

  return {
    conversation: publicConversation(freshConv),
    messages: newMessages,
    waiting_for_human: outcome.should_handoff || freshConv.status === 'pending',
    blocked: outcome.blocked,
    auto_resolved: outcome.auto_resolved,
    reopened: outcome.reopened,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: WidgetApiRequest = await req.json().catch(() => ({}));
    const action = body.action;

    const validActions: WidgetAction[] = ['hello', 'bootstrap', 'start', 'send', 'messages', 'csat', 'resend_credentials'];
    if (!action || !validActions.includes(action)) {
      return json({ error: 'Ação inválida' }, 400);
    }

    // ── Identidade (HMAC ou operador) ───────────────────────────────────────────
    const identity = await resolveWidgetIdentity(req, body.email, body.user_hash);
    if (!identity.ok) {
      return json({ error: identity.error, eligible: false }, identity.status);
    }
    const email = identity.email;
    const service = serviceClient();

    // ── Rate limiting por ação ──────────────────────────────────────────────────
    const RULES: Record<WidgetAction, RateRule[]> = {
      hello:              [{ name: 'hello', max: 60, windowSeconds: 300 }],
      bootstrap:          [{ name: 'boot', max: 30, windowSeconds: 300 }],
      start: [
        { name: 'newconv', max: 6, windowSeconds: 3600 },
        { name: 'msg', max: 10, windowSeconds: 60 },
        { name: 'msg-h', max: 40, windowSeconds: 3600 },
        { name: 'msg-d', max: 200, windowSeconds: 86400 },
      ],
      send: [
        { name: 'msg', max: 10, windowSeconds: 60 },
        { name: 'msg-h', max: 40, windowSeconds: 3600 },
        { name: 'msg-d', max: 200, windowSeconds: 86400 },
      ],
      messages:           [{ name: 'list', max: 60, windowSeconds: 300 }],
      csat:               [{ name: 'csat', max: 10, windowSeconds: 3600 }],
      resend_credentials: [{ name: 'cred', max: 3, windowSeconds: 3600 }],
    };

    const exceeded = await checkRateRules(service, email, RULES[action]);
    if (exceeded) {
      console.warn(`[widget-api] rate limit '${exceeded.name}' estourado para ${email}`);
      return json({
        error: 'rate_limited',
        message: action === 'resend_credentials'
          ? 'Você já solicitou o reenvio de credenciais recentemente. Aguarde um pouco antes de tentar de novo.'
          : 'Muitas mensagens em pouco tempo. Aguarde alguns instantes e tente novamente. 🙏',
      }, 429);
    }

    // ── Ações ───────────────────────────────────────────────────────────────────

    if (action === 'hello') {
      // Gate leve para o embed decidir se renderiza a bolha.
      return json({ eligible: true });
    }

    if (action === 'bootstrap') {
      const conversation = await findOpenConversation(service, email);
      const [messages, contact] = await Promise.all([
        conversation ? listMessages(service, conversation.id) : Promise.resolve([] as MessageRow[]),
        fetchContactInfo(email).catch(() => null as ContactInfoResult | null),
      ]);
      return json({
        eligible: true,
        conversation: conversation ? publicConversation(conversation) : null,
        messages,
        contact,
      });
    }

    if (action === 'start' || action === 'send') {
      const message = cleanForStorage(body.message ?? '');
      const imageData = typeof body.image_data === 'string' ? body.image_data : undefined;
      // Precisa de texto OU imagem
      if (!message && !imageData) return json({ error: 'Mensagem vazia' }, 400);
      const source: 'quick_reply' | 'text' = body.source === 'quick_reply' ? 'quick_reply' : 'text';
      const fallbackName = typeof body.name === 'string' ? body.name : undefined;
      const subject = message || 'Atendimento via widget';

      let conversation: ConversationRow | null = null;

      if (action === 'send') {
        if (!body.conversation_id) return json({ error: 'conversation_id obrigatório' }, 400);
        conversation = await loadOwnedConversation(service, body.conversation_id, email);
        if (!conversation) return json({ error: 'Conversa não encontrada' }, 403);

        // P9: se a conversa referenciada já foi RESOLVIDA, não reabre a antiga —
        // abre um chamado NOVO e zerado (data nova, contexto limpo). Assim o
        // cliente que volta dias depois não herda o histórico de outro assunto.
        if (conversation.status === 'resolved') {
          const fresh = await createConversation(service, email, subject);
          if (!fresh) return json({ error: 'Não foi possível iniciar a conversa. Tente novamente.' }, 500);
          conversation = fresh;
        }
      } else {
        // start: reutiliza conversa aberta (não-resolvida) existente ou cria nova
        conversation = await findOpenConversation(service, email);
        if (!conversation) {
          conversation = await createConversation(service, email, subject);
          if (!conversation) return json({ error: 'Não foi possível iniciar a conversa. Tente novamente.' }, 500);
        }
      }

      const result = await runTurn(service, conversation, message, source, fallbackName, imageData);
      if (typeof result.status === 'number' && result.error) {
        return json({ error: result.error as string }, result.status as number);
      }
      return json(result);
    }

    if (action === 'messages') {
      if (!body.conversation_id) return json({ error: 'conversation_id obrigatório' }, 400);
      const conversation = await loadOwnedConversation(service, body.conversation_id, email);
      if (!conversation) return json({ error: 'Conversa não encontrada' }, 403);
      const messages = await listMessages(service, conversation.id);
      return json({ conversation: publicConversation(conversation), messages });
    }

    if (action === 'csat') {
      if (!body.conversation_id) return json({ error: 'conversation_id obrigatório' }, 400);
      const rating = Number(body.rating);
      if (![1, 2, 3].includes(rating)) return json({ error: 'rating inválido (1–3)' }, 400);
      const conversation = await loadOwnedConversation(service, body.conversation_id, email);
      if (!conversation) return json({ error: 'Conversa não encontrada' }, 403);

      const accountUserId =
        (typeof body.account_user_id === 'string' && UUID_RE.test(body.account_user_id))
          ? body.account_user_id
          : conversation.account_user_id ?? ZERO_UUID;

      const comment = typeof body.comment === 'string'
        ? cleanForStorage(body.comment).slice(0, 1000) || null
        : null;

      const { error: csatErr } = await service.from('desk_csat').insert({
        conversation_id: conversation.id,
        account_user_id: accountUserId,
        rating,
        comment,
      });
      if (csatErr) console.warn('[widget-api] csat insert falhou:', csatErr.message);

      // Guardrail: avaliação 😞 reabre a conversa para acompanhamento HUMANO —
      // um ticket avaliado como ruim não fica "resolvido" sozinho.
      let reopenedForFollowUp = false;
      if (rating === 1) {
        const { error: reopenErr } = await service
          .from('desk_conversations')
          .update({ status: 'pending', ai_active: false, resolved_at: null })
          .eq('id', conversation.id);
        if (!reopenErr) {
          reopenedForFollowUp = true;
          await insertMessage(
            service,
            conversation.id,
            'system',
            'Cliente avaliou o atendimento como 😞 — conversa reaberta para acompanhamento humano.',
          );
          void broadcastToConversation(conversation.id, 'conv_updated', { status: 'pending', ai_active: false });
        }
      }

      return json({ success: true, reopened_for_follow_up: reopenedForFollowUp });
    }

    if (action === 'resend_credentials') {
      if (!body.conversation_id) return json({ error: 'conversation_id obrigatório' }, 400);
      if (!body.infra_id || typeof body.infra_id !== 'string') {
        return json({ error: 'infra_id obrigatório' }, 400);
      }
      const conversation = await loadOwnedConversation(service, body.conversation_id, email);
      if (!conversation) return json({ error: 'Conversa não encontrada' }, 403);

      // Validação de posse da infra + disparo — SÓ acontece porque o CLIENTE
      // clicou no botão (a IA nunca chega aqui sozinha).
      const outcome = await validateAndResendCredentials(body.infra_id, email);

      if (!outcome.success) {
        return json({ success: false, error: outcome.error ?? 'Falha no reenvio' }, outcome.status);
      }

      const sysMsg = await insertMessage(
        service,
        conversation.id,
        'system',
        '✅ Credenciais reenviadas! Confira seu e-mail e me avise se chegou tudo certinho. 📬',
      );

      return json({ success: true, message: sysMsg });
    }

    return json({ error: 'Ação inválida' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[widget-api] fatal:', msg);
    return json({ error: 'Erro interno' }, 500);
  }
});
