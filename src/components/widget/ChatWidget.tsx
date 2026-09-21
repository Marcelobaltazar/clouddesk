import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWidgetStore } from "./useWidgetStore";
import { ChatWidgetHeader } from "./ChatWidgetHeader";
import { ChatWidgetWelcome } from "./ChatWidgetWelcome";
import { ChatWidgetThread } from "./ChatWidgetThread";
import { ChatWidgetComposer } from "./ChatWidgetComposer";
import { ChatWidgetConversationList } from "./ChatWidgetConversationList";
import { ChatWidgetDuplicateCheck } from "./ChatWidgetDuplicateCheck";
import { CSATFeedback } from "./CSATFeedback";
import { NewsFeed } from "./outbound/NewsFeed";
import { NoticeCard } from "./outbound/NoticeCard";
import { BannerStrip } from "./outbound/BannerStrip";
import { WidgetTabBar } from "./outbound/WidgetTabBar";
import { runBannerCta, runNoticeCta, startTour } from "./outbound/campaignActions";
import {
  countUnreadNews,
  selectBanner,
  selectListedTours,
  selectNews,
  selectNotices,
  trackCampaign,
  useCurrentHref,
} from "./outbound/useOutbound";
import { configureWidgetApi, widgetApi, WidgetApiError, type TurnResult } from "@/lib/widget-api";
import type { CloudDeskSettings, WidgetConversationSummary, WidgetMessage } from "./types";
import type { ContactInfo } from "@/lib/contact-info";

// ─────────────────────────────────────────────────────────────────────────────
// SEGURANÇA: este componente NÃO acessa nenhuma tabela desk_* diretamente nem
// abre canal Realtime. Toda leitura/escrita passa pela Edge Function
// desk-widget-api, que verifica a identidade do cliente (user_hash HMAC vindo do
// backend do site host, ou sessão de operador no preview). O Realtime é
// responsabilidade exclusiva de useWidgetLiveUpdates — canal de broadcast
// `conv-live:{id}`, capability: só quem conhece o UUID da conversa escuta.
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

/** Janela em que um chamado aberto ainda "conta" como conversa em andamento.
 *  Depois disso o assunto provavelmente esfriou e perguntar atrapalharia mais
 *  do que ajudaria — o cliente abre o novo chamado direto. */
const RECENT_OPEN_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

/**
 * Chamado recente em aberto do cliente, se houver — é ele que a tela de
 * confirmação mostra antes de deixar abrir mais um. A lista já vem ordenada
 * por atividade, então o primeiro que casar é o mais relevante.
 */
