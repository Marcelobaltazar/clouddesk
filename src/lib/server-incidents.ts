// ─── Incidentes de servidor no painel (Bloco 2) ────────────────────────────────
// A IA abre o incidente quando confirma que o servidor de um cliente caiu; o
// painel mostra o alerta e o operador confirma o reinício (modo sombra). Leitura
// direto da tabela (RLS de agente); ações pela Edge Function desk-server-incidents.

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type IncidentStatus = "detected" | "restart_sent" | "recovered" | "unresolved" | "dismissed";

export interface ServerIncident {
  id: string;
  server_name: string;
  status: IncidentStatus;
  detected_at: string;
  restart_mode: string | null;
  restart_sent_at: string | null;
  restart_error: string | null;
  last_check_at: string | null;
  affected: number;
}

/** Abertos + não resolvidos das últimas 24 h (os não resolvidos ficam até alguém encerrar). */
export async function loadActiveIncidents(): Promise<ServerIncident[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("desk_server_incidents")
    .select("id, server_name, status, detected_at, restart_mode, restart_sent_at, restart_error, last_check_at, desk_server_incident_conversations(conversation_id)")
    .in("status", ["detected", "restart_sent", "unresolved"])
    .gte("detected_at", since)
    .order("detected_at", { ascending: false });
  // Antes do `supabase db push` a tabela não existe (o front sai pela Vercel no
  // push, a migration é aplicada à parte): sem incidentes, sem erro na tela.
  if (error?.code === "PGRST205" || error?.code === "42P01") return [];
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    server_name: row.server_name,
    status: row.status as IncidentStatus,
    detected_at: row.detected_at,
    restart_mode: row.restart_mode,
    restart_sent_at: row.restart_sent_at,
    restart_error: row.restart_error,
    last_check_at: row.last_check_at,
    affected: Array.isArray(row.desk_server_incident_conversations) ? row.desk_server_incident_conversations.length : 0,
  }));
}

async function act(action: "restart" | "dismiss", incidentId: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("desk-server-incidents", {
    body: { action, incident_id: incidentId },
  });
  if (!error) return;
  let message = error.message;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* corpo não-JSON */ }
  }
  throw new Error(message);
}

export const confirmRestart = (incidentId: string) => act("restart", incidentId);
export const dismissIncident = (incidentId: string) => act("dismiss", incidentId);
