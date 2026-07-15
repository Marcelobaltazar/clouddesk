import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInboxStore, type ConversationStatus, type Conversation } from "@/stores/useInboxStore";
import { useAuthStore } from "@/stores/authStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MessageSquare, Mail, Bot, User, Search, UserRound, CheckCircle, X, Clock } from "lucide-react";
import { differenceInSeconds } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { timeAgoShort, timeUntilShort } from "@/lib/dates";
import { broadcastConvUpdated } from "@/lib/conv-broadcast";

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: { value: ConversationStatus; label: string }[] = [
  { value: "open",     label: "Abertas"   },
  { value: "pending",  label: "Pendentes" },
  { value: "snoozed",  label: "Adiadas"   },
  { value: "resolved", label: "Resolvidas"},
];

// ─── Priority dot ─────────────────────────────────────────────────────────────

const priorityDot: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high:   "bg-priority-high",
  medium: "bg-priority-medium",
  low:    "bg-priority-low",
};

const channelIcon: Record<string, typeof MessageSquare> = {
  chat:  MessageSquare,
  email: Mail,
};

// ─── Plan badge (item 3) ───────────────────────────────────────────────────────
// A Edge Function desk-ai-respond grava a tag do plano mais alto do cliente em
// desk_conversations.tags. Mapeamos cada plano para um rótulo + cor de badge.

const PLAN_BADGES: Record<string, { label: string; cls: string }> = {
  max:        { label: "Max",     cls: "bg-fuchsia-100 text-fuchsia-700" },
  ultra:      { label: "Ultra",   cls: "bg-violet-100 text-violet-700"   },
  advanced:   { label: "Advanced",cls: "bg-sky-100 text-sky-700"         },
  starter:    { label: "Starter", cls: "bg-muted text-muted-foreground"  },
  "sem-plano":{ label: "Sem plano",cls: "bg-muted text-muted-foreground" },
};

// Badge de status (usado nos resultados de busca, que misturam status).
const statusBadge: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberta",    cls: "bg-emerald-100 text-emerald-700" },
  pending:  { label: "Pendente",  cls: "bg-amber-100 text-amber-700"     },
  snoozed:  { label: "Adiada",    cls: "bg-violet-100 text-violet-700"   },
  resolved: { label: "Resolvida", cls: "bg-muted text-muted-foreground"  },
};

// ─── Avatar colorido determinístico (inicial + cor derivada do nome) ──────────

const AVATAR_COLORS = [
  "bg-[#F98686]", // coral
  "bg-[#85E0D9]", // teal
  "bg-[#9EC5FA]", // azul
  "bg-[#B19EFA]", // lilás
  "bg-[#F7C873]", // âmbar
  "bg-[#9BDD8D]", // verde
  "bg-[#F2A2D0]", // rosa
];

function avatarColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** Retorna a config de badge do plano a partir das tags da conversa (ou null). */
function planBadgeFor(tags: string[] | null | undefined): { label: string; cls: string } | null {
  if (!tags?.length) return null;
  for (const tag of tags) {
    const badge = PLAN_BADGES[tag.toLowerCase()];
    if (badge) return badge;
  }
  return null;
}

// ─── SLA helpers ──────────────────────────────────────────────────────────────

