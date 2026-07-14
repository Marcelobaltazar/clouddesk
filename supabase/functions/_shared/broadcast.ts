// ─── Broadcast server-side no canal Realtime da conversa ───────────────────────
// Depois do fechamento das policies anônimas, o widget não recebe mais
// postgres_changes — o único canal dele é o broadcast `conv-live:{id}`
// (capability: só quem conhece o UUID da conversa escuta). Este helper publica
// eventos pelo endpoint REST do Realtime, sem abrir websocket na Edge Function.
//
// Eventos usados:
//   new_message  → payload = linha de desk_messages (novo p/ o widget)
//   conv_updated → payload = { status?, assigned_agent_id?, ai_active? }

export async function broadcastToConversation(
  conversationId: string,
  event: 'new_message' | 'conv_updated',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;

    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `conv-live:${conversationId}`,
            event,
            payload,
            private: false,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[broadcast] HTTP ${res.status} ao publicar ${event} em conv-live:${conversationId}`);
    }
  } catch (e) {
    console.warn('[broadcast] falhou:', e instanceof Error ? e.message : e);
  }
}
