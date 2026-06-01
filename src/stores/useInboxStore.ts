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
  /** Counts per status fetched from the DB — used for tab badges */
  tabCounts: Record<ConversationStatus, number>;
  /** Per-tab cache to avoid redundant reloads within a short window */
  _tabCache: Partial<Record<ConversationStatus, TabCache>>;

  // Actions
  setActiveTab: (tab: ConversationStatus, clearPriority?: boolean) => void;
  setActiveConversationId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setPriorityFilter: (priority: ConversationPriority | null) => void;
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

  const accountIds = [...new Set(rows.map((r) => r.account_user_id as string))];
  const convIds    = rows.map((r) => r.id as string);

  const [accountsRes, msgsRes] = await Promise.all([
    supabase
      .from("account")
      .select("user_id, name, email, phone")
      .in("user_id", accountIds),
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
  const [accRes, msgRes] = await Promise.all([
    supabase
      .from("account")
      .select("user_id, name, email, phone")
      .eq("user_id", raw.account_user_id as string)
      .maybeSingle(),
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

// ─── Store definition ─────────────────────────────────────────────────────────

export const useInboxStore = create<InboxState>((set, get) => ({
  conversations:        [],
  activeTab:            "open",
  activeConversationId: null,
  searchQuery:          "",
  isLoading:            false,
  priorityFilter:       null,
  tabCounts:            { open: 0, pending: 0, snoozed: 0, resolved: 0 },
  _tabCache:            {},

  // ── Tab switching ────────────────────────────────────────────────────────────
  setActiveTab: (tab, clearPriority = false) => {
    const { priorityFilter, _tabCache, activeConversationId, conversations } = get();
    const newPriorityFilter = clearPriority ? null : priorityFilter;

    // Clear active conversation if it doesn't belong to the new tab
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    const newActiveId = activeConv?.status === tab ? activeConversationId : null;

    set({ activeTab: tab, activeConversationId: newActiveId, priorityFilter: newPriorityFilter });

    // Serve from cache if fresh enough and no priority filter is active
    const cache = _tabCache[tab];
    if (!newPriorityFilter && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
      set({ conversations: cache.conversations });
      return;
    }

    get().loadConversations(tab, newPriorityFilter);
  },

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setPriorityFilter: (priority) => set({ priorityFilter: priority }),

  // ── Load conversations for a tab ─────────────────────────────────────────────
  loadConversations: async (status, priority, force = false) => {
    const { _tabCache } = get();

    // Honour cache unless forced
    if (!force && !priority) {
      const cache = _tabCache[status];
      if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
        set({ conversations: cache.conversations });
        return;
      }
    }

    set({ isLoading: true });

    let query = supabase
      .from("desk_conversations")
      .select("*")
      .eq("status", status)
      .order("updated_at", { ascending: false })  // most recently active first
      .limit(100);

    if (priority) query = query.eq("priority", priority);

    const { data, error } = await query;

    if (error || !data) {
      set({ isLoading: false });
      console.error("[useInboxStore] loadConversations error:", error);
      return;
    }

    const enriched = await enrichConversations(data as Record<string, unknown>[]);

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
    if (incomingStatus !== activeTab) {
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