function SlaTimer({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = differenceInSeconds(new Date(deadline), new Date(now));
  const minutesLeft = Math.round(secondsLeft / 60);

  let label: string;
  let cls: string;

  if (secondsLeft < 0) {
    label = "SLA vencido";
    cls = "text-rose-500";
  } else if (minutesLeft <= 30) {
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    label = `⚠ ${h > 0 ? `${h}h ` : ""}${m}min`;
    cls = "text-amber-500";
  } else {
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    label = h > 0 ? `${h}h ${m}min` : `${m}min`;
    cls = "text-emerald-500";
  }

  return <span className={cn("text-[10px] font-medium", cls)}>{label}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList() {
  const {
    conversations,
    activeTab,
    activeConversationId,
    searchQuery,
    isLoading,
    tabCounts,
    searchResults,
    isSearching,
    setActiveTab,
    setActiveConversationId,
    setSearchQuery,
    searchConversations,
    loadConversations,
    refreshTabCounts,
    upsertConversation,
    removeConversation,
  } = useInboxStore();

  const isSearchMode = searchQuery.trim().length >= 2;

  const agent = useAuthStore((s) => s.agent);
  const [mineOnly, setMineOnly]   = useState(false);
  const [agentMap, setAgentMap]   = useState<Record<string, { name: string; status: string }>>({});
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState(false);
  const { notify } = useNotifications();

  const selectionMode = selected.size > 0;

  // ── Fetch agents once ───────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("desk_agents")
      .select("id, name, status")
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, { name: string; status: string }> = {};
        for (const a of data) map[a.id] = { name: a.name, status: a.status };
        setAgentMap(map);
      });
  }, []);

  // ── Initial load + accurate tab counts ─────────────────────────────────────
  useEffect(() => {
    loadConversations(activeTab);
    refreshTabCounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clear selection on tab change ───────────────────────────────────────────
  useEffect(() => {
    setSelected(new Set());
  }, [activeTab]);

  // ── Realtime: conversations ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("inbox-desk-conversations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "desk_conversations" },
        (payload) => {
          upsertConversation(payload.new as Record<string, unknown>);
          notify({
            title: "Nova conversa",
            body: (payload.new as Record<string, unknown>).subject as string ?? "Um cliente iniciou uma conversa",
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "desk_conversations" },
        (payload) => {
          upsertConversation(payload.new as Record<string, unknown>);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [upsertConversation, notify]);

  // ── Realtime: notify on new contact messages ────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("inbox-new-messages-notify")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "desk_messages" },
        (payload) => {
          const msg = payload.new as Record<string, unknown>;
          if ((msg.sender_type as string) !== "contact") return;
          if ((msg.conversation_id as string) === activeConversationId) return;

          const conv = conversations.find((c) => c.id === msg.conversation_id);
          notify({
            title: `Nova mensagem de ${conv?.contact?.name ?? conv?.contact?.email ?? "Cliente"}`,
            body: String(msg.content ?? "").slice(0, 100),
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeConversationId, conversations, notify]);

  // ── Busca global (servidor) com debounce ─────────────────────────────────────
  // Em modo de busca exibimos searchResults (todas as conversas, qualquer status),
  // não apenas as da aba ativa em memória.
  useEffect(() => {
    if (!isSearchMode) return;
    const t = setTimeout(() => searchConversations(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, isSearchMode, searchConversations]);

  // ── Derived list ─────────────────────────────────────────────────────────────
  // Fora do modo busca, a lista só mostra conversas cujo status bate com a aba.
  // Uma conversa que muda de status (ex.: handoff open→pending) permanece no
  // array (o thread ativo precisa dela) mas some da lista da aba antiga —
  // corrige a duplicidade "Abertas E Pendentes ao mesmo tempo".
  const source = isSearchMode ? searchResults : conversations;
  const filtered = source.filter((c) => {
    if (!isSearchMode && c.status !== activeTab) return false;
    if (mineOnly && c.assigned_agent_id !== agent?.id) return false;
    return true;
  });

  // Não lidas: apenas conversas ABERTAS sem first_seen — nunca contaminado por
  // outras abas carregadas em memória (ex.: Resolvidas inflava o badge de Abertas).
  const unreadCount = conversations.filter(
    (c) => c.status === "open" && !c.first_seen_by_agent_at
  ).length;

  // Abre uma conversa vinda da busca: garante que ela esteja na aba correta
  // (pode ter qualquer status) antes de ativá-la, para o thread/detalhes acharem.
  function handleSelectConversation(conv: Conversation) {
    if (isSearchMode && conv.status !== activeTab) {
      setSearchQuery("");
      setActiveTab(conv.status, true);
    }
    setActiveConversationId(conv.id);
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // ── Bulk resolve ─────────────────────────────────────────────────────────────
  async function handleBulkResolve() {
    if (selected.size === 0) return;
    setResolving(true);
    const ids = [...selected];

    const { error } = await supabase
      .from("desk_conversations")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), ai_active: true })
      .in("id", ids);

    setResolving(false);

    if (error) {
      toast.error("Erro ao resolver conversas");
      return;
    }

    // Widgets abertos dessas conversas mostram o CSAT ao receber o evento;
    // ai_active=true garante que a IA reassume se a conversa for reaberta.
    for (const id of ids) void broadcastConvUpdated(id, { status: "resolved", ai_active: true });

    for (const id of ids) removeConversation(id);
    clearSelection();
    toast.success(`${ids.length} conversa${ids.length > 1 ? "s" : ""} resolvida${ids.length > 1 ? "s" : ""}`);
  }

  return (
    <div className="w-80 panel flex flex-col h-full shrink-0 overflow-hidden">

      {/* ── Search + filters ── */}
      <div className="p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, e-mail ou assunto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-surface border-none text-sm rounded-xl"
          />
        </div>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors w-full",
            mineOnly
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-surface"
          )}
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          Minhas conversas
          {mineOnly && agent && (
            <span className="ml-auto text-[9px] opacity-70">{filtered.length}</span>
          )}
        </button>
      </div>

      {/* ── Tabs (live counters per status — Item 6) ── */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          const count = tabCounts[tab.value];
          // "open" tab highlights unread (unseen) conversations; the rest show total per status.
          const showUnread = tab.value === "open" && unreadCount > 0;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value, true)}
              className={cn(
                "flex-1 py-2.5 text-[12px] font-semibold transition-colors relative inline-flex items-center justify-center gap-1",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {showUnread ? (
                <Badge className="bg-unread-badge text-white text-[9px] px-1 py-0 h-4 min-w-4 justify-center hover:bg-unread-badge">
                  {unreadCount}
                </Badge>
              ) : (
                count > 0 && (
                  <Badge
                    className={cn(
                      "text-[9px] px-1 py-0 h-4 min-w-4 justify-center hover:bg-muted",
                      "bg-muted text-muted-foreground"
                    )}
                  >
                    {count}
                  </Badge>
                )
              )}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Bulk action bar (replaces header when selecting) ── */}
      {selectionMode ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-primary/5 shrink-0">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            className="shrink-0"
            aria-label="Selecionar todos"
          />
          <span className="text-xs text-foreground font-medium flex-1">
            {selected.size} selecionada{selected.size > 1 ? "s" : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10 px-2"
            onClick={handleBulkResolve}
            disabled={resolving}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Resolver
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={clearSelection}
            aria-label="Cancelar seleção"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        /* ── Select-all header (only when list is non-empty) ── */
        filtered.length > 0 && !isLoading && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
            <Checkbox
              checked={false}
              onCheckedChange={toggleAll}
              className="shrink-0 opacity-40 hover:opacity-100 transition-opacity"
              aria-label="Selecionar todos"
            />
            <span className="text-[10px] text-muted-foreground">Selecionar todos</span>
          </div>
        )
      )}

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {(isSearchMode ? isSearching : isLoading) ? (
          <LoadingSkeleton />
        ) : filtered.length === 0 ? (
          isSearchMode ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <Search className="h-8 w-8 opacity-30" />
              <p>Nenhuma conversa encontrada</p>
              <p className="text-[10px] opacity-70">Busca por nome, e-mail ou assunto · todos os status</p>
            </div>
          ) : (
            <EmptyState tab={activeTab} />
          )
        ) : (
          filtered.map((conv, i) => (
            <div key={conv.id}>
              {i > 0 && <div className="h-px mx-3 bg-border" />}
              <ConversationItem
                conv={conv}
                isActive={conv.id === activeConversationId}
                isSelected={selected.has(conv.id)}
                selectionMode={selectionMode}
                showStatus={isSearchMode}
                agentMap={agentMap}
                onSelect={() => handleSelectConversation(conv)}
                onToggle={() => toggleOne(conv.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── ConversationItem ─────────────────────────────────────────────────────────

function ConversationItem({
  conv,
  isActive,
  isSelected,
  selectionMode,
  showStatus = false,
  agentMap,
  onSelect,
  onToggle,
}: {
  conv: Conversation;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  showStatus?: boolean;
  agentMap: Record<string, { name: string; status: string }>;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUnread    = !conv.first_seen_by_agent_at;
  const ChannelIcon = channelIcon[conv.channel] ?? MessageSquare;
  const name        = conv.contact?.name || conv.contact?.email || conv.user_email || "Visitante";
  const preview     = conv.last_message?.content?.slice(0, 80) ?? "Sem mensagens";
  const isBot       = conv.last_message?.sender_type === "bot";
  const planBadge   = planBadgeFor(conv.tags);
  const time        = conv.last_message?.created_at
    ? timeAgoShort(conv.last_message.created_at)
    : "";

  const showCheckbox = selectionMode || hovered || isSelected;

  function handleClick(e: React.MouseEvent) {
    // If clicking directly on the checkbox area, toggle selection
    if ((e.target as HTMLElement).closest("[data-checkbox]")) return;
    if (selectionMode) {
      onToggle();
    } else {
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(e as unknown as React.MouseEvent); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "w-full text-left p-3 rounded-xl transition-colors duration-100 cursor-pointer",
        isSelected
          ? "bg-secondary card-selected"
          : isActive
          ? "bg-card card-selected"
          : "hover:bg-surface-hover"
      )}
    >
      <div className="flex items-start gap-2.5">

        {/* Checkbox / Avatar column */}
        <div className="relative shrink-0 mt-0.5 h-8 w-8">
          {/* Checkbox overlay */}
          <div
            data-checkbox
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full transition-opacity z-10",
              showCheckbox ? "opacity-100" : "opacity-0"
            )}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle()}
              className="h-4 w-4 bg-card border-muted-foreground"
              aria-label={`Selecionar conversa de ${name}`}
            />
          </div>

          {/* Avatar (hidden when checkbox is showing) */}
          <div
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center transition-opacity",
              avatarColorFor(name),
              showCheckbox ? "opacity-0" : "opacity-100"
            )}
          >
            <span className="text-[12px] font-semibold text-foreground/80 select-none">
              {name[0]?.toUpperCase()}
            </span>
          </div>

          {/* Priority dot */}
          {!showCheckbox && !conv.assigned_agent_id && (
            <div
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                priorityDot[conv.priority] ?? "bg-priority-low"
              )}
            />
          )}

          {/* Assigned agent avatar */}
          {!showCheckbox && conv.assigned_agent_id && agentMap[conv.assigned_agent_id] && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center border-2 border-card text-[8px] font-bold text-primary-foreground select-none">
                    {agentMap[conv.assigned_agent_id].name
                      .split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {agentMap[conv.assigned_agent_id].name}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Unread dot */}
          {isUnread && !isActive && (
            <div className="absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-unread-badge border-2 border-card" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "text-[13px] truncate text-card-foreground",
                isUnread && !isActive ? "font-bold" : "font-semibold"
              )}
            >
              {name}
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0">{time}</span>
          </div>

          <div className="flex items-center gap-1 mt-0.5">
            {isBot && <Bot className="h-3 w-3 text-muted-foreground shrink-0" />}
            <ChannelIcon className="h-3 w-3 text-muted-foreground shrink-0" />
            <p className={cn("text-[13px] truncate", isUnread && !isActive ? "text-foreground" : "text-muted-foreground")}>
              {preview}
            </p>
          </div>

          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1 flex-wrap">
              {planBadge && (
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", planBadge.cls)}>
                  {planBadge.label}
                </span>
              )}
              {/* Em modo de busca, mostra o status (resultados misturam abertos/fechados) */}
              {showStatus && (
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", statusBadge[conv.status]?.cls)}>
                  {statusBadge[conv.status]?.label ?? conv.status}
                </span>
              )}
              {!showStatus && conv.status === "snoozed" && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full font-medium">
                  <Clock className="h-2.5 w-2.5" /> Adiada
                  {conv.snoozed_until && ` · ${timeUntilShort(conv.snoozed_until)}`}
                </span>
              )}
              {conv.status === "pending" && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-medium">
                  <UserRound className="h-2.5 w-2.5" /> Aguardando humano
                </span>
              )}
              {conv.ai_active && conv.status !== "resolved" && conv.status !== "pending" && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full font-medium">
                  <Bot className="h-2.5 w-2.5" /> IA ativa
                </span>
              )}
            </div>
            {conv.sla_deadline && conv.status !== "resolved" && (
              <SlaTimer deadline={conv.sla_deadline} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-3 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

const emptyMessages: Record<ConversationStatus, string> = {
  open:     "Nenhuma conversa aberta",
  pending:  "Nenhuma conversa pendente",
  snoozed:  "Nenhuma conversa adiada",
  resolved: "Nenhuma conversa resolvida",
};

function EmptyState({ tab }: { tab: ConversationStatus }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
      <MessageSquare className="h-8 w-8 opacity-30" />
      <p>{emptyMessages[tab]}</p>
    </div>
  );
}
