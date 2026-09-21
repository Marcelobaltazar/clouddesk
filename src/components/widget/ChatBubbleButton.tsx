import { MessageCircle, X } from "lucide-react";
import { useWidgetStore } from "./useWidgetStore";
import { countUnreadNews } from "./outbound/useOutbound";

export function ChatBubbleButton() {
  const { isOpen, toggleOpen, unreadCount } = useWidgetStore();
  // Novidade não lida: ponto discreto. O número vermelho continua reservado
  // para respostas da equipe — uma coisa é suporte, a outra é marketing.
  const newsUnread = useWidgetStore((s) => countUnreadNews(s.campaigns));

  return (
    <button
      onClick={toggleOpen}
      className="fixed bottom-6 right-6 z-[9999] h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center group hover:scale-105 active:scale-95"
      aria-label={isOpen ? "Fechar chat" : "Abrir chat"}
    >
      <div className="relative">
        {isOpen ? (
          <X className="h-6 w-6 transition-transform duration-200" />
        ) : (
          <MessageCircle className="h-6 w-6 transition-transform duration-200" />
        )}
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center animate-in zoom-in-50">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {!isOpen && unreadCount === 0 && newsUnread > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-primary animate-in zoom-in-50"
            aria-label={`${newsUnread} novidade${newsUnread > 1 ? "s" : ""}`}
          />
        )}
      </div>
    </button>
  );
}
