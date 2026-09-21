// Client tipado da Edge Function desk-widget-api — o ÚNICO caminho do widget
// para o backend. O widget não acessa mais nenhuma tabela desk_* diretamente:
// toda leitura/escrita passa pelo gateway, que verifica a identidade do cliente
// (user_hash HMAC no embed, ou sessão de operador no preview do painel).

import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { ContactInfo } from "@/lib/contact-info";
import type {
  WidgetConversation,
  WidgetConversationSummary,
  WidgetMessage,
} from "@/components/widget/types";
import type { CampaignEvent, WidgetCampaign } from "@/lib/outbound";

// ── Identidade ────────────────────────────────────────────────────────────────

export interface WidgetIdentity {
  email: string;
  name?: string;
  /** HMAC-SHA256(WIDGET_IDENTITY_SECRET, lowercase(email)) — calculado pelo
   *  backend do site host. Ausente no preview (identidade via sessão do operador). */
  userHash?: string;
  /** UUID do usuário no Supabase de produção da Cloudfy (metadado p/ CSAT) */
  accountUserId?: string;
}

let identity: WidgetIdentity | null = null;

export function configureWidgetApi(id: WidgetIdentity | null) {
  identity = id;
}

// ── Tipos de resposta ─────────────────────────────────────────────────────────

export interface BootstrapResult {
  eligible: boolean;
  conversation: WidgetConversation | null;
  messages: WidgetMessage[];
  contact: ContactInfo | null;
  /** Todos os chamados do cliente — o widget abre nesta lista.
   *  null quando a leitura falhou (ver conversations_failed). */
  conversations: WidgetConversationSummary[] | null;
  /** true = a lista NÃO pôde ser lida. Diferente de lista vazia: o widget
   *  mostra erro com "tentar de novo" em vez de "nenhum chamado ainda". */
  conversations_failed?: boolean;
}

export interface ConversationsResult {
  conversations: WidgetConversationSummary[];
}

export interface MarkReadResult {
  success: boolean;
  read_at?: string;
}

export interface TurnResult {
  conversation: WidgetConversation;
  messages: WidgetMessage[];
  waiting_for_human?: boolean;
  blocked?: boolean;
  auto_resolved?: boolean;
  reopened?: boolean;
  /** IA fora do ar — a mensagem do cliente FOI registrada e será vista por um operador */
  ai_error?: boolean;
}

export interface MessagesResult {
  conversation: WidgetConversation;
  messages: WidgetMessage[];
}

export interface CsatResult {
  success: boolean;
  reopened_for_follow_up?: boolean;
}

export interface ResendResult {
  success: boolean;
  error?: string;
  message?: WidgetMessage | null;
}

export interface CampaignsResult {
  campaigns: WidgetCampaign[];
  server_time: string;
}

export class WidgetApiError extends Error {
  constructor(
    message: string,
    /** código curto: 'rate_limited' | 'unauthorized' | 'forbidden' | 'error' */
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "WidgetApiError";
  }
}

// ── Chamada base ──────────────────────────────────────────────────────────────

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  if (!identity) {
    throw new WidgetApiError("Widget não configurado (identidade ausente)", "unauthorized", 401);
  }

  const { data, error } = await supabase.functions.invoke<T>("desk-widget-api", {
    body: {
      action,
      email: identity.email,
      name: identity.name,
      user_hash: identity.userHash,
      account_user_id: identity.accountUserId,
      ...extra,
    },
  });

  if (error) {
    // Extrai o corpo JSON do erro HTTP para mensagens amigáveis (429, 401, 403)
    if (error instanceof FunctionsHttpError) {
      let body: { error?: string; message?: string } = {};
      try {
        body = await error.context.json();
      } catch {
        // corpo não-JSON
      }
      const status = error.context.status;
      const code =
        body.error === "rate_limited" ? "rate_limited"
        : status === 401 ? "unauthorized"
        : status === 403 ? "forbidden"
        : "error";
      throw new WidgetApiError(body.message ?? body.error ?? error.message, code, status);
    }
    throw new WidgetApiError(error.message, "error", 0);
  }

  if (!data) throw new WidgetApiError("Resposta vazia do servidor", "error", 0);
  return data;
}

// ── API pública ───────────────────────────────────────────────────────────────

export const widgetApi = {
  /** Gate leve: o embed decide se renderiza a bolha. */
  hello(): Promise<{ eligible: boolean }> {
    return call("hello");
  },

  /** Conversa aberta + mensagens + dados do cliente, numa chamada só. */
  bootstrap(): Promise<BootstrapResult> {
    return call("bootstrap");
  },

  /** Primeira mensagem — cria (ou retoma) a conversa e roda a IA.
   *  forceNew: cliente clicou em "Nova conversa" e quer um chamado separado,
   *  em vez de continuar o que já está aberto. */
  start(
    message: string,
    source: "quick_reply" | "text" = "text",
    imageData?: string,
    forceNew = false,
  ): Promise<TurnResult> {
    return call("start", { message, source, image_data: imageData, force_new: forceNew });
  },

  /** Mensagem em conversa existente. */
  send(
    conversationId: string,
    message: string,
    source: "quick_reply" | "text" = "text",
    imageData?: string,
  ): Promise<TurnResult> {
    return call("send", { conversation_id: conversationId, message, source, image_data: imageData });
  },

  /** Lista de chamados do cliente (abertos + resolvidos), com prévia e não lidas. */
  conversations(): Promise<ConversationsResult> {
    return call("conversations");
  },

  /** Recarrega o thread (usado ao voltar o foco para a aba). */
  messages(conversationId: string): Promise<MessagesResult> {
    return call("messages", { conversation_id: conversationId });
  },

  /** Marca a conversa como lida até agora (cliente abriu/está vendo a thread). */
  markRead(conversationId: string): Promise<MarkReadResult> {
    return call("mark_read", { conversation_id: conversationId });
  },

  /** Avaliação pós-atendimento. rating 1=😞 2=😐 3=😊 */
  csat(conversationId: string, rating: number, comment?: string): Promise<CsatResult> {
    return call("csat", { conversation_id: conversationId, rating, comment });
  },

  /** Reenvio de credenciais — disparado APENAS pelo clique do cliente. */
  resendCredentials(conversationId: string, infraId: string): Promise<ResendResult> {
    return call("resend_credentials", { conversation_id: conversationId, infra_id: infraId });
  },

  /** Disparos (avisos, novidades, banners, tours) que este cliente pode ver,
   *  já com o estado dele em cada um (viu/clicou/fechou/concluiu). */
  campaigns(): Promise<CampaignsResult> {
    return call("campaigns");
  },

  /** Registra o que o cliente fez num disparo. Fire-and-forget na prática —
   *  quem chama não deve bloquear a UI esperando a resposta. */
  campaignEvent(
    campaignId: string,
    event: CampaignEvent,
    extra: { step?: number; reaction?: string | null } = {},
  ): Promise<{ success: boolean }> {
    return call("campaign_event", { campaign_id: campaignId, event, ...extra });
  },
};
