import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Inbox, Users, BookOpen, Zap, Settings, Cloud, LogOut, Moon, Sun, Circle, Bell, BellOff, LayoutGrid, PanelLeft, Flame, BarChart3, UserCircle, Bot, ListChecks } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInboxStore } from "@/stores/useInboxStore";
import { useNotifications } from "@/hooks/useNotifications";
import { supabase } from "@/integrations/supabase/client";
import { VIEWS_CHANGED_EVENT } from "@/lib/views-events";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeskView {
  id: string;
  name: string;
  emoji: string | null;
  color: string;
  order_index: number;
  filters: {
    plan_product?: string;      // nome novo (editor de Settings)
    airtable_product?: string;  // nome legado (views antigas) — tratado como sinônimo
    status?: string;
    priority?: string;
    /** Filtro genérico por tag da conversa (ex.: "intent:cancelamento") */
    tag?: string;
  };
  is_active: boolean;
}

/**
 * Plano do filtro da view, normalizado para a tag gravada em
 * desk_conversations.tags (max / ultra / advanced / starter).
 * Aceita tanto plan_product quanto airtable_product e extrai a palavra-chave
 * do plano de strings como "Cloud Max", "n8n-advanced", "Starter".
 */
function planTagFromFilter(filters: DeskView["filters"]): string | null {
  const raw = (filters.plan_product ?? filters.airtable_product ?? "").toLowerCase();
  if (!raw) return null;
  for (const plan of ["max", "ultra", "advanced", "starter"]) {
    if (raw.includes(plan)) return plan;
  }
  return null;
}

/** Tag efetiva da view: genérica (intent:*) tem precedência sobre a de plano. */
function tagFromFilter(filters: DeskView["filters"]): string | null {
  return filters.tag ?? planTagFromFilter(filters);
}

/**
 * Os dois eixos da sidebar. Misturá-los num bloco só é o que faz a conta
 * "não fechar": uma conversa Advanced que está aguardando humano aparece nas
 * duas — e deve mesmo, porque são recortes diferentes da MESMA conversa.
 *
 *  FILA     (eixo ESTADO)    — quem está com a bola. São mutuamente exclusivas.
 *  SEGMENTO (eixo CLIENTE)   — de quem/do que se trata. Cruzam todas as filas.
 */
function isSegmentView(view: DeskView): boolean {
  return !!tagFromFilter(view.filters);
}

/** Contagem de uma view: total do recorte + quantas dele esperam humano. */
interface ViewCount {
  total: number;
  /** null = não se aplica (a view já filtra um status específico). */
  pending: number | null;
}

// ─── Fixed nav items ──────────────────────────────────────────────────────────

const primaryNav = [
  { title: "Inbox",     url: "/inbox",    icon: Inbox },
  { title: "Contatos",  url: "/contacts", icon: Users },
];

const secondaryNav = [
  { title: "Base de Conhecimento", url: "/knowledge", icon: BookOpen },
  { title: "Respostas rápidas",    url: "/macros",    icon: Zap      },
];

const tertiaryNav = [
  { title: "Relatórios",    url: "/reports",  icon: BarChart3 },
  { title: "Configurações", url: "/settings", icon: Settings  },
];

