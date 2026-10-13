import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, ServerCrash, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/dates";
import {
  confirmRestart,
  dismissIncident,
  loadActiveIncidents,
  type ServerIncident,
} from "@/lib/server-incidents";

// Faixa fixa no topo do painel quando a IA confirma um servidor fora do ar.
// Modo sombra: o operador confirma o reinício com um clique. Os dados aqui
// (nome do servidor) são internos — nunca aparecem para o cliente.

const STYLE: Record<string, string> = {
  detected: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  restart_sent: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  unresolved: "border-rose-500/60 bg-rose-500/20 text-rose-800 dark:text-rose-100",
};

function describe(i: ServerIncident): string {
  const clients = i.affected === 1 ? "1 cliente afetado" : `${i.affected} clientes afetados`;
  if (i.status === "detected") return `${i.server_name} não responde · ${clients} · detectado ${timeAgo(i.detected_at)}`;
  if (i.status === "restart_sent") {
    const how = i.restart_mode === "auto" ? "automático" : "manual";
    return `${i.server_name} · reinício ${how} enviado ${i.restart_sent_at ? timeAgo(i.restart_sent_at) : ""} · aguardando voltar · ${clients}`;
  }
  return `${i.server_name} não voltou depois do reinício · ${clients} transferidos para a equipe`;
}

export function ServerIncidentBanner() {
  const [incidents, setIncidents] = useState<ServerIncident[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const { notify } = useNotifications();

  const refresh = useCallback(async () => {
    try {
      const list = await loadActiveIncidents();
      // Alerta sonoro/desktop só para incidente novo aguardando ação.
      for (const i of list) {
        if (i.status === "detected" && !seen.current.has(i.id)) {
          notify({ title: "Servidor fora do ar", body: describe(i) });
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Servidor fora do ar", { body: describe(i), tag: `incident-${i.id}` });
          }
        }
        seen.current.add(i.id);
      }
      setIncidents(list);
    } catch (e) {
      console.error(e);
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel("server-incidents")
      .on("postgres_changes", { event: "*", schema: "public", table: "desk_server_incidents" }, () => void refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const run = async (id: string, fn: (id: string) => Promise<void>, ok: string) => {
    setBusy(id);
    try {
      await fn(id);
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir");
    } finally {
      setBusy(null);
    }
  };

  if (incidents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {incidents.map((i) => (
        <div
          key={i.id}
          role="alert"
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ${STYLE[i.status] ?? STYLE.detected}`}
        >
          {i.status === "restart_sent" ? <RotateCw className="h-4 w-4 shrink-0" /> : <ServerCrash className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{describe(i)}</span>
          {i.restart_error && (
            <span className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-300" title={i.restart_error}>
              <AlertTriangle className="h-3.5 w-3.5" /> falha no último envio
            </span>
          )}
          {i.status === "detected" && (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy === i.id}
                onClick={() => void run(i.id, confirmRestart, "Reinício enviado")}
              >
                {busy === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar reinício"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === i.id}
                onClick={() => void run(i.id, dismissIncident, "Incidente encerrado")}
              >
                Não é o caso
              </Button>
            </>
          )}
          {i.status === "unresolved" && (
            <Button
              size="icon"
              variant="ghost"
              title="Encerrar alerta"
              disabled={busy === i.id}
              onClick={() => void run(i.id, dismissIncident, "Alerta encerrado")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
