import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import Login from "./pages/Login";
import Inbox from "./pages/Inbox";
import Contacts from "./pages/Contacts";
import Knowledge from "./pages/Knowledge";
import MacrosPage from "./pages/Macros";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";
import WidgetPreview from "./pages/WidgetPreview";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { HelpCenterHome, HelpCenterArticle } from "./pages/HelpCenter";

const queryClient = new QueryClient();

const PUBLIC_PATHS = ["/login", "/widget-preview"];
// Prefixos públicos: qualquer sub-rota abaixo dessas raízes é livre
const PUBLIC_PREFIXES = ["/ajuda"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, agent, loading, setUser, setLoading, fetchAgent, signOut } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const isPublic = isPublicPath(location.pathname);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        setLoading(false);
        if (!isPublicPath(window.location.pathname)) {
          navigate("/login", { replace: true });
        }
        return;
      }

      setUser(session.user);
      const agentData = await fetchAgent(session.user.id);
      if (!mounted) return;

      if (!agentData) {
        await signOut();
        setLoading(false);
        navigate("/login", { replace: true, state: { error: "Acesso não autorizado" } });
        return;
      }

      setLoading(false);
    }

    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        useAuthStore.getState().setUser(null);
        useAuthStore.getState().setAgent(null);
        if (!isPublicPath(window.location.pathname)) {
          navigate("/login", { replace: true });
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Public pages: never block
  if (isPublic) return <>{children}</>;

  // Waiting for session check
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Session check done, not authenticated
  if (!user || !agent) return null;

  return <>{children}</>;
}

function AppRoutes() {
  useTheme();

  return (
    <AuthGate>
      <Routes>
        {/* Rotas públicas — sem autenticação */}
        <Route path="/ajuda" element={<HelpCenterHome />} />
        <Route path="/ajuda/:articleId" element={<HelpCenterArticle />} />
        <Route path="/widget-preview" element={<WidgetPreview />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route element={<DashboardLayout />}>
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/macros" element={<MacrosPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthGate>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
