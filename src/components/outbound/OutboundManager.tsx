/**
 * OutboundManager.tsx — Configurações › Disparos.
 *
 * Lista tudo que já foi criado (avisos, novidades, banners, tours), com estado,
 * público, agenda e os números principais; abre o editor e as métricas.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Megaphone, Newspaper, PanelTop, Compass, Search, MoreHorizontal, Pencil, BarChart3,
  Copy, Pause, Play, Archive, ArchiveRestore, Trash2, Eye, MousePointerClick, XCircle, CheckCircle2, CalendarClock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { CampaignEditor } from "./CampaignEditor";
import { CampaignAnalytics } from "./CampaignAnalytics";
import {
  deleteCampaign, duplicateCampaign, listAgents, listCampaigns, listCampaignStats,
  notifyCampaignsChanged, setCampaignStatus, type AgentOption,
} from "@/lib/outbound-api";
import {
  STATUS_LABELS, TYPE_DESCRIPTIONS, TYPE_LABELS, TYPE_LABELS_PLURAL,
  campaignHeadline, derivedStatus, describeAudience,
  type Campaign, type CampaignStats, type CampaignType, type DerivedStatus,
} from "@/lib/outbound";
import { formatDateTimeBR, timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<CampaignType, typeof Megaphone> = {
  notice: Megaphone,
  news: Newspaper,
  banner: PanelTop,
  tour: Compass,
};

const STATUS_STYLES: Record<DerivedStatus, string> = {
  draft: "border-border text-muted-foreground",
  scheduled: "border-sky-500/40 text-sky-600 bg-sky-500/10",
  active: "border-emerald-500/40 text-emerald-600 bg-emerald-500/10",
  paused: "border-amber-500/40 text-amber-600 bg-amber-500/10",
  ended: "border-border text-muted-foreground bg-muted/40",
  archived: "border-border text-muted-foreground/70",
};

type TypeFilter = "all" | CampaignType;
type StatusFilter = "all" | "live" | "draft" | "paused" | "archived";

export function OutboundManager() {
  const agent = useAuthStore((s) => s.agent);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Record<string, CampaignStats>>({});
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [newType, setNewType] = useState<CampaignType>("notice");
  const [analyticsFor, setAnalyticsFor] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, statMap, agentList] = await Promise.all([listCampaigns(), listCampaignStats(), listAgents()]);
      setCampaigns(list);
      setStats(statMap);
      setAgents(agentList);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar os disparos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      const ds = derivedStatus(c);
      if (statusFilter === "live" && !(ds === "active" || ds === "scheduled")) return false;
      if (statusFilter === "draft" && ds !== "draft") return false;
      if (statusFilter === "paused" && !(ds === "paused" || ds === "ended")) return false;
      if (statusFilter === "archived" && ds !== "archived") return false;
      if (statusFilter === "all" && ds === "archived") return false;
      if (q && !`${c.name} ${campaignHeadline(c)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, typeFilter, statusFilter, search]);

  const liveCount = useMemo(
    () => campaigns.filter((c) => derivedStatus(c) === "active").length,
    [campaigns],
  );

  function openNew(type: CampaignType) {
    setNewType(type);
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(c: Campaign) {
    setEditing(c);
    setNewType(c.type);
    setEditorOpen(true);
  }

  function upsertLocal(saved: Campaign) {
    setCampaigns((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      const next = exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev];
      return [...next].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    });
  }

  async function changeStatus(c: Campaign, status: Campaign["status"], okMessage: string) {
    setBusyId(c.id);
    const republishEnded = status === "active" && derivedStatus(c) === "ended";
    try {
      await setCampaignStatus(c.id, status, { clear_ends_at: republishEnded });
      const updated: Campaign = {
        ...c,
        status,
        ends_at: republishEnded ? null : c.ends_at,
        published_at: status === "active" ? new Date().toISOString() : c.published_at,
        updated_at: new Date().toISOString(),
      };
      upsertLocal(updated);
      notifyCampaignsChanged();
      toast.success(okMessage);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar o disparo");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicate(c: Campaign) {
    setBusyId(c.id);
    try {
      const copy = await duplicateCampaign(c, agent?.id ?? null);
      upsertLocal(copy);
      toast.success("Cópia criada como rascunho");
      openEdit(copy);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao duplicar");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteCampaign(target.id);
      setCampaigns((prev) => prev.filter((c) => c.id !== target.id));
      if (target.status === "active") notifyCampaignsChanged();
      toast.success("Disparo excluído");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao excluir");
    }
  }

  const tours = useMemo(() => campaigns.filter((c) => c.type === "tour" && c.status !== "archived"), [campaigns]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Comunicação e marketing direto no bubble do cliente: avisos, novidades, banners e tours guiados.
          </p>
          {!loading && (
            <p className="text-xs text-muted-foreground mt-1">
              {liveCount === 0 ? "Nenhum disparo no ar." : `${liveCount} no ar agora.`}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" /> Novo disparo
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="text-xs text-muted-foreground">O que você quer criar?</DropdownMenuLabel>
            {(Object.keys(TYPE_LABELS) as CampaignType[]).map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <DropdownMenuItem key={type} onClick={() => openNew(type)} className="items-start gap-3 py-2.5">
                  <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">{TYPE_LABELS[type]}</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">{TYPE_DESCRIPTIONS[type]}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
          {([["all", "Todos"], ["notice", TYPE_LABELS_PLURAL.notice], ["news", TYPE_LABELS_PLURAL.news], ["banner", TYPE_LABELS_PLURAL.banner], ["tour", TYPE_LABELS_PLURAL.tour]] as Array<[TypeFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                typeFilter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Ativos e rascunhos</SelectItem>
            <SelectItem value="live">No ar / agendados</SelectItem>
            <SelectItem value="draft">Rascunhos</SelectItem>
            <SelectItem value="paused">Pausados / encerrados</SelectItem>
            <SelectItem value="archived">Arquivados</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" className="h-8 w-48 pl-8 text-xs" />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Megaphone className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {campaigns.length === 0 ? "Nenhum disparo criado ainda" : "Nada aqui com esses filtros"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            {campaigns.length === 0
              ? "Comece com um aviso curto ou anuncie uma novidade."
              : "Tente outro tipo ou estado."}
          </p>
          {campaigns.length === 0 && (
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => openNew("notice")} className="gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Criar aviso</Button>
              <Button size="sm" variant="outline" onClick={() => openNew("news")} className="gap-1.5"><Newspaper className="h-3.5 w-3.5" /> Anunciar novidade</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              stats={stats[c.id] ?? null}
              busy={busyId === c.id}
              onEdit={() => openEdit(c)}
              onAnalytics={() => setAnalyticsFor(c)}
              onDuplicate={() => void handleDuplicate(c)}
              onPublish={() => void changeStatus(c, "active", "Disparo publicado")}
              onPause={() => void changeStatus(c, "paused", "Disparo pausado")}
              onResume={() => void changeStatus(c, "active", "Disparo de volta ao ar")}
              onArchive={() => void changeStatus(c, "archived", "Disparo arquivado")}
              onRestore={() => void changeStatus(c, "draft", "Disparo restaurado como rascunho")}
              onDelete={() => setDeleteTarget(c)}
            />
          ))}
        </div>
      )}

      <CampaignEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        campaign={editing}
        newType={newType}
        agents={agents}
        tours={tours}
        onSaved={(saved) => {
          upsertLocal(saved);
          // Métricas de um disparo recém-criado ainda não existem; recarregar
          // a lista inteira garante estado/ordem certos vindos do banco.
          void load();
        }}
      />

      <CampaignAnalytics
        open={!!analyticsFor}
        onOpenChange={(open) => { if (!open) setAnalyticsFor(null); }}
        campaign={analyticsFor}
        stats={analyticsFor ? stats[analyticsFor.id] ?? null : null}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Some para os clientes na hora e as métricas dele são apagadas junto. Se quiser guardar os números, arquive em vez de excluir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Linha ───────────────────────────────────────────────────────────────────

function CampaignRow({
  campaign: c, stats, busy, onEdit, onAnalytics, onDuplicate, onPublish, onPause, onResume, onArchive, onRestore, onDelete,
}: {
  campaign: Campaign;
  stats: CampaignStats | null;
  busy: boolean;
  onEdit: () => void;
  onAnalytics: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onPause: () => void;
  onResume: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICONS[c.type];
  const ds = derivedStatus(c);
  const headline = campaignHeadline(c);
  const isTour = c.type === "tour";

  const schedule =
    ds === "scheduled" && c.starts_at ? `Começa ${formatDateTimeBR(c.starts_at)}`
    : ds === "ended" && c.ends_at ? `Encerrou ${formatDateTimeBR(c.ends_at)}`
    : ds === "active" && c.ends_at ? `Até ${formatDateTimeBR(c.ends_at)}`
    : c.published_at ? `Publicado ${timeAgo(c.published_at)}`
    : `Editado ${timeAgo(c.updated_at)}`;

  return (
    <div className={cn("rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3 transition-opacity", busy && "opacity-60")}>
      <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center mt-0.5">
        <Icon className="h-4 w-4" />
      </div>

      <button type="button" onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
          <Badge variant="outline" className={cn("text-[10px] gap-1", STATUS_STYLES[ds])}>
            {ds === "scheduled" && <CalendarClock className="h-3 w-3" />}
            {STATUS_LABELS[ds]}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{TYPE_LABELS[c.type]}</span>
        </div>
        {headline !== c.name && (
          <p className="text-xs text-foreground/80 truncate mt-0.5">“{headline}”</p>
        )}
        <p className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1">
          <Users className="h-3 w-3 shrink-0" />
          {describeAudience(c.audience)} · {schedule}
        </p>
      </button>

      <button type="button" onClick={onAnalytics} className="hidden sm:flex items-center gap-3 shrink-0 text-xs tabular-nums text-muted-foreground hover:text-foreground mt-1" title="Ver métricas">
        <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {stats?.seen ?? 0}</span>
        {isTour ? (
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {stats?.completed ?? 0}</span>
        ) : (
          <span className="flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {stats?.clicked ?? 0}</span>
        )}
        <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> {stats?.dismissed ?? 0}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="Ações">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
          <DropdownMenuItem onClick={onAnalytics}><BarChart3 className="h-3.5 w-3.5 mr-2" /> Métricas</DropdownMenuItem>
          <DropdownMenuItem onClick={onDuplicate}><Copy className="h-3.5 w-3.5 mr-2" /> Duplicar</DropdownMenuItem>
          <DropdownMenuSeparator />
          {(ds === "draft") && (
            <DropdownMenuItem onClick={onPublish}><Play className="h-3.5 w-3.5 mr-2" /> Publicar agora</DropdownMenuItem>
          )}
          {(ds === "active" || ds === "scheduled") && (
            <DropdownMenuItem onClick={onPause}><Pause className="h-3.5 w-3.5 mr-2" /> Pausar</DropdownMenuItem>
          )}
          {(ds === "paused" || ds === "ended") && (
            <DropdownMenuItem onClick={onResume}><Play className="h-3.5 w-3.5 mr-2" /> {ds === "ended" ? "Publicar de novo" : "Retomar"}</DropdownMenuItem>
          )}
          {ds !== "archived" ? (
            <DropdownMenuItem onClick={onArchive}><Archive className="h-3.5 w-3.5 mr-2" /> Arquivar</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onRestore}><ArchiveRestore className="h-3.5 w-3.5 mr-2" /> Restaurar</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-rose-500 focus:text-rose-500">
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
