import { create } from "zustand";
import type {
  WidgetConversation,
  WidgetConversationSummary,
  WidgetMessage,
  WidgetAccount,
} from "./types";
import type { ContactInfra } from "@/lib/contact-info";

/** Telas do widget. 'list' é a inicial: o cliente volta horas/dias depois e
 *  precisa achar o chamado dele antes de qualquer outra coisa.
 *
 *  'confirm_new' é o passo que evita a duplicata na origem: quem clica em
 *  "Nova conversa" já tendo um chamado recente em aberto vê primeiro qual é
 *  esse chamado e escolhe entre continuar nele ou abrir outro de verdade. */
export type WidgetView = "list" | "thread" | "confirm_new";

/** Aviso flutuante acima da bolha quando chega resposta com o widget fechado. */
export interface WidgetNotice {
  conversationId: string;
  /** Ex.: "Suporte respondeu seu chamado" */
  title: string;
  preview: string;
}

interface WidgetState {
  isOpen: boolean;
  view: WidgetView;
  account: WidgetAccount | null;
  conversation: WidgetConversation | null;
  conversations: WidgetConversationSummary[];
  conversationsLoaded: boolean;
  /** true = a última tentativa de ler a lista falhou. A UI mostra erro com
   *  retry — nunca o empty state, que faria o cliente achar que perdeu os
   *  chamados dele. */
  conversationsError: boolean;
  messages: WidgetMessage[];
  infras: ContactInfra[];
  isTyping: boolean;
  isAiResponding: boolean;
  isWaitingForHuman: boolean;
  /** true após um operador assumir a conversa (status open + assigned_agent_id) */
  agentConnected: boolean;
  showCsat: boolean;
  csatSubmitted: boolean;
  unreadCount: number;
  notice: WidgetNotice | null;
  /** Chamado que o cliente pediu para abrir de fora do painel (clique no aviso
   *  flutuante). O ChatWidget consome e zera assim que monta. */
  pendingOpenId: string | null;
  /** Chamado recente em aberto exibido na tela 'confirm_new'. */
  duplicateCandidate: WidgetConversationSummary | null;
  setDuplicateCandidate: (conv: WidgetConversationSummary | null) => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setView: (view: WidgetView) => void;
  setAccount: (account: WidgetAccount | null) => void;
  setConversation: (conv: WidgetConversation | null) => void;
  setConversations: (list: WidgetConversationSummary[]) => void;
  setConversationsError: (failed: boolean) => void;
  /** Zera as não lidas de uma conversa (cliente abriu a thread). */
  markConversationRead: (conversationId: string) => void;
  /** Aplica uma mensagem nova à lista (prévia, horário e não lidas). */
  applyIncomingToList: (
    conversationId: string,
    msg: { sender_type: WidgetMessage["sender_type"]; content: string; created_at: string },
    countsAsUnread: boolean,
  ) => void;
  setMessages: (msgs: WidgetMessage[]) => void;
  addMessage: (msg: WidgetMessage) => void;
  setInfras: (infras: ContactInfra[]) => void;
  setIsTyping: (v: boolean) => void;
  setIsAiResponding: (v: boolean) => void;
  setIsWaitingForHuman: (v: boolean) => void;
  setAgentConnected: (v: boolean) => void;
  setShowCsat: (v: boolean) => void;
  setCsatSubmitted: (v: boolean) => void;
  setUnreadCount: (n: number) => void;
  setNotice: (notice: WidgetNotice | null) => void;
  setPendingOpenId: (id: string | null) => void;
  /** Volta para a lista, descartando a thread aberta. */
  backToList: () => void;
}

