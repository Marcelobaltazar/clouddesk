import { MessagesSquare, Newspaper } from "lucide-react";

interface Props {
  active: "list" | "news";
  newsUnread: number;
  onChange: (tab: "list" | "news") => void;
}

/** Abas de raiz do widget: Chamados | Novidades. Só aparece quando há
 *  novidades para mostrar — sem disparos publicados, o widget fica como sempre foi. */
export function WidgetTabBar({ active, newsUnread, onChange }: Props) {
  const tabs = [
    { key: "list" as const, label: "Chamados", icon: MessagesSquare, badge: 0 },
    { key: "news" as const, label: "Novidades", icon: Newspaper, badge: newsUnread },
  ];

  return (
    <nav className="grid grid-cols-2 border-t border-border bg-card" aria-label="Seções">
      {tabs.map(({ key, label, icon: Icon, badge }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors duration-150 ${
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Icon className="h-[18px] w-[18px]" />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            {label}
            {isActive && <span className="absolute top-0 inset-x-6 h-0.5 rounded-b bg-primary" />}
          </button>
        );
      })}
    </nav>
  );
}
