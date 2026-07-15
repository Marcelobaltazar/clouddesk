import { useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWidgetStore } from "./useWidgetStore";
import { ChatWidgetHeader } from "./ChatWidgetHeader";
import { ChatWidgetWelcome } from "./ChatWidgetWelcome";
import { ChatWidgetThread } from "./ChatWidgetThread";
import { ChatWidgetComposer } from "./ChatWidgetComposer";
import { CSATFeedback } from "./CSATFeedback";
import { configureWidgetApi, widgetApi, WidgetApiError, type TurnResult } from "@/lib/widget-api";
import type { CloudDeskSettings, WidgetMessage } from "./types";
import type { ContactInfo } from "@/lib/contact-info";

// ─────────────────────────────────────────────────────────────────────────────
// SEGURANÇA: este componente NÃO acessa nenhuma tabela desk_* diretamente.
// Toda leitura/escrita passa pela Edge Function desk-widget-api, que verifica a
// identidade do cliente (user_hash HMAC vindo do backend do site host, ou sessão
// de operador no preview). O único uso do client Supabase aqui é o canal de
// broadcast Realtime `conv-live:{id}` — capability: só quem conhece o UUID da
// conversa (o dono e os operadores) escuta.
// ─────────────────────────────────────────────────────────────────────────────

// ── Welcome message builder (efêmera — não persiste até o cliente falar) ──────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mensagem local (não persistida) — usada para welcome efêmera e erros de rede. */
function localMessage(
  senderType: WidgetMessage["sender_type"],
  content: string,
): WidgetMessage {
  return {
    id: `local-${crypto.randomUUID()}`,
    conversation_id: "local",
    sender_type: senderType,
    content,
    created_at: new Date().toISOString(),
    ai_generated: false,
    is_private_note: false,
  };
}

