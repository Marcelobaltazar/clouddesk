/**
 * outbound-api.ts — Acesso do PAINEL aos Disparos.
 *
 * CRUD direto em desk_campaigns (RLS de operador), métricas pela view
 * desk_campaign_stats, estimativa de público pela Edge Function
 * desk-campaigns-admin (que enxerga o Supabase de produção da Cloudfy).
 *
 * Toda mudança que afeta o que o cliente vê (publicar, pausar, arquivar,
 * editar algo no ar) avisa os widgets abertos pelo broadcast `outbound-live`.
 */

import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { broadcastRealtime } from "@/lib/conv-broadcast";
import { OUTBOUND_LIVE_TOPIC } from "@/components/widget/outbound/useOutbound";
import {
  normalizeCampaign,
  type Campaign,
  type CampaignAudience,
  type CampaignContent,
  type CampaignStats,
  type CampaignStatus,
  type CampaignType,
} from "@/lib/outbound";
import type { Json } from "@/integrations/supabase/types";

const SELECT =
  "id, type, name, status, content, audience, priority, starts_at, ends_at, published_at, sender_agent_id, created_by, created_at, updated_at";

export interface AgentOption {
  id: string;
  name: string;
  avatar_url: string | null;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("desk_campaigns")
    .select(SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeCampaign);
}

export async function listCampaignStats(): Promise<Record<string, CampaignStats>> {
  const { data, error } = await supabase.from("desk_campaign_stats").select("*");
  if (error) throw error;
  const map: Record<string, CampaignStats> = {};
  for (const row of data ?? []) {
    if (!row.campaign_id) continue;
    map[row.campaign_id] = {
      campaign_id: row.campaign_id,
      seen: row.seen ?? 0,
      clicked: row.clicked ?? 0,
      dismissed: row.dismissed ?? 0,
      completed: row.completed ?? 0,
      started: row.started ?? 0,
      reactions: (row.reactions && typeof row.reactions === "object" ? row.reactions : {}) as Record<string, number>,
      last_seen_at: row.last_seen_at,
    };
  }
  return map;
}

export async function listAgents(): Promise<AgentOption[]> {
  const { data, error } = await supabase
    .from("desk_agents")
    .select("id, name, avatar_url")
    .order("name");
  if (error) throw error;
  return (data ?? []) as AgentOption[];
}

export interface CampaignDraft {
  id?: string;
  type: CampaignType;
  name: string;
  status: CampaignStatus;
  content: CampaignContent;
  audience: CampaignAudience;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  sender_agent_id: string | null;
}

/** Cria ou atualiza. Devolve a linha normalizada. */
export async function saveCampaign(draft: CampaignDraft, agentId: string | null): Promise<Campaign> {
  const payload = {
    type: draft.type,
    name: draft.name.trim(),
    status: draft.status,
    content: draft.content as unknown as Json,
    audience: draft.audience as unknown as Json,
    priority: draft.priority,
    starts_at: draft.starts_at,
    ends_at: draft.ends_at,
    published_at: draft.published_at,
    sender_agent_id: draft.sender_agent_id,
  };

  if (draft.id) {
    const { data, error } = await supabase
      .from("desk_campaigns")
      .update(payload)
      .eq("id", draft.id)
      .select(SELECT)
      .single();
    if (error) throw error;
    return normalizeCampaign(data);
  }

  const { data, error } = await supabase
    .from("desk_campaigns")
    .insert({ ...payload, created_by: agentId })
    .select(SELECT)
    .single();
  if (error) throw error;
  return normalizeCampaign(data);
}

export async function setCampaignStatus(
  id: string,
  status: CampaignStatus,
  extra: { clear_ends_at?: boolean } = {},
): Promise<void> {
  const patch: { status: CampaignStatus; published_at?: string; ends_at?: null } = { status };
  if (status === "active") patch.published_at = new Date().toISOString();
  // "Publicar de novo" um disparo encerrado: sem limpar o término ele voltaria
  // ao ar já encerrado.
  if (extra.clear_ends_at) patch.ends_at = null;
  const { error } = await supabase.from("desk_campaigns").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("desk_campaigns").delete().eq("id", id);
  if (error) throw error;
}

/** Cópia como rascunho ("(cópia)" no nome), sem agenda nem métricas. */
export async function duplicateCampaign(c: Campaign, agentId: string | null): Promise<Campaign> {
  return saveCampaign(
    {
      type: c.type,
      name: `${c.name} (cópia)`,
      status: "draft",
      content: c.content,
      audience: { ...c.audience, test_emails: c.audience.test_emails ?? [] },
      priority: c.priority,
      starts_at: null,
      ends_at: null,
      published_at: null,
      sender_agent_id: c.sender_agent_id,
    },
    agentId,
  );
}

/** Avisa os widgets abertos que algo mudou (recarregam a lista de disparos). */
export function notifyCampaignsChanged(): void {
  void broadcastRealtime(OUTBOUND_LIVE_TOPIC, "campaigns_changed", { at: Date.now() });
}

export interface AudienceEstimate {
  matched: number;
  total: number;
  by_plan: Record<string, number>;
}

export async function estimateAudience(audience: CampaignAudience): Promise<AudienceEstimate> {
  const { data, error } = await supabase.functions.invoke<AudienceEstimate & { error?: string }>(
    "desk-campaigns-admin",
    { body: { action: "audience_estimate", audience } },
  );
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      } catch { /* corpo não-JSON */ }
    }
    throw new Error(message);
  }
  if (!data || typeof data.matched !== "number") throw new Error("Resposta inválida");
  return data;
}

/** Linhas cruas dos receipts de um disparo — para o gráfico e o funil do tour. */
export interface ReceiptRow {
  email: string;
  first_seen_at: string;
  clicked_at: string | null;
  dismissed_at: string | null;
  completed_at: string | null;
  step_reached: number | null;
  reaction: string | null;
}

export async function listCampaignReceipts(campaignId: string): Promise<ReceiptRow[]> {
  const { data, error } = await supabase
    .from("desk_campaign_receipts")
    .select("email, first_seen_at, clicked_at, dismissed_at, completed_at, step_reached, reaction")
    .eq("campaign_id", campaignId)
    .order("first_seen_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as ReceiptRow[];
}
