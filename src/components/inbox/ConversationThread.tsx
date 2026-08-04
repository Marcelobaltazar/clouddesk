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
import { Bot, Lock, Info, CheckCircle, Send, MessageSquare, UserPlus, Clock, BookOpen, Reply, Search, Zap, Sparkles, Loader2, RotateCcw, Mail, MoreHorizontal, GitMerge } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { broadcastConvUpdated } from "@/lib/conv-broadcast";
import { MergeDialog } from "./MergeDialog";

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
  urgent: { label: "Urgente", cls: "bg-rose-100 text-rose-700 hover:bg-rose-100"    },
  high:   { label: "Alta",    cls: "bg-orange-100 text-orange-700 hover:bg-orange-100" },
  medium: { label: "Média",   cls: "bg-muted text-muted-foreground hover:bg-muted"  },
  low:    { label: "Baixa",   cls: "bg-muted text-muted-foreground hover:bg-muted"  },
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
  // Copilot: gerando rascunho de resposta com IA
  const [suggesting, setSuggesting] = useState(false);

  // Snooze dropdown (also opened via keyboard shortcut Z)
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Merge dialog (Ctrl+Shift+M) — mesclar chamados do mesmo cliente
  const [mergeOpen, setMergeOpen] = useState(false);

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
  // true quando o picker foi aberto digitando "/" no composer (vs. botão ⚡).
  // Nesse modo, ao inserir o snippet limpamos o texto "/query" do composer.
  const [snippetSlashMode, setSnippetSlashMode] = useState(false);

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

      // Dentro de qualquer campo de texto, letra é TEXTO — nunca atalho. Antes,
      // R/N eram capturados no composer vazio e comiam a primeira letra de
      // palavras como "Não" ou "Recebemos" (sobrava "ão"). Atalhos de letra só
      // valem com o foco FORA de input/textarea/contenteditable.
      if (typingFreeText) return;

      const key = e.key.toLowerCase();

      if (key === "r" || key === "n") {
        e.preventDefault();
        setMode(key === "r" ? "reply" : "note");
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }

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
      // Ctrl+Shift+M → mesclar com outra conversa do mesmo cliente
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        const { activeConversationId: convId } = useInboxStore.getState();
        if (!convId) return;
        e.preventDefault();
        setMergeOpen(true);
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
      <div className="flex-1 panel flex items-center justify-center min-w-0">
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
    // Widget mostra "✅ Atendente conectado" e destrava o composer
    void broadcastConvUpdated(activeConversationId!, { assigned_agent_id: agent.id });
  };
  assignToMeRef.current = handleAssignToMe;

  const handleResolve = async () => {
    // P6: ao encerrar o atendimento humano, a IA volta a ficar ATIVA. Se o
    // cliente reabrir/mandar nova mensagem, a IA atende de novo sem precisar de
    // religamento manual. (No fluxo do widget uma nova mensagem numa conversa
    // resolvida abre um chamado NOVO, que já nasce com ai_active=true — este
    // religamento cobre o caso de a mesma conversa ser reaberta pelo operador.)
    const { error } = await supabase
      .from("desk_conversations")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), ai_active: true })
      .eq("id", activeConversationId);

    if (error) { toast.error("Erro ao resolver conversa"); return; }
    // Widget mostra o CSAT ao receber status resolved
    void broadcastConvUpdated(activeConversationId!, { status: "resolved", ai_active: true });
  };

  // Reabre uma conversa resolvida (o cliente também reabre implicitamente ao
  // mandar mensagem nova — via desk-ai-respond; aqui é o caminho manual do operador).
  const handleReopen = async () => {
    const { error } = await supabase
      .from("desk_conversations")
      .update({ status: "open", resolved_at: null, updated_at: new Date().toISOString() })
      .eq("id", activeConversationId);

    if (error) { toast.error("Erro ao reabrir conversa"); return; }

    await supabase.from("desk_messages").insert({
      conversation_id: activeConversationId,
      sender_type: "system",
      content: "Conversa reaberta pelo atendimento",
    });
    void broadcastConvUpdated(activeConversationId!, { status: "open" });
    toast.success("Conversa reaberta");
  };

  // Pausar / reativar a IA na conversa (handoff humano ↔ IA — CLAUDE.md §7.7).
  const handleToggleAI = async () => {
    if (!conversation) return;
    const next = !conversation.ai_active;
    // Reativar a IA precisa também tirar a conversa de 'pending'/'resolved': o
    // guard do pipeline bloqueia por QUALQUER um dos três (ai_active=false,
    // pending, resolved). Sem reabrir, o toggle acende mas a IA segue muda.
    const convUpdate: { ai_active: boolean; updated_at: string; status?: string; resolved_at?: null } = {
      ai_active: next,
      updated_at: new Date().toISOString(),
    };
    if (next && (conversation.status === "pending" || conversation.status === "resolved")) {
      convUpdate.status = "open";
      convUpdate.resolved_at = null;
    }

    const { error } = await supabase
      .from("desk_conversations")
      .update(convUpdate)
      .eq("id", activeConversationId!);

    if (error) { toast.error("Erro ao alterar a IA"); return; }

    await supabase.from("desk_messages").insert({
      conversation_id: activeConversationId,
      sender_type: "system",
      content: next ? "IA reativada nesta conversa" : "IA pausada — atendimento humano assumiu",
    });
    void broadcastConvUpdated(activeConversationId!, {
      ai_active: next,
      ...(convUpdate.status ? { status: convUpdate.status } : {}),
    });
    toast.success(next ? "IA reativada" : "IA pausada");
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

    // ── Canal E-MAIL: resposta pública sai pela Gmail API (support@cloudfy.email)
    // via desk-send-email. Notas internas seguem o fluxo normal (só no banco).
    if (conversation.channel === "email" && !isNote) {
      try {
        const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
          "desk-send-email",
          {
            body: {
              conversation_id: activeConversationId,
              text: content.trim(),
              agent_id: agent.id,
              agent_name: agent.name,
              resolve: resolveAfter,
            },
          },
        );
        if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "Falha ao enviar e-mail");
        setContent("");
        setMode("reply");
        // A mensagem 'agent' e o estado da conversa são gravados server-side;
        // o Realtime da inbox atualiza a lista.
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        toast.error("Erro ao enviar e-mail", { description: msg });
      } finally {
        setSending(false);
      }
      return;
    }

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
      // Handoff humano (CLAUDE.md §7.7): a primeira resposta PÚBLICA do operador
      // pausa a IA (ai_active=false) — sem isto a IA continuava respondendo em
      // paralelo com o atendente. Reativação é manual (botão "Reativar IA").
      const now = new Date().toISOString();
      const pauseAI = !isNote && conversation.ai_active;
      const statusUpdate: Record<string, unknown> =
        resolveAfter && !isNote
          ? { status: "resolved", resolved_at: now, updated_at: now }
          : !isNote && conversation.status === "pending"
          ? { status: "open", updated_at: now }
          : { updated_at: now };
      if (pauseAI) statusUpdate.ai_active = false;

      // Métrica de 1ª resposta: primeira resposta pública (humana) preenche
      // first_response_at se a IA ainda não tiver respondido antes.
      if (!isNote) {
        await supabase
          .from("desk_conversations")
          .update({ first_response_at: now })
          .eq("id", activeConversationId)
          .is("first_response_at", null);
      }

      await supabase
        .from("desk_conversations")
        .update(statusUpdate)
        .eq("id", activeConversationId);

      // Notifica o widget das mudanças de estado (resolved / open / IA pausada)
      const convUpdate: { status?: string; ai_active?: boolean } = {};
      if (typeof statusUpdate.status === "string") convUpdate.status = statusUpdate.status;
      if (pauseAI) convUpdate.ai_active = false;
      if (Object.keys(convUpdate).length > 0) {
        void broadcastConvUpdated(activeConversationId!, convUpdate);
      }

      // Mensagem de sistema visível ao cliente marcando o handoff (só quando a IA
      // acabou de ser pausada — evita spam a cada resposta).
      if (pauseAI) {
        await supabase.from("desk_messages").insert({
          conversation_id: activeConversationId,
          sender_type: "system",
          content: "IA pausada — atendimento humano assumiu",
        });
      }

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

  // ── Copilot: rascunho de resposta gerado pela IA ─────────────────────────────
  // Usa o MESMO pipeline de contexto da IA do widget (dados do cliente, infra,
  // RAG na base de conhecimento, histórico) em modo draft — nada é enviado ao
  // cliente; o texto cai no composer para o operador revisar e enviar.
  const handleSuggestReply = async () => {
    if (suggesting) return;

    const lastContactMsg = [...messages].reverse().find((m) => m.sender_type === "contact");
    if (!lastContactMsg) {
      toast.info("Sem mensagem do cliente para responder");
      return;
    }

    setSuggesting(true);
    try {
      // O pipeline deriva nome/e-mail da própria conversa (server-side) —
      // nada de identidade vinda do body.
      const { data, error } = await supabase.functions.invoke<{ reply: string | null }>(
        "desk-ai-respond",
        {
          body: {
            conversation_id: activeConversationId,
            message: lastContactMsg.content,
            mode: "draft",
          },
        },
      );

      if (error) throw new Error(error.message);
      if (!data?.reply) throw new Error("A IA não retornou sugestão");

      setMode("reply");
      setContent((prev) => (prev.trim() ? `${prev}\n\n${data.reply}` : data.reply ?? ""));
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Não consegui gerar a sugestão", { description: msg });
    } finally {
      setSuggesting(false);
    }
  };

  // Detecta o trigger "/": se o texto começa com "/" (sem espaço logo após),
  // abre o picker de snippets e usa o que vem depois da "/" como busca.
  const handleContentChange = (value: string) => {
    setContent(value);

    const slashMatch = !isNote && /^\/(\S*)$/.test(value);
    if (slashMatch) {
      const query = value.slice(1);
      setSnippetSlashMode(true);
      setSnippetQuery(query);
      if (!snippetOpen) setSnippetOpen(true);
    } else if (snippetSlashMode) {
      // Saiu do padrão "/..." → fecha o picker do modo slash.
      setSnippetSlashMode(false);
      setSnippetOpen(false);
      setSnippetQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter (enviar e resolver) é tratado pelo listener global —
    // deixamos passar aqui para não disparar duas vezes.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return;
    // Com o picker de snippets aberto via "/", Enter insere o primeiro resultado.
    if (snippetSlashMode && snippetOpen && e.key === "Enter" && !e.shiftKey) {
      if (filteredSnippets.length > 0) {
        e.preventDefault();
        insertSnippet(filteredSnippets[0]);
        return;
      }
    }
    // Escape fecha o picker do modo slash sem limpar o texto.
    if (snippetSlashMode && e.key === "Escape") {
      setSnippetSlashMode(false);
      setSnippetOpen(false);
      return;
    }
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
    // No modo slash o composer contém apenas "/query" → substitui pelo conteúdo.
    // Pelo botão ⚡ → anexa ao texto já digitado.
    if (snippetSlashMode) {
      setContent(snippet.content);
    } else {
      setContent((prev) => (prev.trim() ? `${prev}\n\n${snippet.content}` : snippet.content));
    }
    setMode("reply");
    setSnippetOpen(false);
    setSnippetQuery("");
    setSnippetSlashMode(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="flex-1 panel flex flex-col min-w-0 overflow-hidden">

      {/* ── Header ── */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-card-foreground truncate">{contactName}</h2>
            <p className="text-[11px] text-muted-foreground capitalize">
              {conversation.channel} · {conversation.status}
              {conversation.ai_active && (
                <span className="ml-1">· IA ativa</span>
              )}
            </p>
          </div>
        </div>

        <TooltipProvider delayDuration={500}>
          <div className="flex items-center gap-2 shrink-0">
            {/* Menu de ações (⋯) — Mesclar com... */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-lg text-foreground hover:bg-surface-hover"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Mais ações</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setMergeOpen(true)} className="gap-2">
                  <GitMerge className="h-4 w-4" />
                  <span className="flex-1">Mesclar com…</span>
                  <span className="text-[10px] text-muted-foreground">Ctrl Shift M</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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
                  <Badge variant="outline" className="text-[10px] h-7 px-2 border-border text-muted-foreground">
                    Você
                  </Badge>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleAssignToMe}
                        className="h-8 w-8 rounded-lg text-foreground hover:bg-surface-hover"
                      >
                        <UserPlus className="h-4 w-4" />
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
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-lg text-foreground hover:bg-surface-hover"
                        >
                          <Clock className="h-4 w-4" />
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

                {/* Pausar / reativar IA */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleToggleAI}
                      className={cn(
                        "h-8 w-8 rounded-lg hover:bg-surface-hover",
                        conversation.ai_active ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <Bot className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {conversation.ai_active
                      ? "Pausar a IA e assumir o atendimento"
                      : "Reativar a IA nesta conversa"}
                  </TooltipContent>
                </Tooltip>

                {/* Resolve button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      onClick={handleResolve}
                      className="h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Resolver · Ctrl Enter</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* Reabrir conversa resolvida */}
            {conversation.status === "resolved" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReopen}
                    className="h-8 px-3 rounded-lg text-[12px] gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reabrir
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reabrir esta conversa</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3"
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
          <div className="p-3 pt-0 shrink-0">
            {/* Caixa do composer — cartão arredondado flutuante */}
            <div
              className={cn(
                "rounded-xl border transition-colors",
                isNote ? "border-amber-300 bg-bubble-note/40" : "border-border bg-card shadow-sm"
              )}
            >
              {/* Mode toggle (Item 1) */}
              <div className="flex items-center gap-1 px-3 pt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setMode("reply")}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[13px] font-semibold px-1.5 py-1 rounded-md transition-colors",
                        !isNote
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Reply className="h-3.5 w-3.5" />
                      Responder
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Responder · R</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setMode("note")}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[13px] font-semibold px-1.5 py-1 rounded-md transition-colors",
                        isNote
                          ? "text-bubble-note-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Nota
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Nota interna · N</TooltipContent>
                </Tooltip>
              </div>

            {/* Textarea */}
            <div className="flex items-end gap-2 px-3 py-2">
              <Textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
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
                {/* Copilot: sugerir resposta com IA (mesmo contexto do widget) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={handleSuggestReply}
                      disabled={suggesting}
                    >
                      {suggesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Sugerir resposta com IA — usa dados do cliente, infra e base de conhecimento
                  </TooltipContent>
                </Tooltip>

                {/* Insert snippet / resposta rápida (item 5) — botão ⚡ ou "/" no composer */}
                <Popover
                  open={snippetOpen}
                  onOpenChange={(o) => {
                    setSnippetOpen(o);
                    if (!o) { setSnippetSlashMode(false); setSnippetQuery(""); }
                  }}
                >
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
                    <TooltipContent>Resposta rápida · digite / no início</TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    align="end"
                    className="w-80 p-0"
                    // No modo slash o foco fica no composer — não roubar o foco.
                    onOpenAutoFocus={(e) => { if (snippetSlashMode) e.preventDefault(); }}
                  >
                    <div className="p-2 border-b border-border">
                      {snippetSlashMode ? (
                        <p className="text-[11px] text-muted-foreground px-1 py-1.5">
                          Continue digitando após <span className="font-mono">/</span> para filtrar · Enter insere o primeiro
                        </p>
                      ) : (
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
                      )}
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
                      size="sm"
                      className="h-8 px-3 rounded-lg text-[13px] font-semibold gap-1.5"
                      onClick={() => handleSend()}
                      disabled={!content.trim() || sending}
                    >
                      {isNote ? "Salvar" : "Enviar"}
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isNote ? "Salvar nota" : "Enviar"} · Enter</TooltipContent>
                </Tooltip>
              </div>
            </div>
            </div>

            {isNote && (
              <p className="text-[10px] text-bubble-note-foreground mt-1.5 px-1 flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" />
                Nota interna — visível apenas para operadores
              </p>
            )}
          </div>
        </TooltipProvider>
      )}

      {/* Dialog de mesclagem — abre pelo menu ⋯ ou Ctrl+Shift+M */}
      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        sourceId={activeConversationId!}
        sourceContactName={contactName}
        onMerged={(targetId) => {
          // A conversa atual foi absorvida — sai dela e vai para o destino.
          const store = useInboxStore.getState();
          store.removeConversation(activeConversationId!);
          store.setActiveConversationId(targetId);
          store.loadConversations(store.activeTab, null, true);
        }}
      />
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

  // Card de resumo de mesclagem — mensagem de sistema com metadata.merge
  const merge = (message.metadata as { merge?: { source?: string; question?: string; summary?: string[]; agent_name?: string } } | undefined)?.merge;
  if (message.sender_type === "system" && merge) {
    return (
      <div className="max-w-[80%] mx-auto w-full animate-fade-in">
        <div className="rounded-xl border border-border bg-surface/60 p-4">
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            <GitMerge className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold">{message.content}</span>
          </div>
          {merge.question && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Motivo</p>
              <p className="text-[13px] text-foreground leading-snug">{merge.question}</p>
            </div>
          )}
          {merge.summary && merge.summary.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Resumo</p>
              <ul className="space-y-1">
                {merge.summary.map((b, i) => (
                  <li key={i} className="text-[13px] text-foreground leading-snug flex gap-1.5">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="text-[10px] text-muted-foreground mt-2 block">{time}</span>
        </div>
      </div>
    );
  }

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
      <div className="max-w-[65%] ml-auto animate-fade-in">
        <div className="bg-bubble-note text-bubble-note-foreground rounded-xl px-4 py-3">
          <div className="flex items-center gap-1 mb-1">
            <Lock className="h-3 w-3" />
            <span className="text-[10px] font-medium">Nota interna</span>
          </div>
          <p className="text-sm leading-[21px] whitespace-pre-wrap">{message.content}</p>
          <span className="text-[11px] opacity-60 mt-1 block text-right">{time}</span>
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
          "max-w-[65%] rounded-xl px-4 py-3",
          isContact
            ? "bg-bubble-contact text-bubble-contact-foreground"
            : "bg-bubble-agent text-bubble-agent-foreground"
        )}
      >
        {isBot && (
          <div className="flex items-center gap-1 mb-1 text-muted-foreground">
            <Bot className="h-3 w-3" />
            <span className="text-[10px] font-medium">IA</span>
          </div>
        )}
        {/* Selo de e-mail — mostra o assunto quando a mensagem veio por e-mail.
            Renderizamos o TEXTO puro (já extraído do MIME) — nunca HTML cru do
            cliente, para não abrir vetor de XSS no painel. */}
        {(message.metadata?.email as { subject?: string } | undefined)?.subject && (
          <div className="flex items-center gap-1 mb-1 text-muted-foreground">
            <Mail className="h-3 w-3" />
            <span className="text-[10px] font-medium truncate max-w-[240px]">
              {(message.metadata?.email as { subject?: string }).subject}
            </span>
          </div>
        )}
        {/* Imagens anexadas pelo cliente (prints) */}
        {(((message.metadata?.attachments as Array<{ type?: string; url?: string }> | undefined) ?? [])
          .filter((a) => a?.type === "image" && a?.url))
          .map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
              <img src={a.url} alt="anexo do cliente" loading="lazy" className="max-w-full max-h-64 rounded-lg object-cover" />
            </a>
          ))}
        {message.content && (
          <p className="text-sm leading-[21px] whitespace-pre-wrap">{message.content}</p>
        )}
        <span className="text-[11px] text-muted-foreground mt-1 block text-right">{time}</span>
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
