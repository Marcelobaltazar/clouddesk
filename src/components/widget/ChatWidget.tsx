import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWidgetStore } from "./useWidgetStore";
import { ChatWidgetHeader } from "./ChatWidgetHeader";
import { ChatWidgetWelcome } from "./ChatWidgetWelcome";
import { ChatWidgetThread } from "./ChatWidgetThread";
import { ChatWidgetComposer } from "./ChatWidgetComposer";
import { CSATFeedback } from "./CSATFeedback";
import type { CloudDeskSettings, WidgetMessage, WidgetMessageMetadata } from "./types";
import type { ContactInfo } from "@/lib/contact-info";

// ── Welcome message builder ────────────────────────────────────────────────────

const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

function intervalPt(v: string): string {
  return v === "month" ? "Mensal" : v === "year" ? "Anual" : v;
}

function subStatusIcon(v: string): string {
  return v === "active" ? "🟢" : v === "canceled" ? "🔴" : "🟡";
}

function subStatusPt(v: string): string {
  if (v === "active")   return "Ativa";
  if (v === "canceled") return "Cancelada";
  if (v === "trialing") return "Em teste";
  if (v === "unpaid")   return "Inadimplente";
  return v;
}

function formatDateBR(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function buildWelcomeMessage(info: ContactInfo): string | null {
  if (!info.customer) return null;

  const name = info.customer.name;
  const subs = info.subscriptions;

  if (subs.length === 0) {
    return `Olá, ${name}! 👋\n\nComo posso te ajudar hoje?`;
  }

  // Build one line per subscription:
  // {num_emoji} {product} · {interval} — {status_icon} {status} | 🖥️ {purchase_code} | 📅 {date}
  const subLines = subs.map((sub, idx) => {
    const num      = NUMBER_EMOJIS[idx] ?? `${idx + 1}.`;
    const interval = intervalPt(sub.interval);
    const plan     = [sub.product, interval].filter(Boolean).join(" · ");
    const icon     = subStatusIcon(sub.status);
    const status   = subStatusPt(sub.status);
    const date     = formatDateBR(sub.created_at);

    const infra = info.infras.find((i) => i.subscription_id === sub.subscription_id) ?? null;

    const infraPart = infra?.purchase_code ? `🖥️ ${infra.purchase_code}` : null;
    const parts = [
      `${num} ${plan} — ${icon} ${status}`,
      ...(infraPart ? [infraPart] : []),
      ...(date      ? [`📅 ${date}`] : []),
    ];

    return parts.join(" | ");
  });

  const activeSubs = subs.filter((s) => s.status === "active");
  const closing = activeSubs.length >= 2
    ? "Sobre qual assinatura você quer falar?"
    : "Como posso te ajudar?";

  const header = subs.length === 1
    ? "Aqui estão suas informações:"
    : `Encontrei ${subs.length} assinaturas na sua conta:`;

  return [
    `Olá, ${name}! 👋`,
    "",
    header,
    ...subLines,
    "",
    closing,
  ].join("\n");
}

// ── Edge Function call ────────────────────────────────────────────────────────
// Uses supabase.functions.invoke() so the client handles auth headers correctly
// regardless of whether the key is a JWT (eyJ...) or publishable key (sb_publishable_...).

interface AIRespondResult {
  reply: string | null;
  should_handoff: boolean;
  blocked?: boolean;
  metadata?: WidgetMessageMetadata | null;
}

async function callAiEdgeFunction(
  conversationId: string,
  message: string,
  accountName?: string | null,
  accountEmail?: string | null,
): Promise<AIRespondResult> {
  const { data, error } = await supabase.functions.invoke<AIRespondResult>(
    "desk-ai-respond",
    {
      body: {
        conversation_id: conversationId,
        message,
        account_name:  accountName  ?? undefined,
        account_email: accountEmail ?? undefined,
      },
    },
  );

  if (error) throw new Error(`Edge Function error: ${error.message}`);
  if (!data) throw new Error("Edge Function returned no data");

  return data;
}

// ── Handoff: escalate conversation to human ───────────────────────────────────

const HANDOFF_MESSAGE = `Vou encaminhar sua solicitação para nossa equipe.

⏰ Nosso SLA:
- Seg a Sex, 9h às 19h
- Resposta em até 12 horas úteis
- Fora do horário: fila para próximo dia útil

📚 Central de ajuda: https://ajuda.cloudfy.cloud/pt-BR/
💬 Discord: https://discord.gg/uDftSRtfKe`;

async function handleHandoff(conversationId: string): Promise<WidgetMessage | null> {
  // 1. Mark conversation as pending (waiting for human)
  const { error: updateError } = await supabase
    .from("desk_conversations")
    .update({
      status:    "pending",
      ai_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (updateError) {
    console.error("[Widget] Handoff UPDATE error:", updateError.message);
  }

  // 2. Insert visible system message for the client
  return insertMessage(conversationId, "system", HANDOFF_MESSAGE);
}

async function insertMessage(
  conversationId: string,
  senderType: "contact" | "bot" | "system",
  content: string,
  aiGenerated = false,
  metadata?: WidgetMessageMetadata | null,
): Promise<WidgetMessage | null> {
  const { data, error } = await supabase
    .from("desk_messages")
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      ai_generated: aiGenerated,
      content_type: "text",
      is_private_note: false,
      metadata: metadata ?? {},
    })
    .select("id, conversation_id, sender_type, content, created_at, ai_generated, is_private_note, metadata")
    .single();

  if (error) {
    console.error("[Widget] Erro ao inserir mensagem:", error.message);
    return null;
  }

  return data as WidgetMessage;
}

export interface EmbedUser {
  id: string;
  email: string;
  name: string;
}

interface Props {
  settings: CloudDeskSettings;
  /** Populated when running as embedded widget on cloudfy.space */
  embedUser?: EmbedUser;
}

export function ChatWidget({ settings, embedUser }: Props) {
  const {
    isOpen,
    account,
    conversation,
    messages,
    infras,
    showCsat,
    isAiResponding,
    isWaitingForHuman,
    agentConnected,
    setConversation,
    addMessage,
    setInfras,
    setIsAiResponding,
    setIsWaitingForHuman,
    setAgentConnected,
  } = useWidgetStore();
  // `messages` is used only for rendering — passed down to ChatWidgetThread

  // Guard: welcome message triggered at most once per widget open session
  const welcomeSentRef = useRef(false);

  const startConversation = useCallback(
    async (firstMessage: string) => {
      setIsAiResponding(true);
      // Nova conversa começa limpa (sem estado de espera/atendente herdado)
      setIsWaitingForHuman(false);
      setAgentConnected(false);

      try {
        // 1. Create conversation record in desk_conversations
        const accountUserId = embedUser?.id ?? account?.user_id;
        if (!accountUserId) {
          throw new Error("Usuário não autenticado — widget não pode criar conversa sem sessão ativa");
        }

        const { data: convData, error: convError } = await supabase
          .from("desk_conversations")
          .insert({
            account_user_id: accountUserId,
            user_email: embedUser?.email ?? account?.email ?? null,
            channel: "chat",
            status: "open",
            priority: "medium",
            subject: firstMessage.slice(0, 60),
            ai_active: true,
          })
          .select("id, status, created_at, subject")
          .single();

        if (convError || !convData) {
          throw new Error(`Erro ao criar conversa: ${convError?.message ?? "sem dados"}`);
        }

        setConversation({
          id: convData.id,
          status: convData.status,
          created_at: convData.created_at,
          subject: convData.subject,
        });

        // 2. Insert contact message
        const contactMsg = await insertMessage(convData.id, "contact", firstMessage);
        if (contactMsg) addMessage(contactMsg);

        // 3. Call Edge Function (server-side OpenAI — no CORS, no key in bundle)
        const aiResult = await callAiEdgeFunction(
          convData.id,
          firstMessage,
          embedUser?.name  ?? account?.name,
          embedUser?.email ?? account?.email,
        );

        if (aiResult.blocked) {
          // AI is disabled for this conversation — do nothing
        } else if (aiResult.should_handoff) {
          // Auto-handoff: trava o composer e mostra "aguardando atendente"
          setIsWaitingForHuman(true);
          const handoffMsg = await handleHandoff(convData.id);
          if (handoffMsg) addMessage(handoffMsg);
        } else if (aiResult.reply) {
          const botMsg = await insertMessage(convData.id, "bot", aiResult.reply, true, aiResult.metadata);
          if (botMsg) addMessage(botMsg);
        }
      } catch (err) {
        console.error("[Widget] Erro no fluxo de IA:", err);
        addMessage({
          id: crypto.randomUUID(),
          conversation_id: "error",
          sender_type: "bot",
          content: "Desculpe, tive um problema ao processar sua mensagem. Tente novamente.",
          created_at: new Date().toISOString(),
          ai_generated: false,
          is_private_note: false,
        });
      } finally {
        setIsAiResponding(false);
      }
    },
    [account, embedUser, addMessage, setConversation, setIsAiResponding, setIsWaitingForHuman, setAgentConnected]
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (!conversation) {
        await startConversation(text);
        return;
      }

      setIsAiResponding(true);

      try {
        // 1. Insert contact message
        const contactMsg = await insertMessage(conversation.id, "contact", text);
        if (contactMsg) addMessage(contactMsg);

        // 2. Call Edge Function (server-side OpenAI — no CORS, no key in bundle)
        const aiResult = await callAiEdgeFunction(
          conversation.id,
          text,
          embedUser?.name  ?? account?.name,
          embedUser?.email ?? account?.email,
        );

        if (aiResult.blocked) {
          // AI is disabled for this conversation — do nothing
        } else if (aiResult.should_handoff) {
          // Auto-handoff: trava o composer e mostra "aguardando atendente"
          setIsWaitingForHuman(true);
          const handoffMsg = await handleHandoff(conversation.id);
          if (handoffMsg) addMessage(handoffMsg);
        } else if (aiResult.reply) {
          const botMsg = await insertMessage(conversation.id, "bot", aiResult.reply, true, aiResult.metadata);
          if (botMsg) addMessage(botMsg);
        }
      } catch (err) {
        console.error("[Widget] Erro no fluxo de IA:", err);
        const fallback: WidgetMessage = {
          id: crypto.randomUUID(),
          conversation_id: conversation.id,
          sender_type: "bot",
          content: "Desculpe, tive um problema ao processar sua mensagem. Tente novamente.",
          created_at: new Date().toISOString(),
          ai_generated: false,
          is_private_note: false,
        };
        addMessage(fallback);
      } finally {
        setIsAiResponding(false);
      }
    },
    [account, embedUser, conversation, addMessage, setIsAiResponding, setIsWaitingForHuman, startConversation]
  );

  // ── Welcome message: fires once when the widget opens with no existing conversation ──
  // Calls get-contact-info, builds the greeting in code (no OpenAI), creates the
  // conversation record and inserts a bot message immediately.
  useEffect(() => {
    if (!isOpen) {
      // Reset guard when widget is closed so it fires again next open
      welcomeSentRef.current = false;
      return;
    }
    if (conversation) return;           // already has a conversation — skip
    if (welcomeSentRef.current) return; // already ran this open session

    const email = embedUser?.email ?? account?.email;
    if (!email) return; // no user — skip (anonymous)

    welcomeSentRef.current = true;

    (async () => {
      const accountUserId = embedUser?.id ?? account?.user_id;
      if (!accountUserId) return;

      try {
        // 1. Fetch contact info — no OpenAI, just CRM (Supabase de produção)
        const { data: contactData } = await supabase.functions.invoke<ContactInfo>(
          "get-contact-info",
          { body: { email } },
        );

        if (contactData?.infras) setInfras(contactData.infras);

        const welcomeText = contactData ? buildWelcomeMessage(contactData) : null;
        if (!welcomeText) return;

        // 2. Create conversation record
        const { data: convData, error: convError } = await supabase
          .from("desk_conversations")
          .insert({
            account_user_id: accountUserId,
            user_email: email,
            channel: "chat",
            status: "open",
            priority: "medium",
            subject: "Atendimento via widget",
            ai_active: true,
          })
          .select("id, status, created_at, subject")
          .single();

        if (convError || !convData) return;

        setConversation({
          id: convData.id,
          status: convData.status,
          created_at: convData.created_at,
          subject: convData.subject,
        });

        // 3. Insert welcome bot message (ai_generated = false — built by code, not OpenAI)
        const botMsg = await insertMessage(convData.id, "bot", welcomeText, false);
        if (botMsg) addMessage(botMsg);
      } catch (err) {
        console.error("[Widget] Welcome message error:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Load infras into the store ──────────────────────────────────────────────
  // Independent of the welcome flow (which only runs for brand-new conversations).
  // Guarantees the client's infra list is available whenever the widget is open
  // with a known email — used to map an infra name chosen via quick-reply chip
  // back to its infra_id (credential-resend flow, see ChatWidgetThread).
  useEffect(() => {
    if (!isOpen) return;
    if (infras.length > 0) return; // already loaded this session

    const email = embedUser?.email ?? account?.email;
    if (!email) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke<ContactInfo>(
          "get-contact-info",
          { body: { email } },
        );
        if (!cancelled && data?.infras) setInfras(data.infras);
      } catch (err) {
        console.error("[Widget] Falha ao carregar infras:", err);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, embedUser?.email, account?.email]);

  // ── Realtime: detect an operator taking over the conversation ───────────────
  // While the client waits for a human, we watch desk_conversations for the
  // moment an operator assumes it: assigned_agent_id becomes non-null (usually
  // alongside status going back to 'open'). When that happens we surface a
  // "✅ Atendente conectado" banner and unlock the composer.
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId || !isWaitingForHuman) return;

    const channel = supabase
      .channel(`widget-agent-takeover:${convId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "desk_conversations",
          filter: `id=eq.${convId}`,
        },
        (payload) => {
          const conv = payload.new as Record<string, unknown>;
          const assigned = conv.assigned_agent_id;
          // Operator assumed the conversation
          if (assigned !== null && assigned !== undefined && assigned !== "") {
            setAgentConnected(true);
            setIsWaitingForHuman(false);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversation?.id, isWaitingForHuman, setIsWaitingForHuman, setAgentConnected]);

  // ── Realtime: subscribe at the ChatWidget level (NOT inside ChatWidgetThread)
  // This runs before any isOpen/conversation guard, so the subscription stays alive
  // even when the widget is minimised. Keyed on conversation.id so it re-subscribes
  // if the conversation ever changes.
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId) return;

    // Helper: safely add a message to the store
    const addToStore = (raw: Record<string, unknown>) => {
      try {
        if (!raw.id || !raw.created_at) return;
        if (raw.is_private_note === true) return;

        const newMsg: WidgetMessage = {
          id:              String(raw.id),
          conversation_id: String(raw.conversation_id ?? convId),
          sender_type:     (raw.sender_type ?? "system") as WidgetMessage["sender_type"],
          content:         String(raw.content ?? ""),
          created_at:      String(raw.created_at),
          ai_generated:    raw.ai_generated === true,
          is_private_note: false,
          metadata:        (raw.metadata ?? null) as WidgetMessage["metadata"],
        };

        const store = useWidgetStore.getState();
        const current = Array.isArray(store.messages) ? store.messages : [];
        if (current.some((m) => m.id === newMsg.id)) return;

        console.log(`[Widget] new message — sender: ${newMsg.sender_type}`);
        store.setMessages([...current, newMsg]);

        // Destrava o composer assim que um operador humano responde.
        // Caminho mais confiável que o UPDATE de desk_conversations (que pode ser
        // bloqueado por RLS): desk_messages já tem Realtime + broadcast escutados aqui.
        if (newMsg.sender_type === "agent" && store.isWaitingForHuman) {
          store.setIsWaitingForHuman(false);
          store.setAgentConnected(true);
        }
      } catch (err) {
        console.error("[Widget] addToStore error:", err);
      }
    };

    // Channel 1: postgres_changes (fires when Realtime is enabled on the table)
    const pgChannel = supabase
      .channel(`widget-conv:${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "desk_messages" },
        (payload) => {
          try {
            if (!payload?.new || typeof payload.new !== "object") return;
            console.log("PAYLOAD RECEBIDO NO WIDGET (postgres):", payload.new);
            const raw = payload.new as Record<string, unknown>;
            if (raw.conversation_id !== convId) return;
            addToStore(raw);
          } catch (err) {
            console.error("[Widget] postgres_changes callback error:", err);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Widget] postgres_changes → ${status}`);
      });

    // Channel 2: broadcast (sent by ConversationThread after agent INSERT)
    // This is the reliable fallback path that doesn't depend on publication settings.
    const broadcastChannel = supabase
      .channel(`conv-live:${convId}`)
      .on("broadcast", { event: "new_message" }, ({ payload }) => {
        try {
          if (!payload || !payload.id) return;
          console.log("PAYLOAD RECEBIDO NO WIDGET (broadcast):", payload);
          addToStore(payload as Record<string, unknown>);
        } catch (err) {
          console.error("[Widget] broadcast callback error:", err);
        }
      })
      .subscribe((status) => {
        console.log(`[Widget] broadcast channel conv-live:${convId} → ${status}`);
      });

    return () => {
      supabase.removeChannel(pgChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [conversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-[9998] w-[380px] max-w-[calc(100vw-2rem)] h-[550px] max-h-[calc(100vh-8rem)] rounded-xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in-0 duration-300 sm:w-[380px]">
      <ChatWidgetHeader
        widgetName={settings.widget_name}
        onlineAgents={2}
      />

      {!conversation ? (
        <>
          <ChatWidgetWelcome
            greeting={settings.greeting}
            accountName={embedUser?.name ?? account?.name ?? null}
            quickActions={settings.quick_actions}
            onQuickAction={startConversation}
            onSendMessage={startConversation}
          />
          <ChatWidgetComposer onSend={startConversation} disabled={isAiResponding} />
        </>
      ) : (
        <>
          <ChatWidgetThread messages={messages} conversationId={conversation.id} onSend={handleSend} />
          {showCsat ? (
            <CSATFeedback />
          ) : (
            <>
              {/* Transferência só acontece quando a IA decide (should_handoff) —
                  não há mais botão manual de "Falar com humano". */}

              {/* Aguardando atendente humano */}
              {isWaitingForHuman && (
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-amber-500 flex items-center gap-1.5">
                    <span className="animate-pulse">⏳</span>
                    Aguardando um atendente humano...
                  </p>
                </div>
              )}

              {/* Atendente conectou na conversa */}
              {agentConnected && !isWaitingForHuman && (
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-emerald-500 flex items-center gap-1.5">
                    ✅ Atendente conectado
                  </p>
                </div>
              )}

              <ChatWidgetComposer
                onSend={handleSend}
                disabled={isAiResponding || isWaitingForHuman}
                placeholder={isWaitingForHuman ? "Aguardando atendente..." : undefined}
              />
            </>
          )}
        </>
      )}

      <div className="px-3 py-1.5 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          Powered by <span className="font-semibold">CloudDesk</span>
        </p>
      </div>
    </div>
  );
}
