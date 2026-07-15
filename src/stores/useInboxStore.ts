import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationStatus = "open" | "pending" | "snoozed" | "resolved";
export type ConversationPriority = "low" | "medium" | "high" | "urgent";
export type ConversationChannel = "chat" | "email";

export interface ConversationContact {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ConversationLastMessage {
  content: string;
  created_at: string;
  sender_type: string;
}

export interface Conversation {
  id: string;
  account_user_id: string;
  user_email: string | null;
  assigned_agent_id: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  priority: ConversationPriority;
  subject: string | null;
  ai_active: boolean;
  sla_deadline: string | null;
  snoozed_until: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  first_seen_by_agent_at: string | null;
  unread_count: number;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  // Enriched client-side
  contact?: ConversationContact;
  last_message?: ConversationLastMessage;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface TabCache {
  loadedAt: number;         // Date.now() when the tab was last fetched
  conversations: Conversation[];
}

interface InboxState {
  conversations: Conversation[];
  activeTab: ConversationStatus;
  activeConversationId: string | null;
  searchQuery: string;
  isLoading: boolean;
  priorityFilter: ConversationPriority | null;
  /** Multi-priority "OR" filter (ex.: Prioritários = high + urgent). Tem precedência sobre priorityFilter. */
  priorityInFilter: ConversationPriority[] | null;
  /** Filtro por tag de plano (max/ultra/advanced/starter) — usado pelas Visualizações. */
  planFilter: string | null;
  /** Counts per status fetched from the DB — used for tab badges */
  tabCounts: Record<ConversationStatus, number>;
  /** Per-tab cache to avoid redundant reloads within a short window */
  _tabCache: Partial<Record<ConversationStatus, TabCache>>;
  /** Resultados da busca global (todas as conversas, qualquer status). */
  searchResults: Conversation[];
  isSearching: boolean;

  // Actions
  setActiveTab: (tab: ConversationStatus, clearPriority?: boolean) => void;
  setActiveConversationId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  /** Busca global no banco por nome/e-mail/assunto, em qualquer status. */
  searchConversations: (query: string) => Promise<void>;
  setPriorityFilter: (priority: ConversationPriority | null) => void;
  setPriorityInFilter: (priorities: ConversationPriority[] | null) => void;
  /** Aplica uma Visualização (status + prioridade + plano) de forma atômica e carrega. */
  applyView: (opts: {
    status: ConversationStatus;
    priority?: ConversationPriority | null;
    priorityIn?: ConversationPriority[] | null;
    plan?: string | null;
  }) => void;
  loadConversations: (status: ConversationStatus, priority?: ConversationPriority | null, force?: boolean) => Promise<void>;
  refreshTabCounts: () => Promise<void>;
  upsertConversation: (raw: Record<string, unknown>) => Promise<void>;
  removeConversation: (id: string) => void;
}

const CACHE_TTL_MS = 30_000; // 30 seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enrichConversations(
  rows: Record<string, unknown>[]
): Promise<Conversation[]> {
  if (rows.length === 0) return [];

  // Conversas do widget têm account_user_id = null (cliente não vive no Supabase
  // do CloudDesk). Um `null` no filtro .in("user_id", …) faz o PostgREST retornar
  // 400 "invalid input syntax for type uuid: null" e o enrich inteiro falhava —
  // nenhuma conversa carregava dados de contato. Filtramos os nulls e só
  // consultamos account quando há pelo menos um id válido.
  const accountIds = [...new Set(
    rows.map((r) => r.account_user_id as string | null).filter((id): id is string => !!id)
  )];
  const convIds    = rows.map((r) => r.id as string);

  const [accountsRes, msgsRes] = await Promise.all([
    accountIds.length > 0
      ? supabase
          .from("account")
          .select("user_id, name, email, phone")
          .in("user_id", accountIds)
      : Promise.resolve({ data: [] as ConversationContact[] }),
    supabase
      .from("desk_messages")
      .select("conversation_id, content, created_at, sender_type")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false }),
  ]);

  const accountMap: Record<string, ConversationContact> = {};
  for (const acc of accountsRes.data ?? []) {
    accountMap[acc.user_id] = acc as ConversationContact;
  }

  // Keep only the most recent message per conversation
  const lastMsgMap: Record<string, ConversationLastMessage> = {};
  for (const msg of msgsRes.data ?? []) {
    if (!lastMsgMap[msg.conversation_id]) {
      lastMsgMap[msg.conversation_id] = {
        content:     msg.content,
        created_at:  msg.created_at,
        sender_type: msg.sender_type,
      };
    }
  }

  return rows.map((row) => ({
    ...(row as unknown as Conversation),
    contact:      accountMap[row.account_user_id as string],
    last_message: lastMsgMap[row.id as string],
  }));
}

