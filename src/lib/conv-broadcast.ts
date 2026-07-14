// Broadcast de mudanças de estado da conversa para o widget do cliente.
//
// Depois do fechamento das policies anônimas (migration 20260714000000), o
// widget não recebe mais postgres_changes — ele escuta apenas o canal de
// broadcast `conv-live:{id}`. Sempre que o painel muda status/atribuição de uma
// conversa, publica um evento `conv_updated` aqui.
//
// Usa o endpoint REST do Realtime (não abre canal WebSocket novo — evita
// conflito com o canal já aberto pelo ConversationThread para new_message).
// Fire-and-forget: falha vira warning; o widget tem re-sync no foco da aba.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

export interface ConvUpdatedPayload {
  status?: string;
  assigned_agent_id?: string | null;
  ai_active?: boolean;
}

export async function broadcastConvUpdated(
  conversationId: string,
  payload: ConvUpdatedPayload,
): Promise<void> {
  if (!conversationId || Object.keys(payload).length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? SUPABASE_KEY;

    const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `conv-live:${conversationId}`,
            event: "conv_updated",
            payload,
            private: false,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[conv-broadcast] HTTP ${res.status} ao publicar conv_updated`);
    }
  } catch (err) {
    console.warn("[conv-broadcast] falhou:", err);
  }
}
