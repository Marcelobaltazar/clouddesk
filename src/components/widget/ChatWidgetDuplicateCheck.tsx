import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import type { WidgetConversationSummary } from "./types";

interface Props {
  /** Chamado recente em aberto que o cliente talvez queira continuar. */
  conversation: WidgetConversationSummary;
  onContinue: () => void;
  onCreateAnyway: () => void;
}

/**
 * Passo intermediário do botão "Nova conversa" quando o cliente JÁ tem um
 * chamado recente em aberto.
 *
 * É a camada de prevenção da duplicata: em vez de mesclar depois (o que junta
 * SLA, prioridade e assunto de dois problemas que podem ser distintos, sem
 * como desfazer), mostramos qual é o chamado aberto e deixamos o cliente
 * escolher. Quem tem um segundo problema de verdade continua conseguindo abrir
 * — só não abre um chamado repetido sem perceber.
 */
export function ChatWidgetDuplicateCheck({ conversation, onContinue, onCreateAnyway }: Props) {
  const when = formatWhen(conversation.last_message_at ?? conversation.created_at);

  return (
    <div className="flex-1 flex flex-col justify-center px-5 py-6 gap-4 overflow-y-auto scrollbar-thin">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
          <MessagesSquare className="h-5 w-5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          Você já tem um chamado em aberto
        </h3>
        <p className="text-xs text-muted-foreground">
          Se for sobre o mesmo assunto, continuar nele é mais rápido — nossa equipe
          já tem todo o contexto lá.
        </p>
      </div>

      {/* Cartão do chamado aberto: o cliente precisa RECONHECER o chamado para
          decidir, então mostramos assunto, última mensagem e quando foi. */}
      <button
        onClick={onContinue}
        className="w-full text-left rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3 hover:bg-primary/10 transition-colors duration-150"
      >
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-sm font-medium text-foreground">
            {conversation.subject || "Atendimento"}
          </span>
          {when && <span className="text-[10px] text-muted-foreground shrink-0">{when}</span>}
        </div>
        {conversation.last_message_preview && (
          <p className="text-xs text-muted-foreground truncate mt-1">
            {conversation.last_message_preview}
          </p>
        )}
      </button>

      <div className="flex flex-col gap-2">
        <button
          onClick={onContinue}
          className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.99] transition-all duration-150"
        >
          Continuar nesse chamado
        </button>
        <button
          onClick={onCreateAnyway}
          className="w-full py-2.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent/10 transition-colors duration-150 flex items-center justify-center gap-2"
        >
          <MessageSquarePlus className="h-4 w-4" />
          É outro assunto — abrir novo
        </button>
      </div>
    </div>
  );
}

/** Mesma escala de tempo da lista de chamados (perto → relativo, longe → data). */
function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then.getTime())) return "";

  const diffMin = Math.floor((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;

  const diffDays = Math.floor(diffH / 24);
  return diffDays === 1 ? "ontem" : `há ${diffDays} dias`;
}
