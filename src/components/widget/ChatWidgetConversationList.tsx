import { AlertCircle, Bot, Merge, MessageSquarePlus, MessagesSquare, User } from "lucide-react";
import type { WidgetConversationSummary } from "./types";

interface Props {
  conversations: WidgetConversationSummary[];
  loading: boolean;
  /** Leitura da lista falhou — mostra erro + retry, nunca o empty state. */
  error?: boolean;
  onRetry?: () => void;
  onOpenConversation: (id: string) => void;
  onNewConversation: () => void;
}

// ── Formatação de data relativa (pt-BR) ───────────────────────────────────────
// O cliente volta horas ou dias depois: "há 5 min" perto, dia da semana na
// semana corrente, data cheia no resto. Mesma lógica de leitura do WhatsApp.

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "";

  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;

  const diffDays = Math.floor(diffH / 24);
  if (diffDays === 1) return "ontem";
  if (diffDays < 7) {
    return then.toLocaleDateString("pt-BR", { weekday: "long" });
  }
  return then.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Status do chamado como o CLIENTE entende — 'pending' é jargão interno. */
function statusLabel(status: string): { text: string; className: string } {
  switch (status) {
    case "resolved":
      return { text: "Resolvido", className: "bg-emerald-500/15 text-emerald-600" };
    case "pending":
      return { text: "Com a equipe", className: "bg-amber-500/15 text-amber-600" };
    case "snoozed":
      return { text: "Aguardando", className: "bg-muted text-muted-foreground" };
    default:
      return { text: "Em aberto", className: "bg-primary/15 text-primary" };
  }
}

function senderPrefix(sender: WidgetConversationSummary["last_message_sender"]): string {
  if (sender === "contact") return "Você: ";
  if (sender === "agent") return "Suporte: ";
  return "";
}

function ConversationRow({
  conversation,
  onOpen,
}: {
  conversation: WidgetConversationSummary;
  onOpen: () => void;
}) {
  const status = statusLabel(conversation.status);
  const unread = conversation.unread_count > 0;
  const isBot = conversation.last_message_sender === "bot";

  // Chamado que foi juntado a outro: as mensagens migraram para a thread de
  // destino. A linha continua aqui como atalho — sumir do nada faria o cliente
  // que lembra de ter aberto dois achar que perdeu um.
  if (conversation.merged_into) {
    return (
      <button
        onClick={onOpen}
        className="w-full text-left px-4 py-3 flex gap-3 hover:bg-accent/10 transition-colors duration-150 border-b border-border/60 opacity-70"
      >
        <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted">
          <Merge className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm font-medium text-foreground/70">
              {conversation.subject || "Atendimento"}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatWhen(conversation.last_message_at ?? conversation.created_at)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            Juntado ao chamado anterior — toque para abrir
          </p>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-4 py-3 flex gap-3 hover:bg-accent/10 transition-colors duration-150 border-b border-border/60"
    >
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isBot ? "bg-[hsl(var(--bubble-bot))]/20" : "bg-primary/15"
        }`}
      >
        {isBot ? (
          <Bot className="h-4 w-4 text-[hsl(var(--bubble-bot))]" />
        ) : (
          <User className="h-4 w-4 text-primary" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`flex-1 truncate text-sm ${
              unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
            }`}
          >
            {conversation.subject || "Atendimento"}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatWhen(conversation.last_message_at ?? conversation.created_at)}
          </span>
        </div>

        <p
          className={`text-xs truncate mt-0.5 ${
            unread ? "text-foreground/80" : "text-muted-foreground"
          }`}
        >
          {senderPrefix(conversation.last_message_sender)}
          {conversation.last_message_preview ?? "Sem mensagens"}
        </p>

        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.className}`}>
            {status.text}
          </span>
          {unread && (
            <span className="h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {conversation.unread_count > 9 ? "9+" : conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border/60">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-4 py-3 flex gap-3">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-full bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatWidgetConversationList({
  conversations,
  loading,
  error,
  onRetry,
  onOpenConversation,
  onNewConversation,
}: Props) {
  // Erro tem prioridade sobre o empty state: dizer "nenhum chamado ainda" para
  // quem TEM chamados é pior do que admitir a falha.
  const showError = !!error && conversations.length === 0;
  const isEmpty = !loading && !showError && conversations.length === 0;

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && conversations.length === 0 ? (
          <ListSkeleton />
        ) : showError ? (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Não consegui carregar seus chamados
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Seus chamados continuam salvos. Tente de novo em instantes.
              </p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent/10 transition-colors duration-150"
              >
                Tentar de novo
              </button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <MessagesSquare className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Nenhum chamado ainda</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Abra um chamado e acompanhe as respostas por aqui.
              </p>
            </div>
          </div>
        ) : (
          conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              onOpen={() => onOpenConversation(conversation.id)}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t border-border bg-card">
        <button
          onClick={onNewConversation}
          className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.99] transition-all duration-150 flex items-center justify-center gap-2"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Nova conversa
        </button>
      </div>
    </>
  );
}