function mergeMessages(current: WidgetMessage[], incoming: WidgetMessage[]): WidgetMessage[] {
  const seen = new Set(current.map((m) => m.id));
  const merged = [...current];
  for (const msg of incoming) {
    if (!seen.has(msg.id)) {
      merged.push(msg);
      seen.add(msg.id);
    }
  }
  return merged.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export interface EmbedUser {
  id: string;
  email: string;
  name: string;
  /** HMAC do e-mail calculado pelo backend do site host (identidade verificada) */
  hash?: string;
}

interface Props {
  settings: CloudDeskSettings;
  /** Preenchido quando roda como widget embedado no cloudfy.space */
  embedUser?: EmbedUser;
}

export function ChatWidget({ settings, embedUser }: Props) {
  const {
    isOpen,
    account,
    conversation,
    messages,
    showCsat,
    isAiResponding,
    isWaitingForHuman,
    agentConnected,
    setConversation,
    addMessage,
    setMessages,
    setInfras,
    setIsAiResponding,
    setIsWaitingForHuman,
    setAgentConnected,
  } = useWidgetStore();

  // Identidade efetiva: embed real (com hash) ou conta simulada do preview
  // (sem hash — o gateway aceita via sessão de operador logado no painel).
  const identityEmail = embedUser?.email ?? account?.email ?? null;
  const identityName  = embedUser?.name  ?? account?.name  ?? undefined;

  useMemo(() => {
    configureWidgetApi(
      identityEmail
        ? {
            email: identityEmail,
            name: identityName,
            userHash: embedUser?.hash,
            accountUserId: embedUser?.id ?? account?.user_id,
          }
        : null,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityEmail, identityName, embedUser?.hash]);

  const bootstrapInFlight = useRef(false);

  // Aplica o resultado de um turno (start/send) ao estado do widget.
  // Remove a mensagem otimista temporária (optimisticId) ao mesclar as reais.
  const applyTurn = useCallback((result: TurnResult, optimisticId?: string) => {
    if (result.conversation) setConversation(result.conversation);

    const store = useWidgetStore.getState();
    const base = optimisticId
      ? store.messages.filter((m) => m.id !== optimisticId)
      : store.messages;
    store.setMessages(mergeMessages(base, result.messages ?? []));

    if (result.waiting_for_human) {
      setIsWaitingForHuman(true);
    }
    if (result.auto_resolved && !store.csatSubmitted) {
      store.setShowCsat(true);
    }
    if (result.ai_error) {
      store.setMessages([
        ...useWidgetStore.getState().messages,
        localMessage(
          "system",
          "Tive um problema técnico agora, mas sua mensagem foi registrada — nossa equipe vai ver. 🙏",
        ),
      ]);
    }
  }, [setConversation, setIsWaitingForHuman]);

  const handleTurnError = useCallback((err: unknown) => {
    console.error("[Widget] Erro no fluxo:", err);
    const content = err instanceof WidgetApiError && err.code === "rate_limited"
      ? err.message
      : "Desculpe, tive um problema ao processar sua mensagem. Tente novamente.";
    addMessage(localMessage("bot", content));
  }, [addMessage]);

  // Submit unificado (start + send): mostra a mensagem do cliente NA HORA
  // (otimista, estilo WhatsApp) e só liga o "IA digitando" quando a IA de fato
  // vai responder (conversa com ai_active e não aguardando humano).
  const submit = useCallback(
    async (text: string, source: "quick_reply" | "text" = "text", imageData?: string) => {
      const trimmed = text.trim();
      if (!trimmed && !imageData) return;

      const store = useWidgetStore.getState();
      const conv = store.conversation;

      // P5: o balãozinho de "digitando" só aparece se a IA vai responder.
      // Se um humano assumiu (ai_active=false / aguardando humano), NÃO mostra.
      const aiWillReply =
        !store.isWaitingForHuman &&
        (!conv || conv.ai_active !== false) &&
        conv?.status !== "pending";

      // P4: mensagem otimista imediata (com preview da imagem, se houver)
      const optimistic = localMessage("contact", trimmed || "📷 Imagem");
      if (imageData) {
        optimistic.metadata = { attachments: [{ type: "image", url: imageData }] };
      }
      store.setMessages([...store.messages, optimistic]);

      if (aiWillReply) setIsAiResponding(true);

      try {
        const result = conv
          ? await widgetApi.send(conv.id, trimmed, source, imageData)
          : await widgetApi.start(trimmed, source, imageData);
        applyTurn(result, optimistic.id);
      } catch (err) {
        // Mantém a mensagem otimista (o cliente vê o que enviou) e mostra o erro
        handleTurnError(err);
      } finally {
        setIsAiResponding(false);
      }
    },
    [applyTurn, handleTurnError, setIsAiResponding]
  );

  const startConversation = useCallback(
    (firstMessage: string, source: "quick_reply" | "text" = "text") => submit(firstMessage, source),
    [submit]
  );

  const handleSend = useCallback(
    (text: string, source: "quick_reply" | "text" = "text", imageData?: string) =>
      submit(text, source, imageData),
    [submit]
  );

  // ── Reenvio de credenciais (disparado pelo CLIENTE ao clicar no botão) ───────
  // A IA NUNCA dispara isto. O backend valida a posse da infra (e-mail verificado
  // → infra pertence a ele → deploy ativo) ANTES de enviar. A confirmação de
  // envio é a mensagem de sistema criada server-side após sucesso real.
  const handleResendCredentials = useCallback(
    async (infraId: string): Promise<boolean> => {
      if (!conversation) return false;

      try {
        const result = await widgetApi.resendCredentials(conversation.id, infraId);
        if (result.success) {
          if (result.message) addMessage(result.message);
          return true;
        }
        addMessage(localMessage("system", `Não consegui reenviar suas credenciais agora. ${result.error ?? "Tente novamente em instantes."}`));
        return false;
      } catch (err) {
        const reason = err instanceof WidgetApiError ? err.message : "Tente novamente em instantes.";
        addMessage(localMessage("system", `Não consegui reenviar suas credenciais agora. ${reason}`));
        return false;
      }
    },
    [conversation, addMessage]
  );

  // ── Bootstrap: retoma conversa aberta OU mostra welcome efêmera ──────────────
  // Roda quando o widget abre sem conversa carregada. A conversa só é CRIADA
  // quando o cliente envia a primeira mensagem (nada de conversas vazias na inbox).
  useEffect(() => {
    if (!isOpen) return;
    if (conversation) return;
    if (!identityEmail) return;
    if (bootstrapInFlight.current) return;

    const store = useWidgetStore.getState();
    if (store.messages.length > 0) return; // welcome já exibida nesta sessão

    bootstrapInFlight.current = true;

    (async () => {
      try {
        const boot = await widgetApi.bootstrap();

        if (boot.contact?.infras) setInfras(boot.contact.infras);

        if (boot.conversation) {
          setConversation(boot.conversation);
          setMessages(boot.messages ?? []);
          if (boot.conversation.status === "pending") {
            if (boot.conversation.assigned_agent_id) setAgentConnected(true);
            else setIsWaitingForHuman(true);
          }
          return;
        }

        // Sem conversa aberta → saudação personalizada local (efêmera)
        const welcomeText = boot.contact ? buildWelcomeMessage(boot.contact) : null;
        if (welcomeText) {
          setMessages([{ ...localMessage("bot", welcomeText), id: "local-welcome" }]);
        }
      } catch (err) {
        console.error("[Widget] Bootstrap falhou:", err);
      } finally {
        bootstrapInFlight.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversation?.id, identityEmail]);

  // ── Realtime: canal de broadcast único conv-live:{id} ────────────────────────
  // Mantido vivo enquanto há conversa (mesmo minimizado). Eventos:
  //   new_message  → mensagens do operador (o painel publica após INSERT)
  //   conv_updated → mudanças de status/atribuição (painel e servidor publicam)
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId) return;

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

        store.setMessages(mergeMessages(current, [newMsg]));

        // Destrava o composer assim que um operador humano responde.
        if (newMsg.sender_type === "agent" && store.isWaitingForHuman) {
          store.setIsWaitingForHuman(false);
          store.setAgentConnected(true);
        }
      } catch (err) {
        console.error("[Widget] addToStore error:", err);
      }
    };

    const handleConvUpdated = (payload: Record<string, unknown>) => {
      const store = useWidgetStore.getState();
      const status = typeof payload.status === "string" ? payload.status : null;
      const assigned = payload.assigned_agent_id;

      if (status) {
        const conv = store.conversation;
        if (conv) store.setConversation({ ...conv, status });

        if (status === "resolved") {
          store.setIsWaitingForHuman(false);
          if (!store.csatSubmitted) store.setShowCsat(true);
        } else if (status === "pending") {
          if (!store.agentConnected) store.setIsWaitingForHuman(true);
        } else if (status === "open") {
          store.setShowCsat(false);
        }
      }

      if (assigned !== null && assigned !== undefined && assigned !== "") {
        store.setAgentConnected(true);
        store.setIsWaitingForHuman(false);
      }
    };

    const channel = supabase
      .channel(`conv-live:${convId}`)
      .on("broadcast", { event: "new_message" }, ({ payload }) => {
        if (payload?.id) addToStore(payload as Record<string, unknown>);
      })
      .on("broadcast", { event: "conv_updated" }, ({ payload }) => {
        if (payload) handleConvUpdated(payload as Record<string, unknown>);
      })
      .subscribe((status) => {
        console.log(`[Widget] broadcast conv-live:${convId} → ${status}`);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  // ── Re-sync ao voltar o foco para a aba (recupera eventos perdidos) ──────────
  useEffect(() => {
    const convId = conversation?.id;
    if (!convId) return;

    let syncing = false;
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || syncing) return;
      syncing = true;
      try {
        const result = await widgetApi.messages(convId);
        const store = useWidgetStore.getState();
        store.setMessages(mergeMessages(store.messages, result.messages ?? []));
        if (result.conversation) {
          store.setConversation(result.conversation);
          if (result.conversation.status === "resolved" && !store.csatSubmitted) {
            store.setShowCsat(true);
          }
        }
      } catch {
        // silencioso — próximo foco tenta de novo
      } finally {
        syncing = false;
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [conversation?.id]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-[9998] w-[380px] max-w-[calc(100vw-2rem)] h-[550px] max-h-[calc(100vh-8rem)] rounded-xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in-0 duration-300 sm:w-[380px]">
      <ChatWidgetHeader
        widgetName={settings.widget_name}
        onlineAgents={2}
      />

      {!conversation && messages.length === 0 ? (
        <>
          <ChatWidgetWelcome
            greeting={settings.greeting}
            accountName={identityName ?? null}
            quickActions={settings.quick_actions}
            onQuickAction={(action) => startConversation(action, "quick_reply")}
            onSendMessage={startConversation}
          />
          <ChatWidgetComposer onSend={startConversation} disabled={isAiResponding} />
        </>
      ) : (
        <>
          <ChatWidgetThread
            messages={messages}
            conversationId={conversation?.id ?? "local"}
            onSend={handleSend}
            onResendCredentials={handleResendCredentials}
          />
          {showCsat && conversation ? (
            <CSATFeedback conversationId={conversation.id} />
          ) : (
            <>
              {/* Transferência só acontece quando a IA decide (should_handoff) —
                  não há botão manual de "Falar com humano". */}

              {/* Aguardando atendente humano — o composer CONTINUA aberto:
                  enquanto espera, o cliente pode mandar mais detalhes/prints
                  que já ficam na conversa para o atendente ler. */}
              {isWaitingForHuman && (
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-amber-500 flex items-center gap-1.5">
                    <span className="animate-pulse">⏳</span>
                    Aguardando um atendente — pode mandar mais detalhes enquanto isso
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
                disabled={isAiResponding}
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
