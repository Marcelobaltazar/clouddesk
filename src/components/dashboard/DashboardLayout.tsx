import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { ServerIncidentBanner } from "./ServerIncidentBanner";

export function DashboardLayout() {
  const { pathname } = useLocation();
  // A inbox compõe os próprios painéis flutuantes; as demais páginas ganham
  // um painel branco único para manter o visual de cartões sobre o fundo.
  const isInbox = pathname.startsWith("/inbox");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex flex-1 min-w-0 h-full flex-col overflow-hidden py-2 pr-2">
        {/* Alerta de servidor fora do ar (aparece em qualquer página) */}
        <ServerIncidentBanner />
        <div className="min-h-0 flex-1">
          {isInbox ? (
            <Outlet />
          ) : (
            <div className="panel h-full overflow-y-auto scrollbar-thin">
              <Outlet />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
