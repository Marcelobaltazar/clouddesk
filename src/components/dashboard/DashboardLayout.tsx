import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";

export function DashboardLayout() {
  const { pathname } = useLocation();
  // A inbox compõe os próprios painéis flutuantes; as demais páginas ganham
  // um painel branco único para manter o visual de cartões sobre o fundo.
  const isInbox = pathname.startsWith("/inbox");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex-1 min-w-0 h-full overflow-hidden py-2 pr-2">
        {isInbox ? (
          <Outlet />
        ) : (
          <div className="panel h-full overflow-y-auto scrollbar-thin">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