function findRecentOpenTicket(
  list: WidgetConversationSummary[],
): WidgetConversationSummary | null {
  const cutoff = Date.now() - RECENT_OPEN_WINDOW_MS;
  return (
    list.find((c) => {
      if (c.status === "resolved" || c.merged_into) return false;
      const stamp = Date.parse(c.last_message_at ?? c.created_at);
      return Number.isFinite(stamp) && stamp >= cutoff;
    }) ?? null
  );
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
    view,
    account,
    conversation,
    conversations,
    conversationsLoaded,
    conversationsError,
    messages,
    showCsat,
    isAiResponding,
    isWaitingForHuman,
    agentConnected,
    setView,
    setConversation,
    setConversations,
    setConversationsError,
    addMessage,
    setMessages,
    setInfras,
    setIsAiResponding,
    setIsWaitingForHuman,
    setAgentConnected,
    markConversationRead,
    backToList,
    duplicateCandidate,
    setDuplicateCandidate,
    campaigns,
  } = useWidgetStore();

  // ── Disparos (avisos, novidades, banners, tours) ────────────────────────────
  // Já carregados pelo runtime do embed (o popup e o tour rodam com o widget
  // fechado); aqui só escolhemos o que entra em cada lugar do painel aberto.
  const href = useCurrentHref();
  const notices = selectNotices(campaigns, href);
  const banner = selectBanner(campaigns, href);
  const newsUnread = countUnreadNews(campaigns);
  // As abas só aparecem quando existe algo para mostrar em Novidades — sem
  // disparos publicados, o widget fica exatamente como sempre foi.
  const hasNewsTab = selectNews(campaigns).length > 0 || selectListedTours(campaigns).length > 0;

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

  // O cliente clicou em "Nova conversa": a próxima mensagem tem que abrir um
  // chamado SEPARADO, mesmo que exista um aberto. Vive num ref porque é uma
  // intenção momentânea — some assim que a conversa nasce.
  const forceNewConversation = useRef(false);

  // Aplica o resultado de um turno (start/send) ao estado do widget.
  // Remove a mensagem otimista temporária (optimisticId) ao mesclar as reais.
  const applyTurn = useCallback((result: TurnResult, optimisticId?: string) => {
    if (result.conversation) {
      setConversation(result.conversation);
      // A lista precisa conhecer o chamado recém-criado/reaberto — senão ele
      // não aparece ao voltar, e o realtime não assina o canal dele.
      void widgetApi
        .conversations()
        .then(({ conversations }) => useWidgetStore.getState().setConversations(conversations))
        .catch(() => {});
    }

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
          : await widgetApi.start(trimmed, source, imageData, forceNewConversation.current);
        forceNewConversation.current = false; // intenção consumida
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

  // ── Bootstrap: carrega a LISTA de chamados do cliente ────────────────────────
  // A tela inicial é a lista (o cliente volta horas/dias depois para ver a
  // resposta), então o bootstrap não entra mais direto numa thread. As conversas
  // continuam sendo CRIADAS só quando o cliente envia a primeira mensagem —
  // nada de chamados vazios na inbox do operador.
  useEffect(() => {
    if (!identityEmail) return;
    if (bootstrapInFlight.current) return;
    if (conversationsLoaded) return;

    bootstrapInFlight.current = true;

    (async () => {
      try {
        const boot = await widgetApi.bootstrap();
        if (boot.contact?.infras) setInfras(boot.contact.infras);
        // conversations null / conversations_failed = a leitura quebrou. Marcar
        // como erro (e não como lista vazia) evita dizer "nenhum chamado ainda"
        // para um cliente que tem chamados abertos.
        if (boot.conversations_failed || boot.conversations === null) {
          setConversationsError(true);
        } else {
          setConversations(boot.conversations);
        }
      } catch (err) {
        console.error("[Widget] Bootstrap falhou:", err);
        setConversationsError(true);
      } finally {
        bootstrapInFlight.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityEmail, conversationsLoaded]);

  /** Recarrega a lista de chamados (botão "Tentar de novo"). */
  const reloadConversations = useCallback(async () => {
    try {
      const { conversations: list } = await widgetApi.conversations();
      setConversations(list);
    } catch (err) {
      console.error("[Widget] Falha ao recarregar chamados:", err);
      setConversationsError(true);
    }
  }, [setConversations, setConversationsError]);

  // ── Abrir um chamado da lista ────────────────────────────────────────────────
  const openConversation = useCallback(
    async (conversationId: string) => {
      const store = useWidgetStore.getState();
      const summary = store.conversations.find((c) => c.id === conversationId) ?? null;

      // Entra na thread já com o que se sabe da lista — o cliente vê a tela
      // trocar na hora, sem esperar a rede.
      setView("thread");
      setMessages([]);
      // Num chamado mesclado o resumo da lista descreve a thread ABSORVIDA, não
      // a que vai abrir — pintar a tela com ele mostraria o assunto errado por
      // um instante. Espera o gateway devolver a conversa de destino.
      if (summary && !summary.merged_into) {
        setConversation({
          id: summary.id,
          status: summary.status,
          created_at: summary.created_at,
          subject: summary.subject,
          assigned_agent_id: summary.assigned_agent_id,
          ai_active: summary.ai_active,
          last_message_at: summary.last_message_at,
        });
      }

      try {
        const result = await widgetApi.messages(conversationId);
        setConversation(result.conversation);
        setMessages(result.messages ?? []);

        const status = result.conversation.status;
        if (status === "pending") {
          if (result.conversation.assigned_agent_id) setAgentConnected(true);
          else setIsWaitingForHuman(true);
        }

        // Abriu = leu. Falha aqui só significa que o badge some no próximo
        // refresh — não vale interromper a leitura com um erro.
        markConversationRead(conversationId);
        void widgetApi.markRead(conversationId).catch(() => {});
      } catch (err) {
        console.error("[Widget] Falha ao abrir chamado:", err);
        addMessage(
          localMessage("system", "Não consegui carregar este chamado agora. Tente novamente."),
        );
      }
    },
    [setView, setMessages, setConversation, setAgentConnected, setIsWaitingForHuman, markConversationRead, addMessage],
  );

  // Chamado pedido de fora (clique no aviso flutuante com o widget fechado):
  // o EmbedRoot só consegue setar o id, quem sabe carregar a thread é este
  // componente — então ele consome o pedido assim que monta.
  const pendingOpenId = useWidgetStore((s) => s.pendingOpenId);
  useEffect(() => {
    if (!pendingOpenId) return;
    useWidgetStore.getState().setPendingOpenId(null);
    void openConversation(pendingOpenId);
  }, [pendingOpenId, openConversation]);

  // ── Nova conversa: tela de boas-vindas com saudação personalizada ────────────
  // A conversa NÃO é criada aqui — só quando o cliente enviar a primeira
  // mensagem (mesma regra de sempre: nada de chamados vazios na inbox).
  const beginNewConversation = useCallback(async () => {
    backToList();          // limpa thread/CSAT/estado do chamado anterior
    forceNewConversation.current = true;
    setView("thread");

    try {
      const contact = await widgetApi.bootstrap().then((b) => b.contact);
      if (contact?.infras) setInfras(contact.infras);
      const welcomeText = contact ? buildWelcomeMessage(contact) : null;
      // Só escreve a saudação se o cliente ainda não digitou nada — ele pode
      // ter enviado a primeira mensagem antes desta resposta chegar.
      if (welcomeText && useWidgetStore.getState().messages.length === 0) {
        setMessages([{ ...localMessage("bot", welcomeText), id: "local-welcome" }]);
      }
    } catch (err) {
      console.error("[Widget] Falha ao preparar nova conversa:", err);
    }
  }, [backToList, setView, setInfras, setMessages]);

  // Prevenção de chamado duplicado: quem clica em "Nova conversa" já tendo um
  // chamado recente em aberto passa antes pela tela de confirmação. É aqui que
  // a duplicata é evitada — mesclar depois é sempre mais caro (junta SLA,
  // prioridade e assunto de dois problemas possivelmente distintos, sem desfazer).
  const startNewConversation = useCallback(async () => {
    const candidate = findRecentOpenTicket(useWidgetStore.getState().conversations);
    if (candidate) {
      setDuplicateCandidate(candidate);
      setView("confirm_new");
      return;
    }
    await beginNewConversation();
  }, [beginNewConversation, setDuplicateCandidate, setView]);

  // ── Realtime ────────────────────────────────────────────────────────────────
  // O canal `conv-live:{id}` é assinado UMA vez só, em useWidgetLiveUpdates
  // (montado sempre, inclusive com o widget fechado). Este componente NÃO abre
  // canal próprio: dois supabase.channel() com o mesmo tópico colidem — o
  // segundo subscribe entra em erro e os eventos param de chegar de forma
  // confiável. O hook injeta a mensagem na thread aberta e cuida do resto.

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

  // Avisos e banner exibidos com o widget aberto contam como vistos.
  const seenIds = notices.map((n) => n.id).concat(banner ? [banner.id] : []).join(",");
  useEffect(() => {
    if (!isOpen || (view !== "list" && view !== "news")) return;
    for (const id of seenIds.split(",").filter(Boolean)) {
      const c = useWidgetStore.getState().campaigns.find((x) => x.id === id);
      if (c && !c.receipt?.seen) trackCampaign(id, "seen");
    }
  }, [isOpen, view, seenIds]);

  if (!isOpen) return null;

  const inThread = view === "thread";
  const inConfirmNew = view === "confirm_new";
  const inNews = view === "news";
  const inRoot = view === "list" || inNews;

  return (
    <div className="fixed bottom-24 right-6 z-[9998] w-[380px] max-w-[calc(100vw-2rem)] h-[550px] max-h-[calc(100vh-8rem)] rounded-xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in-0 duration-300 sm:w-[380px]">
      <ChatWidgetHeader
        widgetName={settings.widget_name}
        onlineAgents={2}
        showBack={inThread || inConfirmNew}
        onBack={backToList}
        title={
          inConfirmNew ? "Nova conversa"
            : inThread ? conversation?.subject ?? "Nova conversa"
            : inNews ? "Novidades"
            : "Meus chamados"
        }
      />

      {/* Banner fixado no topo, só nas telas de raiz (a thread precisa do espaço). */}
      {inRoot && banner && (
        <BannerStrip
          content={banner.content}
          isTest={banner.is_test}
          onCta={() => runBannerCta(banner.id, banner.content)}
          onDismiss={() => trackCampaign(banner.id, "dismiss")}
        />
      )}

      {inConfirmNew && duplicateCandidate ? (
        <ChatWidgetDuplicateCheck
          conversation={duplicateCandidate}
          onContinue={() => {
            setDuplicateCandidate(null);
            void openConversation(duplicateCandidate.id);
          }}
          onCreateAnyway={() => {
            setDuplicateCandidate(null);
            void beginNewConversation();
          }}
        />
      ) : inNews ? (
        <NewsFeed onStartTour={(tour) => startTour(tour.id)} />
      ) : !inThread ? (
        <ChatWidgetConversationList
          conversations={conversations}
          loading={!conversationsLoaded}
          error={conversationsError}
          onRetry={reloadConversations}
          onOpenConversation={openConversation}
          onNewConversation={startNewConversation}
          header={
            notices.length > 0 ? (
              <div className="p-3 space-y-2 border-b border-border/60 bg-muted/20">
                {notices.map((n) => (
                  <NoticeCard
                    key={n.id}
                    content={n.content}
                    sender={n.sender}
                    variant="card"
                    isTest={n.is_test}
                    onCta={() => runNoticeCta(n.id, n.content)}
                    onDismiss={() => trackCampaign(n.id, "dismiss")}
                  />
                ))}
              </div>
            ) : null
          }
        />
      ) : !conversation && messages.length === 0 ? (
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

              {/* Chamado resolvido: o composer segue aberto de propósito —
                  responder aqui reabre o chamado. Sem este aviso o cliente não
                  saberia que ainda pode retomar o assunto. */}
              {conversation?.status === "resolved" && (
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    ✓ Chamado resolvido — responda aqui para reabrir
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

      {inRoot && hasNewsTab && (
        <WidgetTabBar
          active={inNews ? "news" : "list"}
          newsUnread={newsUnread}
          onChange={(tab) => setView(tab)}
        />
      )}

      <div className="px-3 py-1.5 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          Powered by <span className="font-semibold">CloudDesk</span>
        </p>
      </div>
    </div>
  );
}