/** Prévia curta para a lista/aviso — mesma regra do servidor. */
function preview(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

// Persist open/closed state
const getPersistedOpen = () => {
  try {
    return localStorage.getItem("clouddesk-widget-open") === "true";
  } catch {
    return false;
  }
};

/** Badge da bolha = soma das não lidas de todos os chamados. Derivar da lista
 *  (em vez de manter um contador à parte) evita os dois números divergirem. */
function totalUnread(list: WidgetConversationSummary[]): number {
  return list.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
}

export const useWidgetStore = create<WidgetState>((set) => ({
  isOpen: getPersistedOpen(),
  view: "list",
  account: null,
  conversation: null,
  conversations: [],
  conversationsLoaded: false,
  conversationsError: false,
  messages: [],
  infras: [],
  isTyping: false,
  isAiResponding: false,
  isWaitingForHuman: false,
  agentConnected: false,
  showCsat: false,
  csatSubmitted: false,
  unreadCount: 0,
  notice: null,
  pendingOpenId: null,
  duplicateCandidate: null,
  setOpen: (open) => {
    try { localStorage.setItem("clouddesk-widget-open", String(open)); } catch { /* localStorage indisponível */ }
    // Abrir o widget dispensa o aviso flutuante — ele já cumpriu o papel.
    set(open ? { isOpen: true, notice: null } : { isOpen: false });
  },
  toggleOpen: () => set((s) => {
    const next = !s.isOpen;
    try { localStorage.setItem("clouddesk-widget-open", String(next)); } catch { /* localStorage indisponível */ }
    return next ? { isOpen: true, notice: null } : { isOpen: false };
  }),
  setView: (view) => set({ view }),
  setAccount: (account) => set({ account }),
  setConversation: (conversation) => set({ conversation }),
  setConversations: (conversations) =>
    set({
      conversations,
      conversationsLoaded: true,
      conversationsError: false,
      unreadCount: totalUnread(conversations),
    }),
  setConversationsError: (conversationsError) =>
    set({ conversationsError, conversationsLoaded: true }),
  markConversationRead: (conversationId) =>
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0 } : c,
      );
      return { conversations, unreadCount: totalUnread(conversations) };
    }),
  applyIncomingToList: (conversationId, msg, countsAsUnread) =>
    set((s) => {
      const existing = s.conversations.find((c) => c.id === conversationId);
      // Conversa ainda não conhecida pela lista (recém-criada nesta sessão):
      // não inventa uma linha aqui — o refresh da lista traz os dados corretos.
      if (!existing) return {};

      const conversations = s.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              last_message_at: msg.created_at,
              last_message_preview: preview(msg.content),
              last_message_sender: msg.sender_type,
              unread_count: countsAsUnread ? (c.unread_count ?? 0) + 1 : c.unread_count ?? 0,
            }
          : c,
      );
      // Reordena por atividade — a conversa que acabou de receber resposta sobe.
      conversations.sort((a, b) => {
        const ta = a.last_message_at ? Date.parse(a.last_message_at) : 0;
        const tb = b.last_message_at ? Date.parse(b.last_message_at) : 0;
        return tb - ta;
      });
      return { conversations, unreadCount: totalUnread(conversations) };
    }),
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setInfras: (infras) => set({ infras }),
  setIsTyping: (isTyping) => set({ isTyping }),
  setIsAiResponding: (isAiResponding) => set({ isAiResponding }),
  setIsWaitingForHuman: (isWaitingForHuman) => set({ isWaitingForHuman }),
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  setShowCsat: (showCsat) => set({ showCsat }),
  setCsatSubmitted: (csatSubmitted) => set({ csatSubmitted }),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  setNotice: (notice) => set({ notice }),
  setPendingOpenId: (pendingOpenId) => set({ pendingOpenId }),
  setDuplicateCandidate: (duplicateCandidate) => set({ duplicateCandidate }),
  backToList: () =>
    set({
      view: "list",
      conversation: null,
      duplicateCandidate: null,
      messages: [],
      // Estados que pertencem à thread que está sendo fechada — carregá-los
      // para a próxima conversa mostraria "atendente conectado" no chamado errado.
      showCsat: false,
      csatSubmitted: false,
      isWaitingForHuman: false,
      agentConnected: false,
      isAiResponding: false,
      isTyping: false,
    }),
}));
