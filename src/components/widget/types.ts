export interface CloudDeskSettings {
  supabase_url: string;
  supabase_anon_key: string;
  position: "bottom-right" | "bottom-left";
  color: string;
  greeting: string;
  quick_actions: string[];
  allowed_origins: string[];
  widget_name: string;
}

export interface WidgetConversation {
  id: string;
  status: string;
  created_at: string;
  subject: string | null;
}

export interface CredentialAction {
  infra_id: string;
  label: string;
}

export interface WidgetMessageMetadata {
  quick_replies?: string[];
  // Botões de reenvio de credenciais — um por infraestrutura ATIVA. O disparo só
  // acontece quando o cliente clica; a IA nunca reenvia por conta própria.
  credential_actions?: CredentialAction[];
}

export interface WidgetMessage {
  id: string;
  conversation_id: string;
  sender_type: "contact" | "agent" | "bot" | "system";
  content: string;
  created_at: string;
  ai_generated: boolean;
  is_private_note: boolean;
  metadata?: WidgetMessageMetadata | null;
}

export interface WidgetAccount {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  stripe_customer_id: string | null;
}

export const DEFAULT_SETTINGS: CloudDeskSettings = {
  supabase_url: "",
  supabase_anon_key: "",
  position: "bottom-right",
  color: "#6366f1",
  greeting: "Olá! Como podemos ajudar?",
  quick_actions: ["Problema técnico", "Dúvida sobre plano", "Minha infraestrutura"],
  allowed_origins: [],
  widget_name: "CloudDesk",
};