async function enrichOne(raw: Record<string, unknown>): Promise<Conversation> {
  // account_user_id pode ser null (conversa do widget) — .eq("user_id", null)
  // vira 400 no PostgREST. Só consulta account quando há id válido.
  const accountUserId = (raw.account_user_id as string | null) ?? null;
  const [accRes, msgRes] = await Promise.all([
    accountUserId
      ? supabase
          .from("account")
          .select("user_id, name, email, phone")
          .eq("user_id", accountUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("desk_messages")
      .select("content, created_at, sender_type")
      .eq("conversation_id", raw.id as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    ...(raw as unknown as Conversation),
    contact:      accRes.data  ?? undefined,
    last_message: msgRes.data  ?? undefined,
  };
}

const STATUSES: ConversationStatus[] = ["open", "pending", "snoozed", "resolved"];

/**
 * Semântica estilo Intercom: a aba "Aberto" mostra tudo que precisa de atenção —
 * status 'open' E 'pending' (aguardando humano). Uma conversa transferida NÃO
 * some da lista principal; ela continua "aberta" até ser resolvida/pausada.
 * As demais abas continuam 1:1 com o status.
 */
export function statusMatchesTab(tab: ConversationStatus, status: ConversationStatus): boolean {
  if (tab === "open") return status === "open" || status === "pending";
  return status === tab;
}

// ─── Store definition ─────────────────────────────────────────────────────────

export const useInboxStore = create<InboxState>((set, get) => ({
  conversations:        [],
  activeTab:            "open",
  activeConversationId: null,
  searchQuery:          "",
  isLoading:            false,
  priorityFilter:       null,
  priorityInFilter:     null,
  planFilter:           null,
  tabCounts:            { open: 0, pending: 0, snoozed: 0, resolved: 0 },
  _tabCache:            {},
  searchResults:        [],
  isSearching:          false,

  // ── Tab switching ────────────────────────────────────────────────────────────
  setActiveTab: (tab, clearPriority = false) => {
    const { priorityFilter, priorityInFilter, planFilter, _tabCache, activeConversationId, conversations } = get();
    const newPriorityFilter   = clearPriority ? null : priorityFilter;
    const newPriorityInFilter = clearPriority ? null : priorityInFilter;
    const newPlanFilter       = clearPriority ? null : planFilter;
    const hasFilter = !!newPriorityFilter || (newPriorityInFilter?.length ?? 0) > 0 || !!newPlanFilter;

    // Clear active conversation if it doesn't belong to the new tab
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    const newActiveId = activeConv && statusMatchesTab(tab, activeConv.status) ? activeConversationId : null;

    set({
      activeTab: tab,
      activeConversationId: newActiveId,
      priorityFilter: newPriorityFilter,
      priorityInFilter: newPriorityInFilter,
      planFilter: newPlanFilter,
    });

    // Serve from cache if fresh enough and no filter is active
    const cache = _tabCache[tab];
    if (!hasFilter && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
      set({ conversations: cache.conversations });
      return;
    }

    get().loadConversations(tab, newPriorityFilter);
  },

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  // ── Busca global (todas as conversas, qualquer status) ────────────────────────
  // Resolve a limitação da busca em memória: cruza nome/e-mail (account + user_email)
  // e assunto, retornando conversas abertas E fechadas — como o "Buscar" do Intercom.
  searchConversations: async (query) => {
    const q = query.trim();
    if (q.length < 2) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ isSearching: true });

    // 1. e-mails de contas cujo nome/e-mail casam com o termo (visitantes do widget
    //    não têm linha em account, mas têm user_email na conversa — cobrimos os dois).
    const { data: accounts } = await supabase
      .from("account")
      .select("user_id, email")
      .or(`email.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(50);

    const accountUserIds = (accounts ?? []).map((a) => a.user_id as string);

    // 2. busca conversas por: account_user_id (nome/e-mail do CRM), user_email, ou assunto.
    const ors = [`user_email.ilike.%${q}%`, `subject.ilike.%${q}%`];
    if (accountUserIds.length > 0) {
      ors.push(`account_user_id.in.(${accountUserIds.join(",")})`);
    }

    const { data, error } = await supabase
      .from("desk_conversations")
      .select("*")
      .or(ors.join(","))
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error || !data) {
      console.error("[useInboxStore] searchConversations error:", error);
      set({ searchResults: [], isSearching: false });
      return;
    }

    const enriched = await enrichConversations(data as Record<string, unknown>[]);
    set({ searchResults: enriched, isSearching: false });
  },

  // priorityFilter e priorityInFilter são mutuamente exclusivos.
  setPriorityFilter: (priority) => set({ priorityFilter: priority, priorityInFilter: null }),
  setPriorityInFilter: (priorities) => set({ priorityInFilter: priorities, priorityFilter: null }),

  // ── Aplica uma Visualização de forma atômica ──────────────────────────────────
  applyView: ({ status, priority = null, priorityIn = null, plan = null }) => {
    const { activeConversationId, conversations } = get();
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    const newActiveId = activeConv && statusMatchesTab(status, activeConv.status) ? activeConversationId : null;

    // Define TODOS os filtros antes de carregar (set é síncrono no Zustand),
    // evitando a corrida que deixava a lista vazia ao trocar de view.
    set({
      activeTab: status,
      activeConversationId: newActiveId,
      priorityFilter: priorityIn?.length ? null : priority,
      priorityInFilter: priorityIn?.length ? priorityIn : null,
      planFilter: plan,
    });
    get().loadConversations(status, priorityIn?.length ? null : priority, true);
  },

  // ── Load conversations for a tab ─────────────────────────────────────────────
  loadConversations: async (status, priority, force = false) => {
    const { _tabCache, priorityInFilter, planFilter } = get();
    const hasFilter = !!priority || (priorityInFilter?.length ?? 0) > 0 || !!planFilter;

    // Honour cache unless forced. Filtered loads bypass the cache entirely
    // (both read and write) so they never pollute the unfiltered tab list.
    if (!force && !hasFilter) {
      const cache = _tabCache[status];
      if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
        set({ conversations: cache.conversations });
        return;
      }
    }

    set({ isLoading: true });

    // "Aberto" (estilo Intercom) = open + pending; demais abas são 1:1 com o status.
    let query = supabase
      .from("desk_conversations")
      .select("*")
      .order("updated_at", { ascending: false })  // most recently active first
      .limit(100);
    query = status === "open"
      ? query.in("status", ["open", "pending"])
      : query.eq("status", status);

    if (priorityInFilter?.length) query = query.in("priority", priorityInFilter);
    else if (priority)            query = query.eq("priority", priority);

    // Filtro por tag de plano (Visualizações) — desk_conversations.tags @> [plan]
    if (planFilter) query = query.contains("tags", [planFilter]);

    const { data, error } = await query;

    if (error || !data) {
      set({ isLoading: false });
      console.error("[useInboxStore] loadConversations error:", error);
      return;
    }

    const enriched = await enrichConversations(data as Record<string, unknown>[]);

    // Filtered results are transient — do not overwrite the tab cache with them.
    if (hasFilter) {
      set({ conversations: enriched, isLoading: false });
      return;
    }

    set((s) => ({
      conversations: enriched,
      isLoading: false,
      _tabCache: {
        ...s._tabCache,
        [status]: { loadedAt: Date.now(), conversations: enriched },
      },
    }));
  },

  // ── Fetch real counts from DB for all tabs ───────────────────────────────────
  refreshTabCounts: async () => {
    const results = await Promise.all(
      STATUSES.map((status) =>
        supabase
          .from("desk_conversations")
          .select("id", { count: "exact", head: true })
          .eq("status", status)
          .then(({ count }) => ({ status, count: count ?? 0 }))
      )
    );

    const tabCounts = { open: 0, pending: 0, snoozed: 0, resolved: 0 };
    for (const { status, count } of results) tabCounts[status] = count;
    set({ tabCounts });
  },

  // ── Realtime upsert ──────────────────────────────────────────────────────────
  upsertConversation: async (raw) => {
    const { activeTab, activeConversationId, conversations, _tabCache } = get();
    const enriched = await enrichOne(raw);
    const incomingStatus = enriched.status;

    // Always invalidate the cache for both source and target status
    // so the next tab switch forces a fresh load.
    const newCache = { ..._tabCache };
    delete newCache[incomingStatus];

    // If status doesn't match current tab, remove from list (status changed)
    if (!statusMatchesTab(activeTab, incomingStatus)) {
      if (enriched.id === activeConversationId) {
        // Agent is mid-conversation — update data but keep it visible
        set({
          conversations: conversations.map((c) => (c.id === enriched.id ? enriched : c)),
          _tabCache: newCache,
        });
      } else {
        // Evict from current tab's list
        set({
          conversations: conversations.filter((c) => c.id !== enriched.id),
          _tabCache: newCache,
        });
      }
      // Refresh counts so badge on destination tab stays accurate
      get().refreshTabCounts();
      return;
    }

    // Status matches current tab — add or update
    const exists = conversations.some((c) => c.id === enriched.id);
    const updated = exists
      ? conversations.map((c) => (c.id === enriched.id ? enriched : c))
      : [enriched, ...conversations];

    // Sort by updated_at DESC to keep most recently active at top
    updated.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    set({
      conversations: updated,
      _tabCache: { ...newCache, [activeTab]: { loadedAt: Date.now(), conversations: updated } },
    });

    get().refreshTabCounts();
  },

  removeConversation: (id) => {
    const { conversations, activeTab, _tabCache } = get();
    const updated = conversations.filter((c) => c.id !== id);

    set((s) => ({
      conversations: updated,
      _tabCache: {
        ...s._tabCache,
        [activeTab]: { loadedAt: Date.now(), conversations: updated },
      },
    }));

    // Decrement the count for the active tab immediately (no extra round-trip)
    set((s) => ({
      tabCounts: {
        ...s.tabCounts,
        [activeTab]: Math.max(0, s.tabCounts[activeTab] - 1),
      },
    }));

    void _tabCache; // suppress unused warning
  },
}));
