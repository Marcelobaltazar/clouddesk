import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInboxStore } from "@/stores/useInboxStore";
import { useConversationStore, type Message } from "@/stores/useConversationStore";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Bot, Lock, Info, CheckCircle, Send, MessageSquare, UserPlus, Clock, BookOpen, Reply, Search, Zap } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Snooze options ─────────────────────────────────────────────────────────
// Each option resolves to an absolute datetime relative to "now".

interface SnoozeOption {
  label: string;
  resolve: () => Date;
}

const SNOOZE_OPTIONS: SnoozeOption[] = [
  {
    label: "Daqui a 1 hora",
    resolve: () => new Date(Date.now() + 60 * 60 * 1000),
  },
  {
    label: "Daqui a 4 horas",
    resolve: () => new Date(Date.now() + 4 * 60 * 60 * 1000),
  },
  {
    label: "Amanhã de manhã (9h)",
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Próxima semana",
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

// ─── Knowledge base article type (search result) ───────────────────────────────

interface KbArticle {
  id: string;
  title: string;
  content: string;
}

// ─── Snippet type (resposta rápida reutilizável) ───────────────────────────────

interface Snippet {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  category: string | null;
}

// Remove sintaxe Markdown comum, deixando texto limpo e legível para o cliente.
function stripMarkdown(input: string): string {
  return input
    // imagens ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // links [texto](url) → texto
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // code fences ```lang ... ```
    .replace(/```[^\n]*\n?/g, "")
    // headings (#, ##, ...) no início da linha
    .replace(/^#{1,6}\s+/gm, "")
    // citações (>) no início da linha
    .replace(/^>\s?/gm, "")
    // marcadores de lista (-, *, +) no início da linha
    .replace(/^\s*[-*+]\s+/gm, "")
    // negrito/itálico ** * __ _
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // código inline `texto`
    .replace(/`([^`]*)`/g, "$1")
    // regras horizontais
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, "")
    // colapsa 3+ quebras de linha em 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Priority config ──────────────────────────────────────────────────────────

const priorityLabels: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgente", cls: "bg-priority-urgent text-primary-foreground" },
  high:   { label: "Alta",    cls: "bg-priority-high text-primary-foreground"   },
  medium: { label: "Média",   cls: "bg-priority-medium text-primary-foreground" },
  low:    { label: "Baixa",   cls: "bg-priority-low text-primary-foreground"    },
};

// ─── Component ────────────────────────────────────────────────────────────────

// Shared broadcast channel name — both operator and widget subscribe to this.
// Format must match exactly what ChatWidgetThread.tsx expects.
export const convLiveChannelName = (id: string) => `conv-live:${id}`;

export function ConversationThread() {
  const { activeConversationId, conversations } = useInboxStore();
  const { messages, isLoadingMessages, loadMessages, addMessage, clearMessages, applySlaPolicy, crmInfo } = useConversationStore();
  const agent = useAuthStore((s) => s.agent);

  const scrollRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Ref to the broadcast channel so handleSend can call .send() without closure issues
  const broadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Latest handlers — used by the global keyboard effects so they don't need to
  // re-bind on every render (they read the freshest closure via these refs).
  const assignToMeRef     = useRef<(() => void) | null>(null);
  const sendAndResolveRef = useRef<(() => void) | null>(null);

  const [content, setContent]   = useState("");
  // Composer mode: "reply" (público) ou "note" (nota interna)
  const [mode, setMode]         = useState<"reply" | "note">("reply");
  const [sending, setSending]   = useState(false);

  // Snooze dropdown (also opened via keyboard shortcut Z)
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // KB insert popover (Ctrl+Shift+H)
  const [kbOpen, setKbOpen]         = useState(false);
  const [kbQuery, setKbQuery]       = useState("");
  const [kbResults, setKbResults]   = useState<KbArticle[]>([]);
  const [kbLoading, setKbLoading]   = useState(false);

  // Snippets picker (respostas rápidas) — item 5
  const [snippetOpen, setSnippetOpen]   = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippets, setSnippets]         = useState<Snippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);

  const isNote = mode === "note";
  const conversation = conversations.find((c) => c.id === activeConversationId);

  // ── Broadcast channel: keep open while a conversation is active ─────────────
  // The operator uses this channel to push new messages to the widget instantly,
  // bypassing postgres_changes (which requires the table to be in the Realtime
  // publication — a backend config that may not be set up yet).
  useEffect(() => {
    if (!activeConversationId) {
      if (broadcastRef.current) {
        supabase.removeChannel(broadcastRef.current);
        broadcastRef.current = null;
      }
      return;
    }

    const ch = supabase.channel(convLiveChannelName(activeConversationId));
    ch.subscribe((status) => {
      console.log(`[Operator broadcast] channel ${convLiveChannelName(activeConversationId)} → ${status}`);
    });
    broadcastRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      broadcastRef.current = null;
    };
  }, [activeConversationId]);

  // ── Load messages when active conversation changes ──────────────────────────
  useEffect(() => {
    if (!activeConversationId) {
      clearMessages();
      return;
    }
    loadMessages(activeConversationId);
    // Reset composer state when moving to another conversation
    setMode("reply");
    setSnoozeOpen(false);
    setKbOpen(false);
    setSnippetOpen(false);
  }, [activeConversationId, loadMessages, clearMessages]);

  // ── Mark conversation as first seen by agent ────────────────────────────────
  useEffect(() => {
    if (!activeConversationId || !conversation) return;

    // first_seen_by_agent_at may not exist on the type yet — cast to access safely
    const conv = conversation as typeof conversation & { first_seen_by_agent_at?: string | null };
    if (conv.first_seen_by_agent_at) return; // already seen

    supabase
      .from("desk_conversations")
      .update({ first_seen_by_agent_at: new Date().toISOString() })
      .eq("id", activeConversationId)
      .then(({ error }) => {
        if (error) console.warn("[ConversationThread] first_seen update failed:", error.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // ── Realtime: subscribe to new messages in this conversation ────────────────
  useEffect(() => {
    if (!activeConversationId) return;

    const channel = supabase
      .channel(`thread-messages:${activeConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "desk_messages",
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          addMessage(payload.new as Message);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversationId, addMessage]);

  // ── Auto-scroll to bottom on new messages ──────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  // ── Knowledge base search (Item 4) ──────────────────────────────────────────
  const searchKb = useCallback(async (term: string) => {
    if (!term.trim()) {
      setKbResults([]);
      return;
    }
    setKbLoading(true);
    const { data, error } = await supabase
      .from("desk_knowledge_base")
      .select("id, title, content")
      .ilike("title", `%${term.trim()}%`)
      .eq("is_published", true)
      .limit(5);

    setKbLoading(false);
    if (error) {
      console.warn("[ConversationThread] KB search failed:", error.message);
      setKbResults([]);
      return;
    }
    setKbResults((data ?? []) as KbArticle[]);
  }, []);

  // Debounce the KB search as the operator types
  useEffect(() => {
    if (!kbOpen) return;
    const t = setTimeout(() => searchKb(kbQuery), 250);
    return () => clearTimeout(t);
  }, [kbQuery, kbOpen, searchKb]);

  // ── Snippets: carga preguiçosa na primeira abertura (lista pequena) ──────────
  const loadSnippets = useCallback(async () => {
    const { data, error } = await supabase
      .from("desk_snippets")
      .select("id, title, content, shortcut, category")
      .order("title");
    if (error) {
      console.warn("[ConversationThread] snippets load failed:", error.message);
      return;
    }
    setSnippets((data ?? []) as Snippet[]);
    setSnippetsLoaded(true);
  }, []);

  useEffect(() => {
    if (snippetOpen && !snippetsLoaded) loadSnippets();
  }, [snippetOpen, snippetsLoaded, loadSnippets]);

  const filteredSnippets = (() => {
    const q = snippetQuery.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.shortcut?.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q),
    );
  })();

  // ── Global keyboard shortcuts (Item 1 + Item 2) ─────────────────────────────
  // R → reply · N → note · Z → snooze · A → assign to me
  // Hooks must run unconditionally (before any early return), so the active
  // conversation is read from the store inside the handler at event time.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when modifier keys are held (let real shortcuts through)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const { activeConversationId: convId, conversations: convs } = useInboxStore.getState();
      const conv = convs.find((c) => c.id === convId);
      if (!conv || conv.status === "resolved") return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typingFreeText =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable === true;

      // While typing, only allow R/N to switch composer mode when the composer
      // textarea is empty — otherwise letters must pass through to the message.
      const inComposer = target === textareaRef.current;
      const key = e.key.toLowerCase();

      if (key === "r" || key === "n") {
        if (typingFreeText && !(inComposer && textareaRef.current?.value.trim() === "")) return;
        e.preventDefault();
        setMode(key === "r" ? "reply" : "note");
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }

      // Z / A only when not typing free text
      if (typingFreeText) return;

      if (key === "z") {
        e.preventDefault();
        setSnoozeOpen(true);
      } else if (key === "a" && conv.assigned_agent_id !== agent?.id) {
        e.preventDefault();
        assignToMeRef.current?.();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [agent?.id]);

  // ── Ctrl+Shift+H → open KB insert popover ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        const { activeConversationId: convId, conversations: convs } = useInboxStore.getState();
        const conv = convs.find((c) => c.id === convId);
        if (!conv || conv.status === "resolved") return;
        e.preventDefault();
        setKbOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Ctrl-combo shortcuts: Ctrl+Enter (resolver) · Ctrl+[ / Ctrl+] (navegar) ──
  // These work regardless of focus, so they read state from the store at event
  // time and call the latest handlers via refs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;

      const store = useInboxStore.getState();
      const convs = store.conversations;
      const convId = store.activeConversationId;

      // Ctrl+Enter → enviar mensagem e resolver conversa
      if (e.key === "Enter") {
        const conv = convs.find((c) => c.id === convId);
        if (!conv || conv.status === "resolved") return;
        e.preventDefault();
        sendAndResolveRef.current?.();
        return;
      }

      // Ctrl+[ / Ctrl+] → navegar entre conversas da aba atual
      if (e.key === "[" || e.key === "]") {
        if (convs.length === 0) return;
        e.preventDefault();
        const idx = convs.findIndex((c) => c.id === convId);
        // Sem conversa ativa: [ vai pra última, ] vai pra primeira
        const nextIdx =
          idx === -1
            ? e.key === "]" ? 0 : convs.length - 1
            : e.key === "]"
            ? Math.min(idx + 1, convs.length - 1)
            : Math.max(idx - 1, 0);
        store.setActiveConversationId(convs[nextIdx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!activeConversationId || !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Selecione uma conversa</p>
          <p className="text-xs mt-1 opacity-70">Escolha uma conversa na lista para começar</p>
        </div>
      </div>
    );
  }

  const contactName = conversation.contact?.name || conversation.contact?.email || "Visitante";
  const prio = priorityLabels[conversation.priority] ?? priorityLabels.medium;

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleAssignToMe = async () => {
    if (!agent) return;
    const { error } = await supabase
      .from("desk_conversations")
      .update({ assigned_agent_id: agent.id, updated_at: new Date().toISOString() })
      .eq("id", activeConversationId!);

    if (error) { toast.error("Erro ao atribuir conversa"); return; }

    await supabase.from("desk_messages").insert({
      conversation_id: activeConversationId,
      sender_type: "system",
      content: `Conversa atribuída para ${agent.name}`,
    });
  };
  assignToMeRef.current = handleAssignToMe;

  const handleResolve = async () => {
    const { error } = await supabase
      .from("desk_conversations")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", activeConversationId);

    if (error) toast.error("Erro ao resolver conversa");
  };

  const handleSnooze = async (option: SnoozeOption) => {
    const until = option.resolve();
    const { error } = await supabase
      .from("desk_conversations")
      .update({
        status: "snoozed",
        snoozed_until: until.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeConversationId!);

    setSnoozeOpen(false);

    if (error) {
      toast.error("Erro ao adiar conversa");
      return;
    }
    toast.success(`Conversa adiada · ${option.label.toLowerCase()}`);
  };

  const handleChangePriority = async (priority: string) => {
    const { error } = await supabase
      .from("desk_conversations")
      .update({ priority })
      .eq("id", activeConversationId!);

    if (error) {
      toast.error("Erro ao alterar prioridade");
      return;
    }

    // Apply SLA policy: use CRM product (plan name) if available, else fall back to null (global policy)
    await applySlaPolicy(activeConversationId!, priority, crmInfo?.product ?? null);
  };

  const handleSend = async (opts?: { resolveAfter?: boolean }) => {
    const resolveAfter = opts?.resolveAfter ?? false;

    // Ctrl+Enter on an empty composer → just resolve (nothing to send).
    if (!content.trim()) {
      if (resolveAfter && conversation.status !== "resolved") await handleResolve();
      return;
    }
    if (!agent) return;
    setSending(true);

    try {
      // Use .select().single() to get the inserted row back with DB-generated
      // id and created_at — needed to broadcast the complete message to the widget.
      const { data: insertedMsg, error } = await supabase
        .from("desk_messages")
        .insert({
          conversation_id: activeConversationId,
          sender_type: "agent",
          sender_id: agent.id,
          content: content.trim(),
          is_private_note: isNote,
          content_type: isNote ? "note" : "text",
          ai_generated: false,
        })
        .select("id, conversation_id, sender_type, content, created_at, ai_generated, is_private_note")
        .single();

      if (error) throw error;

      // Broadcast to widget via shared channel.
      // This is the reliable path — works even if postgres_changes isn't configured.
      if (insertedMsg && broadcastRef.current) {
        broadcastRef.current.send({
          type: "broadcast",
          event: "new_message",
          payload: insertedMsg,
        });
        console.log("[Operator broadcast] sent message to widget:", insertedMsg.id);
      }

      // Status after send:
      //  - Ctrl+Enter (resolveAfter) on a public reply → resolve the conversation
      //  - replying to a pending conversation → move it back to open
      //  - otherwise just bump updated_at so Realtime propagates to ConversationList
      const now = new Date().toISOString();
      const statusUpdate =
        resolveAfter && !isNote
          ? { status: "resolved", resolved_at: now, updated_at: now }
          : !isNote && conversation.status === "pending"
          ? { status: "open", updated_at: now }
          : { updated_at: now };

      await supabase
        .from("desk_conversations")
        .update(statusUpdate)
        .eq("id", activeConversationId);

      setContent("");
      setMode("reply");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Erro ao enviar mensagem", { description: msg });
    } finally {
      setSending(false);
    }
  };

  sendAndResolveRef.current = () => handleSend({ resolveAfter: true });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter (enviar e resolver) é tratado pelo listener global —
    // deixamos passar aqui para não disparar duas vezes.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return;
    // Enter → enviar
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertArticle = (article: KbArticle) => {
    // Correção 2: o cliente recebe texto limpo, não markdown cru.
    const excerpt = stripMarkdown(article.content).slice(0, 300).trimEnd();
    const title = stripMarkdown(article.title);
    const snippet = `${title}\n\n${excerpt}...\n\nLeia o artigo completo na nossa base de conhecimento.`;
    setContent((prev) => (prev.trim() ? `${prev}\n\n${snippet}` : snippet));
    setMode("reply");
    setKbOpen(false);
    setKbQuery("");
    setKbResults([]);
    // Return focus to the composer after inserting
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertSnippet = (snippet: Snippet) => {
    // Insere o conteúdo do snippet no composer (respeita o que já foi digitado).
    setContent((prev) => (prev.trim() ? `${prev}\n\n${snippet.content}` : snippet.content));
    setMode("reply");
    setSnippetOpen(false);
    setSnippetQuery("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">

      {/* ── Header ── */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0 bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-muted-foreground">
              {contactName[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-card-foreground truncate">{contactName}</h2>
            <p className="text-[10px] text-muted-foreground capitalize">
              {conversation.channel} · {conversation.status}
              {conversation.ai_active && (
                <span className="ml-1 text-primary">· IA ativa</span>
              )}
            </p>
          </div>
        </div>

        <TooltipProvider delayDuration={500}>
          <div className="flex items-center gap-2 shrink-0">
            {/* Priority badge */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Badge className={cn("cursor-pointer text-[10px] select-none", prio.cls)}>
                  {prio.label}
                </Badge>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {Object.entries(priorityLabels).map(([k, v]) => (
                  <DropdownMenuItem key={k} onClick={() => handleChangePriority(k)}>
                    {v.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {conversation.status !== "resolved" && (
              <>
                {/* Assign to me / assigned badge */}
                {conversation.assigned_agent_id === agent?.id ? (
                  <Badge variant="outline" className="text-[10px] h-7 px-2 border-primary/40 text-primary">
                    Você
                  </Badge>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAssignToMe}
                        className="text-xs h-7 gap-1"
                      >
                        <UserPlus className="h-3 w-3" />
                        Atribuir a mim
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Atribuir a mim · A</TooltipContent>
                  </Tooltip>
                )}

                {/* Snooze button + dropdown (Z) */}
                <DropdownMenu open={snoozeOpen} onOpenChange={setSnoozeOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 gap-1"
                        >
                          <Clock className="h-3 w-3" />
                          Adiar
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Adiar · Z</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    {SNOOZE_OPTIONS.map((opt) => (
                      <DropdownMenuItem key={opt.label} onClick={() => handleSnooze(opt)}>
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Resolve button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleResolve}
                      className="text-xs h-7 gap-1"
                    >
                      <CheckCircle className="h-3 w-3" />
                      Resolver
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Resolver · Ctrl Enter</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3"
      >
        {isLoadingMessages ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <Info className="h-6 w-6 opacity-30" />
            <p>Nenhuma mensagem ainda</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} agentId={agent?.id} />
          ))
        )}
      </div>

      {/* ── Composer ── */}
      {conversation.status !== "resolved" && (
        <TooltipProvider delayDuration={500}>
          <div
            className={cn(
              "border-t border-border p-3 shrink-0 transition-colors",
              isNote ? "bg-bubble-note/30" : "bg-card"
            )}
          >
            {/* Mode toggle (Item 1) */}
            <div className="flex items-center gap-1 mb-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setMode("reply")}
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors",
                      !isNote
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface"
                    )}
                  >
                    <Reply className="h-3 w-3" />
                    Resposta
                  </button>
                </TooltipTrigger>
                <TooltipContent>Responder · R</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setMode("note")}
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors",
                      isNote
                        ? "bg-amber-500 text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface"
                    )}
                  >
                    <Lock className="h-3 w-3" />
                    Nota interna
                  </button>
                </TooltipTrigger>
                <TooltipContent>Nota interna · N</TooltipContent>
              </Tooltip>
            </div>

            {/* Textarea — amber border in note mode (Item 1) */}
            <div
              className={cn(
                "flex items-end gap-2 rounded-lg border px-3 py-2 transition-colors",
                isNote ? "border-amber-500/60 bg-bubble-note/20" : "border-border bg-surface"
              )}
            >
              <Textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isNote
                    ? "Escreva uma nota interna... (visível só para operadores)"
                    : "Digite sua mensagem... (Enter para enviar)"
                }
                className="min-h-[40px] max-h-32 resize-none border-none bg-transparent p-0 text-sm focus-visible:ring-0 placeholder:text-muted-foreground"
                rows={1}
              />
              <div className="flex items-center gap-1 shrink-0">
                {/* Insert snippet / resposta rápida (item 5) */}
                <Popover open={snippetOpen} onOpenChange={setSnippetOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Resposta rápida</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-80 p-0">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={snippetQuery}
                          onChange={(e) => setSnippetQuery(e.target.value)}
                          placeholder="Buscar resposta rápida..."
                          className="pl-8 h-9 text-sm"
                        />
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin p-1">
                      {!snippetsLoaded ? (
                        <div className="p-3 space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ) : filteredSnippets.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {snippets.length === 0
                            ? "Nenhuma resposta rápida cadastrada"
                            : "Nenhum resultado"}
                        </p>
                      ) : (
                        filteredSnippets.map((snippet) => (
                          <button
                            key={snippet.id}
                            onClick={() => insertSnippet(snippet)}
                            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface transition-colors"
                          >
                            <p className="text-xs font-medium text-card-foreground truncate flex items-center gap-1.5">
                              {snippet.title}
                              {snippet.shortcut && (
                                <span className="text-[9px] text-muted-foreground font-mono">
                                  {snippet.shortcut}
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {snippet.content.slice(0, 80)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Insert KB article (Item 4) */}
                <Popover open={kbOpen} onOpenChange={setKbOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                        >
                          <BookOpen className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Inserir artigo · Ctrl Shift H</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-80 p-0">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={kbQuery}
                          onChange={(e) => setKbQuery(e.target.value)}
                          placeholder="Buscar artigo..."
                          className="pl-8 h-9 text-sm"
                        />
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin p-1">
                      {kbLoading ? (
                        <div className="p-3 space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ) : kbResults.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {kbQuery.trim() ? "Nenhum artigo encontrado" : "Digite para buscar artigos"}
                        </p>
                      ) : (
                        kbResults.map((article) => (
                          <button
                            key={article.id}
                            onClick={() => insertArticle(article)}
                            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface transition-colors"
                          >
                            <p className="text-xs font-medium text-card-foreground truncate">
                              {article.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {article.content.slice(0, 80)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleSend}
                      disabled={!content.trim() || sending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isNote ? "Salvar nota" : "Enviar"} · Enter</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {isNote && (
              <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" />
                Nota interna — visível apenas para operadores
              </p>
            )}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  agentId,
}: {
  message: Message;
  agentId?: string;
}) {
  const time = format(new Date(message.created_at), "HH:mm", { locale: ptBR });

  // System message — centered pill
  if (message.sender_type === "system") {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] bg-bubble-system text-bubble-system-foreground px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  // Private note — amber full-width
  if (message.is_private_note) {
    return (
      <div className="max-w-[75%] ml-auto animate-fade-in">
        <div className="bg-bubble-note text-bubble-note-foreground rounded-lg px-3 py-2">
          <div className="flex items-center gap-1 mb-1">
            <Lock className="h-3 w-3" />
            <span className="text-[10px] font-medium">Nota interna</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          <span className="text-[10px] opacity-60 mt-1 block">{time}</span>
        </div>
      </div>
    );
  }

  const isContact = message.sender_type === "contact";
  const isBot = message.sender_type === "bot" || message.ai_generated;

  return (
    <div className={cn("flex animate-fade-in", isContact ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2",
          isContact
            ? "bg-bubble-contact text-bubble-contact-foreground"
            : isBot
            ? "bg-bubble-bot text-bubble-bot-foreground"
            : "bg-bubble-agent text-bubble-agent-foreground"
        )}
      >
        {isBot && (
          <div className="flex items-center gap-1 mb-1 opacity-80">
            <Bot className="h-3 w-3" />
            <span className="text-[10px] font-medium">IA</span>
          </div>
        )}
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <span className="text-[10px] opacity-60 mt-1 block">{time}</span>
      </div>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function MessagesSkeleton() {
  return (
    <div className="space-y-4">
      {[false, true, false, false, true].map((right, i) => (
        <div key={i} className={cn("flex", right ? "justify-end" : "justify-start")}>
          <Skeleton className={cn("h-10 rounded-lg", right ? "w-48" : "w-56")} />
        </div>
      ))}
    </div>
  );
}
