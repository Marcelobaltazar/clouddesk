import { create } from "zustand";
import type { WidgetConversation, WidgetMessage, WidgetAccount } from "./types";
import type { ContactInfra } from "@/lib/contact-info";

interface WidgetState {
  isOpen: boolean;
  account: WidgetAccount | null;
  conversation: WidgetConversation | null;
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
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setAccount: (account: WidgetAccount | null) => void;
  setConversation: (conv: WidgetConversation | null) => void;
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
}

// Persist open/closed state
const getPersistedOpen = () => {
  try {
    return localStorage.getItem("clouddesk-widget-open") === "true";
  } catch {
    return false;
  }
};

export const useWidgetStore = create<WidgetState>((set) => ({
  isOpen: getPersistedOpen(),
  account: null,
  conversation: null,
  messages: [],
  infras: [],
  isTyping: false,
  isAiResponding: false,
  isWaitingForHuman: false,
  agentConnected: false,
  showCsat: false,
  csatSubmitted: false,
  unreadCount: 0,
  setOpen: (open) => {
    try { localStorage.setItem("clouddesk-widget-open", String(open)); } catch { /* localStorage indisponível */ }
    set({ isOpen: open });
  },
  toggleOpen: () => set((s) => {
    const next = !s.isOpen;
    try { localStorage.setItem("clouddesk-widget-open", String(next)); } catch { /* localStorage indisponível */ }
    return { isOpen: next };
  }),
  setAccount: (account) => set({ account }),
  setConversation: (conversation) => set({ conversation }),
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
}));