const statusColors: Record<string, string> = {
  online:  "bg-status-online",
  away:    "bg-status-away",
  offline: "bg-status-offline",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AppSidebar() {
  const { agent, signOut, updateStatus } = useAuthStore();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem("sidebar-open") === "true"; } catch { return false; }
  });

  const toggleSidebar = () => {
    setIsOpen((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar-open", String(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const { conversations, tabCounts, refreshTabCounts, setPriorityFilter, setPriorityInFilter, applyView } = useInboxStore();
  const { isEnabled, toggle } = useNotifications();
  const location = useLocation();

  // ── Prioritários: conversas abertas com prioridade high OU urgent (item 4) ──
  const PRIORITY_LEVELS: ("high" | "urgent")[] = ["high", "urgent"];
  const [priorityCount, setPriorityCount] = useState(0);
  const [priorityActive, setPriorityActive] = useState(false);

  // Total REAL de conversas em aberto (open + pending), igual ao cabeçalho da
  // lista. Antes vinha de conversations.length, que é a lista JÁ FILTRADA: ao
  // clicar numa Visualização o badge do Inbox passava a exibir o número da view.
  const openCount = tabCounts.open + tabCounts.pending;
  const initials = agent?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";

  // ── Dynamic views ────────────────────────────────────────────────────────────
  const [views, setViews] = useState<DeskView[]>([]);
  const [viewCounts, setViewCounts] = useState<Record<string, ViewCount>>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  // Fila da IA: aberto + ai_active. É a outra metade de "Aguardando humano" —
  // juntas, as duas filas cobrem tudo que está em aberto.
  const [aiCount, setAiCount] = useState(0);
  const [aiActive, setAiActive] = useState(false);

  // Os dois eixos, separados na hora de renderizar. Uma view de estado (ex.:
  // "Aguardando humano") é uma fila; uma com tag de plano/intenção é um segmento.
  const queueViews   = views.filter((v) => !isSegmentView(v));
  const segmentViews = views.filter(isSegmentView);

  const loadViews = useCallback(async () => {
    const { data, error } = await supabase
      .from("desk_views")
      .select("id, name, emoji, color, order_index, filters, is_active")
      .eq("is_active", true)
      .order("order_index");

    if (error || !data) return;
    const loaded = data as DeskView[];
    setViews(loaded);
    fetchViewCounts(loaded);
  }, []);

  // Reload views on mount and whenever the user navigates back from Settings
  useEffect(() => {
    loadViews();
  }, [loadViews, location.pathname]);

  // Recarrega imediatamente quando uma view é criada/editada/removida em Settings.
  useEffect(() => {
    const handler = () => loadViews();
    window.addEventListener(VIEWS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(VIEWS_CHANGED_EVENT, handler);
  }, [loadViews]);

  // ── Contadores 100% ao vivo ───────────────────────────────────────────────────
  // Qualquer INSERT/UPDATE em desk_conversations (nova conversa, mudança de
  // status, tag de plano gravada) reconta as views com debounce de 1,5s.
  // São só head-counts — baratos. Sem isto os números ficavam congelados até
  // o operador navegar.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadViews();          // re-busca views + contadores
        refreshPriorityCount();
      }, 1_500);
    };

    const channel = supabase
      .channel("sidebar-view-counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "desk_conversations" },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadViews]);

  // Contadores das filas fixas (prioritários + IA cuidando). Recontam quando a
  // inbox muda e a cada evento realtime de desk_conversations.
  const refreshPriorityCount = useCallback(async () => {
    const [prio, ai] = await Promise.all([
      supabase
        .from("desk_conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .in("priority", PRIORITY_LEVELS),
      supabase
        .from("desk_conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("ai_active", true),
    ]);
    setPriorityCount(prio.count ?? 0);
    setAiCount(ai.count ?? 0);
    // O badge do Inbox vive de tabCounts — sem isto ele congela no valor
    // carregado quando a lista montou.
    refreshTabCounts();
  }, [refreshTabCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshPriorityCount();
  }, [refreshPriorityCount, conversations.length]);

  /** Limpa o destaque das outras filas/views antes de aplicar a escolhida. */
  function selectNav(kind: "priority" | "ai" | "view", viewId: string | null = null) {
    setPriorityActive(kind === "priority");
    setAiActive(kind === "ai");
    setActiveViewId(viewId);
    navigate("/inbox");
  }

  function handlePriorityClick() {
    selectNav("priority");
    // Prioritários = abertas com prioridade high OU urgent, sem filtro de plano.
    applyView({ status: "open", priorityIn: PRIORITY_LEVELS, plan: null });
  }

  function handleAiQueueClick() {
    selectNav("ai");
    applyView({ status: "open", aiActive: true });
  }

  async function fetchViewCounts(loaded: DeskView[]) {
    const counts: Record<string, ViewCount> = {};

    // Uma contagem por view, com o MESMO filtro que o clique aplica — contador
    // e lista nunca divergem. `onlyPending` produz o número âmbar do badge duplo.
    const countFor = async (view: DeskView, onlyPending: boolean) => {
      let query = supabase
        .from("desk_conversations")
        .select("id", { count: "exact", head: true });

      const f = view.filters;

      if (onlyPending) {
        query = query.eq("status", "pending");
      } else if (f.status) {
        query = query.eq("status", f.status);
      } else {
        // Padrão = grupo "Aberto" (open + pending).
        query = query.in("status", ["open", "pending"]);
      }

      if (f.priority) {
        query = query.eq("priority", f.priority);
      }

      // Filtro por tag: genérico (f.tag, ex. "intent:cancelamento") ou plano
      // (max/ultra/advanced/starter). A tag de plano é gravada na CRIAÇÃO da
      // conversa pelo gateway e atualizada a cada turno da IA.
      const tagFilter = tagFromFilter(f);
      if (tagFilter) {
        query = query.contains("tags", [tagFilter]);
      }

      const { count } = await query;
      return count ?? 0;
    };

    await Promise.all(
      loaded.map(async (view) => {
        // O número âmbar ("esperando humano") só faz sentido em views que ainda
        // não fixaram um status — numa view de resolvidas ele seria sempre 0.
        const wantsPending = isSegmentView(view) && !view.filters.status;
        const [total, pending] = await Promise.all([
          countFor(view, false),
          wantsPending ? countFor(view, true) : Promise.resolve(null),
        ]);
        counts[view.id] = { total, pending };
      })
    );

    setViewCounts(counts);
  }

  /** `onlyPending` = clique no número âmbar do badge duplo: mesma view, mas
   *  recortada no que espera humano. */
  function handleViewClick(view: DeskView, onlyPending = false) {
    selectNav("view", view.id);

    const targetStatus = onlyPending
      ? "pending" as const
      : (view.filters.status as "open" | "pending" | "snoozed" | "resolved" | undefined) ?? "open";
    const targetPriority = (view.filters.priority as "low" | "medium" | "high" | "urgent" | undefined) ?? null;
    // Tag genérica (ex.: intent:cancelamento) tem precedência sobre plano
    const targetTag = tagFromFilter(view.filters);

    // applyView define status + prioridade + tag atomicamente e recarrega,
    // sem a corrida que deixava a lista vazia.
    applyView({ status: targetStatus, priority: targetPriority, plan: targetTag });
  }

  const handleToggleNotifications = () => {
    toggle();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <aside className={cn(
        "transition-all duration-200 bg-transparent flex flex-col h-screen overflow-hidden shrink-0",
        isOpen ? "w-[220px]" : "w-[64px]"
      )}>

        {/* Logo + toggle */}
        <div className="h-14 flex items-center shrink-0 px-2 gap-2">
          <button
            onClick={toggleSidebar}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground transition-colors shrink-0"
            aria-label={isOpen ? "Fechar menu" : "Abrir menu"}
          >
            <PanelLeft className={cn("h-5 w-5 transition-transform duration-200", isOpen && "rotate-180")} />
          </button>
          {isOpen && (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Cloud className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-bold text-foreground whitespace-nowrap">CloudDesk</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto scrollbar-thin">
          {/* Primary: Inbox + Contatos */}
          <div className="space-y-1">
            {primaryNav.map((item) => (
              <NavLink
                key={item.url}
                to={item.url}
                end={item.url === "/inbox"}
                onClick={item.url === "/inbox" ? () => {
                  setPriorityActive(false);
                  setAiActive(false);
                  setActiveViewId(null);
                  applyView({ status: "open" });
                } : undefined}
                className="flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm"
                activeClassName="bg-card card-selected text-foreground font-medium"
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {isOpen && <span className="whitespace-nowrap flex-1">{item.title}</span>}
                {isOpen && item.url === "/inbox" && openCount > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {openCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-border/50" />

          {/* Secondary: Base de Conhecimento + Respostas Rápidas */}
          <div className="space-y-1">
            {secondaryNav.map((item) => (
              <NavLink
                key={item.url}
                to={item.url}
                className="flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm"
                activeClassName="bg-card card-selected text-foreground font-medium"
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {isOpen && <span className="whitespace-nowrap flex-1">{item.title}</span>}
              </NavLink>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-border/50" />

          {/* Tertiary: Relatórios + Configurações */}
          <div className="space-y-1">
            {tertiaryNav.map((item) => (
              <NavLink
                key={item.url}
                to={item.url}
                className="flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm"
                activeClassName="bg-card card-selected text-foreground font-medium"
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {isOpen && <span className="whitespace-nowrap flex-1">{item.title}</span>}
              </NavLink>
            ))}
          </div>

          {/* Divider before views */}
          <div className="my-2 border-t border-border/50" />

          {/* ── FILAS: eixo ESTADO (quem está com a bola) ───────────────────── */}
          {isOpen && <SectionLabel icon={ListChecks} text="Filas" />}

          {/* Prioritários — fixo (open + high/urgent) — item 4 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handlePriorityClick}
                className={cn(
                  "w-full flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm",
                  priorityActive && "bg-card card-selected text-foreground font-medium"
                )}
              >
                <Flame className="h-5 w-5 shrink-0 text-rose-500" />
                {isOpen && <span className="whitespace-nowrap flex-1 text-left">Prioritários</span>}
                {isOpen && priorityCount > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {priorityCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Prioritários</p>
              <p className="text-xs text-muted-foreground">{priorityCount} conversas abertas (alta/urgente)</p>
            </TooltipContent>
          </Tooltip>

          {/* IA cuidando — a outra metade de "Aguardando humano" */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleAiQueueClick}
                className={cn(
                  "w-full flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm",
                  aiActive && "bg-card card-selected text-foreground font-medium"
                )}
              >
                <Bot className="h-5 w-5 shrink-0 text-indigo-400" />
                {isOpen && <span className="whitespace-nowrap flex-1 text-left">IA cuidando</span>}
                {isOpen && aiCount > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {aiCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>IA cuidando</p>
              <p className="text-xs text-muted-foreground">{aiCount} abertas em que a IA ainda responde</p>
            </TooltipContent>
          </Tooltip>

          {/* Views de estado (sem filtro de plano/tag) entram nas Filas */}
          {queueViews.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              count={viewCounts[view.id]}
              isActive={activeViewId === view.id}
              isOpen={isOpen}
              onOpen={() => handleViewClick(view)}
              onOpenPending={() => handleViewClick(view, true)}
            />
          ))}

          {/* ── SEGMENTOS: eixo CLIENTE (cruzam todas as filas) ─────────────── */}
          {segmentViews.length > 0 && (
            <>
              {isOpen && <SectionLabel icon={LayoutGrid} text="Segmentos" />}
              {segmentViews.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  count={viewCounts[view.id]}
                  isActive={activeViewId === view.id}
                  isOpen={isOpen}
                  onOpen={() => handleViewClick(view)}
                  onOpenPending={() => handleViewClick(view, true)}
                />
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="p-2 space-y-1 shrink-0">
          {/* Notifications toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleNotifications}
                className="w-full flex items-center gap-3 justify-start px-2"
              >
                {isEnabled ? (
                  <Bell className="h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <BellOff className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                {isOpen && (
                  <span className="text-sm whitespace-nowrap">
                    {isEnabled ? "Notificações ativas" : "Notificações desativadas"}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isEnabled ? "Desativar notificações" : "Ativar notificações"}
            </TooltipContent>
          </Tooltip>

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 justify-start px-2"
          >
            {theme === "dark" ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
            {isOpen && (
              <span className="text-sm whitespace-nowrap">
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </span>
            )}
          </Button>

          {/* Agent menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-sidebar-accent transition-colors">
                <div className="relative shrink-0">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <Circle
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-current ${statusColors[agent?.status ?? "offline"]} text-sidebar rounded-full`}
                  />
                </div>
                {isOpen && (
                  <span className="text-sm text-sidebar-foreground truncate whitespace-nowrap">
                    {agent?.name}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-48">
              <DropdownMenuItem onClick={() => updateStatus("online")}>
                <Circle className="h-3 w-3 fill-status-online text-status-online mr-2" /> Online
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus("away")}>
                <Circle className="h-3 w-3 fill-status-away text-status-away mr-2" /> Ausente
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus("offline")}>
                <Circle className="h-3 w-3 fill-status-offline text-status-offline mr-2" /> Offline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Nome exibido ao cliente mora aqui — ver aba "Minha conta" */}
              <DropdownMenuItem onClick={() => navigate("/settings?tab=conta")}>
                <UserCircle className="h-3 w-3 mr-2" /> Minha conta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => { await signOut(); navigate("/login", { replace: true }); }}>
                <LogOut className="h-3 w-3 mr-2" /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/** Cabeçalho de um dos dois eixos ("Filas" / "Segmentos"). */
function SectionLabel({ icon: Icon, text }: { icon: typeof LayoutGrid; text: string }) {
  return (
    <div className="pt-3 pb-1">
      <div className="flex items-center gap-1.5 px-2">
        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          {text}
        </span>
      </div>
    </div>
  );
}

/**
 * Linha de uma Visualização na sidebar.
 *
 * Badge duplo (só em segmentos): "9 · 23" = 9 esperando humano, 23 em aberto
 * no total. O âmbar é o acionável — é ele que responde "quanto trabalho meu
 * tem aqui?". Clicar no âmbar abre a mesma view recortada em 'pending', então
 * cada número continua batendo com a lista que ele abre.
 */
function ViewRow({
  view,
  count,
  isActive,
  isOpen,
  onOpen,
  onOpenPending,
}: {
  view: DeskView;
  count: ViewCount | undefined;
  isActive: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onOpenPending: () => void;
}) {
  const total   = count?.total ?? 0;
  const pending = count?.pending ?? null;
  // Sem nada esperando humano não há o que destacar — mostra só o total.
  const showDual = pending !== null && pending > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* div (e não button) porque o número âmbar é clicável por si só —
            um <button> dentro de outro é HTML inválido. */}
        <div
          className={cn(
            "w-full flex items-center gap-3 px-2 py-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors text-sm",
            isActive && "bg-card card-selected text-foreground font-medium"
          )}
        >
          <button
            onClick={onOpen}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            {/* Icon: colored dot when collapsed, emoji+dot when expanded */}
            <span
              className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-sm"
              style={{ backgroundColor: `${view.color}25` }}
            >
              {view.emoji ? (
                <span className="text-xs leading-none">{view.emoji}</span>
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: view.color }} />
              )}
            </span>
            {isOpen && <span className="whitespace-nowrap flex-1 truncate">{view.name}</span>}
          </button>

          {isOpen && total > 0 && (
            <span className="flex items-center gap-1 shrink-0 text-xs tabular-nums">
              {showDual && (
                <>
                  <button
                    onClick={onOpenPending}
                    className="text-amber-500 font-semibold hover:underline"
                    aria-label={`${pending} aguardando humano em ${view.name}`}
                  >
                    {pending}
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                </>
              )}
              <span className="text-muted-foreground">{total}</span>
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{view.name}</p>
        {showDual ? (
          <p className="text-xs text-muted-foreground">
            <span className="text-amber-500">{pending} aguardando humano</span> de {total} em aberto
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{total} conversas</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
