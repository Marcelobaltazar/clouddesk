import { supabase } from "@/integrations/supabase/client";

/**
 * Calcula o sla_deadline para uma conversa nova a partir das policies ativas.
 *
 * Mesmo critério de score do applySlaPolicy (useConversationStore):
 *   plan+priority exatos (4) > plan exato (3) > priority exata (2) > global (1).
 * Na criação pelo widget o plano ainda não é conhecido → passa plan=null e só
 * policies globais/por prioridade se aplicam. O banco também tem um trigger
 * (20260611000000_support_metrics.sql) que cobre qualquer outro caminho.
 *
 * Retorna ISO string ou null se nenhuma policy ativa casar.
 */
export async function computeSlaDeadline(
  priority: string,
  clientPlan: string | null = null,
): Promise<string | null> {
  const { data: policies, error } = await supabase
    .from("desk_sla_policies")
    .select("plan, priority, first_response_minutes")
    .eq("is_active", true);

  if (error || !policies || policies.length === 0) return null;

  const scored = policies
    .map((p) => {
      let score = 0;
      if (p.plan === clientPlan && p.priority === priority) score = 4;
      else if (p.plan === clientPlan && p.priority === null) score = 3;
      else if (p.plan === null && p.priority === priority) score = 2;
      else if (p.plan === null && p.priority === null) score = 1;
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  return new Date(Date.now() + scored[0].first_response_minutes * 60_000).toISOString();
}

/**
 * Marca a primeira resposta da conversa (idempotente — só preenche se null).
 * Chamado após a primeira resposta de bot/agente. O trigger do banco faz o
 * mesmo de forma robusta; aqui é o fallback client-side imediato.
 */
export async function markFirstResponse(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("desk_conversations")
    .update({ first_response_at: new Date().toISOString() })
    .eq("id", conversationId)
    .is("first_response_at", null);

  if (error) {
    // anon pode não ter policy de UPDATE até a migration ser aplicada — não é fatal
    console.warn("[sla] markFirstResponse falhou (esperado até migration):", error.message);
  }
}
