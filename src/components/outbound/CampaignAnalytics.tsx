/**
 * CampaignAnalytics.tsx — O que aconteceu depois de publicar.
 *
 * Tudo em PESSOAS únicas (uma linha por cliente em desk_campaign_receipts),
 * não em impressões: "300 viram" quer dizer 300 clientes, mesmo que um deles
 * tenha aberto o widget dez vezes.
 */

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Eye, MousePointerClick, XCircle, Play, CheckCircle2, Sparkles, Clock } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listCampaignReceipts, type ReceiptRow } from "@/lib/outbound-api";
import { TYPE_LABELS, isTour, type Campaign, type CampaignStats, type TourContent } from "@/lib/outbound";
import { timeAgo } from "@/lib/dates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
  stats: CampaignStats | null;
}

const tooltipStyle: React.CSSProperties = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 13,
  color: "hsl(var(--foreground))",
};

function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

export function CampaignAnalytics({ open, onOpenChange, campaign, stats }: Props) {
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);

  useEffect(() => {
    if (!open || !campaign) return;
    let cancelled = false;
    setReceipts(null);
    listCampaignReceipts(campaign.id)
      .then((rows) => { if (!cancelled) setReceipts(rows); })
      .catch((err) => {
        console.error(err);
        toast.error("Erro ao carregar as métricas");
        if (!cancelled) setReceipts([]);
      });
    return () => { cancelled = true; };
  }, [open, campaign]);

  // Série diária de "viram" (últimos 30 dias, ou desde a publicação se for mais recente).
  const series = useMemo(() => {
    if (!receipts) return [];
    const start = startOfDay(subDays(new Date(), 29));
    const byDay = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      byDay.set(format(subDays(new Date(), 29 - i), "yyyy-MM-dd"), 0);
    }
    for (const r of receipts) {
      const d = new Date(r.first_seen_at);
      if (d < start) continue;
      const key = format(d, "yyyy-MM-dd");
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return [...byDay.entries()].map(([key, viram]) => ({
      dia: format(new Date(`${key}T12:00:00`), "dd/MM", { locale: ptBR }),
      viram,
    }));
  }, [receipts]);

  const funnel = useMemo(() => {
    if (!campaign || !isTour(campaign) || !receipts) return null;
    const steps = (campaign.content as TourContent).steps;
    return steps.map((s, i) => ({
      index: i,
      title: s.title || `Passo ${i + 1}`,
      reached: receipts.filter((r) => (r.step_reached ?? -1) >= i).length,
    }));
  }, [campaign, receipts]);

  const recent = useMemo(() => {
    if (!receipts) return [];
    return [...receipts]
      .sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at))
      .slice(0, 12);
  }, [receipts]);

  if (!campaign) return null;

  const seen = stats?.seen ?? receipts?.length ?? 0;
  const clicked = stats?.clicked ?? 0;
  const dismissed = stats?.dismissed ?? 0;
  const completed = stats?.completed ?? 0;
  const started = stats?.started ?? 0;
  const reactions = stats?.reactions ?? {};
  const tour = isTour(campaign);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <SheetTitle className="truncate">{campaign.name}</SheetTitle>
            <Badge variant="outline" className="text-[10px] shrink-0">{TYPE_LABELS[campaign.type]}</Badge>
          </div>
          <SheetDescription className="text-xs">
            {campaign.published_at
              ? `Publicado ${timeAgo(campaign.published_at)} · números em pessoas únicas`
              : "Ainda não publicado — os números abaixo vêm só dos e-mails de teste."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
          {/* Tiles */}
          <div className={`grid gap-3 ${tour ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            <Tile icon={Eye} label="Viram" value={seen.toLocaleString("pt-BR")} />
            {tour ? (
              <>
                <Tile icon={Play} label="Começaram" value={started.toLocaleString("pt-BR")} hint={`${pct(started, seen)} de quem viu`} />
                <Tile icon={CheckCircle2} label="Concluíram" value={completed.toLocaleString("pt-BR")} hint={`${pct(completed, seen)} de quem viu`} />
                <Tile icon={XCircle} label="Saíram" value={dismissed.toLocaleString("pt-BR")} hint={`${pct(dismissed, seen)} pularam o tour`} />
              </>
            ) : (
              <>
                <Tile icon={MousePointerClick} label="Clicaram" value={clicked.toLocaleString("pt-BR")} hint={`${pct(clicked, seen)} de quem viu`} />
                <Tile icon={XCircle} label="Fecharam sem interagir" value={dismissed.toLocaleString("pt-BR")} hint={`${pct(dismissed, seen)} de quem viu`} />
              </>
            )}
          </div>

          {/* Reações */}
          {Object.keys(reactions).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground mb-2"><Sparkles className="h-3.5 w-3.5" /> Reações</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(reactions).sort((a, b) => b[1] - a[1]).map(([emoji, n]) => (
                  <span key={emoji} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                    <span className="text-base leading-none">{emoji}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Série */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[12px] font-medium text-muted-foreground mb-3">Pessoas que viram por dia (últimos 30 dias)</p>
            {!receipts ? (
              <Skeleton className="h-[180px] rounded-lg" />
            ) : seen === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">Ninguém viu ainda.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="seenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9EC5FA" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#9EC5FA" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                  <ChartTooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="viram" name="Viram" stroke="#5B96E8" strokeWidth={2} fill="url(#seenGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Funil do tour */}
          {funnel && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[12px] font-medium text-muted-foreground mb-3">Até onde chegaram</p>
              {funnel.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tour sem passos.</p>
              ) : (
                <div className="space-y-2">
                  {funnel.map((f) => {
                    const base = funnel[0].reached || 1;
                    const width = Math.max(4, Math.round((f.reached / base) * 100));
                    return (
                      <div key={f.index} className="flex items-center gap-3 text-sm">
                        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{f.index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="truncate text-foreground">{f.title}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {f.reached} <span className="text-[11px]">({pct(f.reached, funnel[0].reached)})</span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Últimas interações */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground mb-2"><Clock className="h-3.5 w-3.5" /> Últimas pessoas</p>
            {!receipts ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 rounded-md" />)}</div>
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada ainda.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {recent.map((r) => (
                  <li key={r.email} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate font-mono text-xs text-foreground">{r.email}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {r.reaction && <span className="text-base leading-none">{r.reaction}</span>}
                      {r.completed_at && <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">concluiu</Badge>}
                      {r.clicked_at && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">clicou</Badge>}
                      {r.dismissed_at && !r.clicked_at && <Badge variant="outline" className="text-[10px] text-muted-foreground">fechou</Badge>}
                      {!r.clicked_at && !r.dismissed_at && !r.completed_at && !r.reaction && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">viu</Badge>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground w-20 text-right">{timeAgo(r.first_seen_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Eye; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11.5px] font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
