import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { BarChart3, Bot, Clock, MessageSquare, Smile, TrendingUp, Zap } from "lucide-react";
import { format, startOfWeek, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConvRow {
  id: string;
  status: string;
  priority: string;
  created_at: string;
  resolved_at: string | null;
  first_response_at: string | null;
  sla_deadline: string | null;
  tags: string[] | null;
}

interface MsgRow {
  conversation_id: string;
  sender_type: string;
  created_at: string;
}

interface CsatRow {
  rating: number;
}

interface AiRow {
  latency_ms: number | null;
  total_tokens: number | null;
  was_escalated: boolean | null;
  context_sources: { intent?: string | null; sentiment?: string | null } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  credenciais: "Credenciais/Acesso",
  n8n: "n8n",
  evolution: "Evolution/WhatsApp",
  infra_down: "Infra fora do ar",
  billing: "Cobrança/Plano",
  cancelamento: "Cancelamento",
  upgrade: "Upgrade",
  dominio: "Domínio/DNS",
  duvida_geral: "Dúvida geral",
  outro: "Outros",
};

const INTENT_COLORS = [
  "#9EC5FA", "#85E0D9", "#B19EFA", "#F7C873", "#F98686", "#9BDD8D", "#F2A2D0", "#94A3B8",
];

function weekKey(iso: string): string {
  return format(startOfWeek(new Date(iso), { weekStartsOn: 1 }), "dd/MM", { locale: ptBR });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMinutes(min: number): string {
  if (min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Reports() {
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [csat, setCsat] = useState<CsatRow[]>([]);
  const [ai, setAi] = useState<AiRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = subDays(new Date(), 90).toISOString();

      const [convRes, msgRes, csatRes, aiRes] = await Promise.all([
        supabase
          .from("desk_conversations")
          .select("id, status, priority, created_at, resolved_at, first_response_at, sla_deadline, tags")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(2000),
        supabase
          .from("desk_messages")
          .select("conversation_id, sender_type, created_at")
          .gte("created_at", since)
          .eq("is_private_note", false)
          .order("created_at", { ascending: true })
          .limit(10000),
        supabase.from("desk_csat").select("rating").gte("created_at", since).limit(2000),
        supabase
          .from("desk_ai_interactions")
          .select("latency_ms, total_tokens, was_escalated, context_sources")
          .gte("created_at", since)
          .limit(5000),
      ]);

      if (!convRes.error && convRes.data) setConvs(convRes.data as ConvRow[]);
      if (!msgRes.error && msgRes.data) setMsgs(msgRes.data as MsgRow[]);
      // desk_csat / desk_ai_interactions podem não estar nos types gerados ainda —
      // os erros aqui são esperados até a migration/regeneração e não quebram a página.
      if (!csatRes.error && csatRes.data) setCsat(csatRes.data as CsatRow[]);
      if (!aiRes.error && aiRes.data) setAi(aiRes.data as AiRow[]);

      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const total = convs.length;
    const resolved = convs.filter((c) => c.status === "resolved");

    // Conversas com resposta de agente humano (mensagem pública sender=agent)
    const humanConvIds = new Set(
      msgs.filter((m) => m.sender_type === "agent").map((m) => m.conversation_id),
    );
    const aiOnly = resolved.filter((c) => !humanConvIds.has(c.id));
    const aiResolutionRate = resolved.length > 0 ? (aiOnly.length / resolved.length) * 100 : null;

    // Tempo de 1ª resposta (mediana, em minutos) — só onde a métrica existe
    const frtMinutes = convs
      .filter((c) => c.first_response_at)
      .map((c) => (new Date(c.first_response_at!).getTime() - new Date(c.created_at).getTime()) / 60000)
      .filter((m) => m >= 0);
    const medianFrt = median(frtMinutes);

    // SLA: dentro do prazo = primeira resposta antes do deadline
    const withSla = convs.filter((c) => c.sla_deadline && c.first_response_at);
    const slaOk = withSla.filter(
      (c) => new Date(c.first_response_at!) <= new Date(c.sla_deadline!),
    );
    const slaRate = withSla.length > 0 ? (slaOk.length / withSla.length) * 100 : null;

    // CSAT médio normalizado para 0–100 (rating 1–3)
    const csatAvg =
      csat.length > 0 ? (csat.reduce((s, r) => s + r.rating, 0) / csat.length / 3) * 100 : null;

    // Volume semanal de conversas
    const byWeek = new Map<string, number>();
    for (const c of convs) {
      const k = weekKey(c.created_at);
      byWeek.set(k, (byWeek.get(k) ?? 0) + 1);
    }
    const volumeData = [...byWeek.entries()].map(([week, count]) => ({ week, conversas: count }));

    // Mensagens por remetente por semana
    const msgWeeks = new Map<string, { bot: number; agente: number; cliente: number }>();
    for (const m of msgs) {
      const k = weekKey(m.created_at);
      const entry = msgWeeks.get(k) ?? { bot: 0, agente: 0, cliente: 0 };
      if (m.sender_type === "bot") entry.bot++;
      else if (m.sender_type === "agent") entry.agente++;
      else if (m.sender_type === "contact") entry.cliente++;
      msgWeeks.set(k, entry);
    }
    const msgData = [...msgWeeks.entries()].map(([week, v]) => ({ week, ...v }));

    // Intenções: tags intent:* gravadas pela IA + fallback de classificação local
    const intentCount = new Map<string, number>();
    for (const c of convs) {
      const tag = (c.tags ?? []).find((t) => t.startsWith("intent:"));
      if (tag) {
        const intent = tag.slice("intent:".length);
        intentCount.set(intent, (intentCount.get(intent) ?? 0) + 1);
      }
    }
    // Complementa com as intenções vindas do log da IA (cobre o período pré-tags)
    for (const row of ai) {
      const intent = row.context_sources?.intent;
      if (intent) intentCount.set(intent, (intentCount.get(intent) ?? 0) + 1);
    }
    const intentData = [...intentCount.entries()]
      .map(([intent, count]) => ({ intent: INTENT_LABELS[intent] ?? intent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // IA: latência e escalação (quando o log existir)
    const latencies = ai.map((a) => a.latency_ms).filter((v): v is number => v != null);
    const medianLatency = median(latencies);
    const escalated = ai.filter((a) => a.was_escalated).length;
    const escalationRate = ai.length > 0 ? (escalated / ai.length) * 100 : null;

    return {
      total,
      resolvedCount: resolved.length,
      aiResolutionRate,
      medianFrt,
      slaRate,
      csatAvg,
      csatCount: csat.length,
      volumeData,
      msgData,
      intentData,
      medianLatency,
      escalationRate,
      aiCount: ai.length,
      openNow: convs.filter((c) => c.status === "open").length,
      pendingNow: convs.filter((c) => c.status === "pending").length,
    };
  }, [convs, msgs, csat, ai]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-foreground" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-[13px] text-muted-foreground">
            Saúde do suporte nos últimos 90 dias · {stats.total} conversas
          </p>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={Bot}
          label="Resolvidas pela IA"
          value={stats.aiResolutionRate != null ? `${stats.aiResolutionRate.toFixed(0)}%` : "—"}
          hint={`${stats.resolvedCount} conversas resolvidas`}
        />
        <MetricCard
          icon={Clock}
          label="1ª resposta (mediana)"
          value={stats.medianFrt != null ? formatMinutes(stats.medianFrt) : "—"}
          hint={
            stats.medianFrt != null
              ? "Da abertura à primeira resposta"
              : "Métrica ativada nesta versão — começa a contar agora"
          }
        />
        <MetricCard
          icon={TrendingUp}
          label="SLA dentro do prazo"
          value={stats.slaRate != null ? `${stats.slaRate.toFixed(0)}%` : "—"}
          hint={
            stats.slaRate != null
              ? "1ª resposta antes do deadline"
              : "Métrica ativada nesta versão — começa a contar agora"
          }
        />
        <MetricCard
          icon={Smile}
          label="CSAT"
          value={stats.csatAvg != null ? `${stats.csatAvg.toFixed(0)}%` : "—"}
          hint={
            stats.csatCount > 0
              ? `${stats.csatCount} avaliações`
              : "Coleta ativada nesta versão — começa a contar agora"
          }
        />
      </div>

      {/* Now */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={MessageSquare} label="Abertas agora" value={String(stats.openNow)} />
        <MetricCard icon={Clock} label="Aguardando humano" value={String(stats.pendingNow)} />
        <MetricCard
          icon={Zap}
          label="Latência da IA (mediana)"
          value={stats.medianLatency != null ? `${(stats.medianLatency / 1000).toFixed(1)}s` : "—"}
          hint={stats.aiCount > 0 ? `${stats.aiCount} interações` : "Log ativado nesta versão"}
        />
        <MetricCard
          icon={Bot}
          label="Taxa de escalação"
          value={stats.escalationRate != null ? `${stats.escalationRate.toFixed(0)}%` : "—"}
          hint={stats.aiCount > 0 ? "IA → humano" : "Log ativado nesta versão"}
        />
      </div>

      {/* Volume chart */}
      <ChartCard title="Volume de conversas por semana">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={stats.volumeData}>
            <defs>
              <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9EC5FA" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#9EC5FA" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
            <ChartTooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="conversas" stroke="#5B96E8" strokeWidth={2} fill="url(#volGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Messages by sender */}
        <ChartCard title="Mensagens por remetente (semana)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.msgData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
              <ChartTooltip contentStyle={tooltipStyle} />
              <Bar dataKey="bot" name="IA" stackId="a" fill="#9EC5FA" radius={[0, 0, 0, 0]} />
              <Bar dataKey="agente" name="Agente" stackId="a" fill="#B19EFA" />
              <Bar dataKey="cliente" name="Cliente" stackId="a" fill="#D6D9CE" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Intent distribution */}
        <ChartCard title="Principais assuntos (intenção detectada pela IA)">
          {stats.intentData.length === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Bot className="h-8 w-8 opacity-30" />
              <p className="text-sm">Sem dados de intenção ainda</p>
              <p className="text-xs opacity-70 text-center max-w-[260px]">
                A detecção de intenção foi ativada nesta versão — cada nova conversa
                respondida pela IA aparece aqui automaticamente.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.intentData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="intent" width={140} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                <ChartTooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Conversas" radius={[0, 4, 4, 0]}>
                  {stats.intentData.map((_, i) => (
                    <Cell key={i} fill={INTENT_COLORS[i % INTENT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const tooltipStyle: React.CSSProperties = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 13,
  color: "hsl(var(--foreground))",
};

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>
      {children}
    </div>
  );
}
