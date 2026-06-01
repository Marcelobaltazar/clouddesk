import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tag,
  LayoutGrid,
  Timer,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeskTag {
  id: string;
  name: string;
  color: string;
}

interface DeskView {
  id: string;
  name: string;
  emoji: string | null;
  color: string;
  order_index: number;
  filters: ViewFilters;
  is_active: boolean;
}

interface ViewFilters {
  plan_product?: string;
  status?: string;
  priority?: string;
}

interface SlaPolicy {
  id: string;
  name: string;
  description: string | null;
  plan: string | null;
  priority: string | null;
  first_response_minutes: number;
  resolution_minutes: number;
  is_active: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
];

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="h-full flex flex-col p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2 mb-6">
        <SettingsIcon className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Configurações</h1>
      </div>

      <Tabs defaultValue="tags" className="flex-1">
        <TabsList className="mb-6">
          <TabsTrigger value="tags" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Tags
          </TabsTrigger>
          <TabsTrigger value="views" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Visualizações
          </TabsTrigger>
          <TabsTrigger value="sla" className="gap-1.5">
            <Timer className="h-3.5 w-3.5" /> SLA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tags">
          <TagsTab />
        </TabsContent>
        <TabsContent value="views">
          <ViewsTab />
        </TabsContent>
        <TabsContent value="sla">
          <SlaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tags tab ─────────────────────────────────────────────────────────────────

function TagsTab() {
  const [tags, setTags] = useState<DeskTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("desk_tags")
      .select("id, name, color")
      .order("name");
    if (error) {
      toast.error("Erro ao carregar tags");
    } else {
      setTags((data ?? []) as DeskTag[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("desk_tags")
      .insert({ name: newName.trim(), color: newColor });
    setSaving(false);
    if (error) {
      toast.error("Erro ao criar tag");
      return;
    }
    toast.success("Tag criada");
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("desk_tags").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao deletar tag");
      return;
    }
    toast.success("Tag removida");
    setTags((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tags são usadas para categorizar conversas.
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova tag
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <Input
            placeholder="Nome da tag"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? "Salvando..." : "Criar"}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 rounded-lg" />)}
        </div>
      ) : tags.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhuma tag criada ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <Badge
                variant="outline"
                className="border gap-1.5 text-xs"
                style={{ borderColor: tag.color, color: tag.color }}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                onClick={() => handleDelete(tag.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Views tab ────────────────────────────────────────────────────────────────

// "__all__" is a sentinel value used internally because shadcn Select
// does not accept empty strings as SelectItem values.
const STATUS_ALL = "__all__";
const PRIORITY_ALL = "__all__";

const statusOptions = [
  { value: STATUS_ALL, label: "Todos" },
  { value: "open",     label: "Aberta"    },
  { value: "pending",  label: "Pendente"  },
  { value: "resolved", label: "Resolvida" },
  { value: "snoozed",  label: "Adiada"    },
];

const priorityOptions = [
  { value: PRIORITY_ALL, label: "Todas"   },
  { value: "low",        label: "Baixa"   },
  { value: "medium",     label: "Média"   },
  { value: "high",       label: "Alta"    },
  { value: "urgent",     label: "Urgente" },
];

interface ViewFormState {
  name: string;
  emoji: string;
  color: string;
  order_index: string;
  filter_product: string;
  filter_status: string;
  filter_priority: string;
}

const emptyViewForm = (): ViewFormState => ({
  name: "",
  emoji: "",
  color: PRESET_COLORS[0],
  order_index: "0",
  filter_product: "",
  filter_status: STATUS_ALL,
  filter_priority: PRIORITY_ALL,
});

function ViewsTab() {
  const [views, setViews] = useState<DeskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ViewFormState>(emptyViewForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("desk_views")
      .select("id, name, emoji, color, order_index, filters, is_active")
      .order("order_index");
    if (error) {
      toast.error("Erro ao carregar visualizações");
    } else {
      setViews((data ?? []) as DeskView[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setField<K extends keyof ViewFormState>(key: K, value: ViewFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    if (!form.name.trim()) return;
    setSaving(true);

    const filters: ViewFilters = {};
    if (form.filter_product.trim()) filters.plan_product = form.filter_product.trim();
    if (form.filter_status !== STATUS_ALL) filters.status = form.filter_status;
    if (form.filter_priority !== PRIORITY_ALL) filters.priority = form.filter_priority;

    const { error } = await supabase.from("desk_views").insert({
      name: form.name.trim(),
      emoji: form.emoji.trim() || null,
      color: form.color,
      order_index: parseInt(form.order_index) || 0,
      filters,
      is_active: true,
    });

    setSaving(false);
    if (error) {
      toast.error("Erro ao criar visualização");
      return;
    }
    toast.success("Visualização criada");
    setForm(emptyViewForm());
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("desk_views").delete().eq("id", id);
    if (error) { toast.error("Erro ao deletar visualização"); return; }
    toast.success("Visualização removida");
    setViews((prev) => prev.filter((v) => v.id !== id));
  }

  async function handleToggleActive(view: DeskView) {
    const { error } = await supabase
      .from("desk_views")
      .update({ is_active: !view.is_active })
      .eq("id", view.id);
    if (error) { toast.error("Erro ao atualizar visualização"); return; }
    setViews((prev) =>
      prev.map((v) => (v.id === view.id ? { ...v, is_active: !v.is_active } : v))
    );
  }

  async function handleMove(view: DeskView, direction: "up" | "down") {
    const sorted = [...views].sort((a, b) => a.order_index - b.order_index);
    const idx = sorted.findIndex((v) => v.id === view.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const current = sorted[idx];
    const swapTarget = sorted[swapIdx];
    const newOrder = current.order_index;
    const swapOrder = swapTarget.order_index;

    // Swap order_index values
    const updates = [
      supabase.from("desk_views").update({ order_index: swapOrder }).eq("id", current.id),
      supabase.from("desk_views").update({ order_index: newOrder }).eq("id", swapTarget.id),
    ];
    const results = await Promise.all(updates);
    if (results.some((r) => r.error)) {
      toast.error("Erro ao reordenar");
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Visualizações filtram a inbox por critérios pré-configurados.
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova visualização
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nome *</label>
              <Input
                placeholder="Ex: Clientes MAX urgentes"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Emoji</label>
              <Input
                placeholder="🔥"
                value={form.emoji}
                onChange={(e) => setField("emoji", e.target.value)}
                maxLength={2}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Cor</label>
              <ColorPicker value={form.color} onChange={(c) => setField("color", c)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Ordem</label>
              <Input
                type="number"
                min="0"
                value={form.order_index}
                onChange={(e) => setField("order_index", e.target.value)}
              />
            </div>
          </div>

          <Separator />
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Filtros
          </p>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Plano (CRM)</label>
              <Input
                placeholder="Ex: Cloud Max, Cloud Starter"
                value={form.filter_product}
                onChange={(e) => setField("filter_product", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select
                  value={form.filter_status}
                  onValueChange={(v) => setField("filter_status", v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Prioridade</label>
                <Select
                  value={form.filter_priority}
                  onValueChange={(v) => setField("filter_priority", v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(emptyViewForm()); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!form.name.trim() || saving}>
              {saving ? "Salvando..." : "Criar"}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : views.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhuma visualização criada ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {[...views]
            .sort((a, b) => a.order_index - b.order_index)
            .map((view) => (
              <div
                key={view.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                {/* Move buttons */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => handleMove(view, "up")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleMove(view, "down")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>

                {/* Color dot */}
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: view.color }}
                />

                {/* Name + filters */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground truncate">
                    {view.emoji && <span className="mr-1">{view.emoji}</span>}
                    {view.name}
                  </p>
                  <ViewFilterSummary filters={view.filters} />
                </div>

                {/* Toggle active */}
                <Switch
                  checked={view.is_active}
                  onCheckedChange={() => handleToggleActive(view)}
                  className="shrink-0"
                />

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-rose-500 shrink-0"
                  onClick={() => handleDelete(view.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ViewFilterSummary({ filters }: { filters: ViewFilters }) {
  const parts: string[] = [];
  if (filters.plan_product) parts.push(`Plano: ${filters.plan_product}`);
  if (filters.status) {
    const label = statusOptions.find((o) => o.value === filters.status)?.label ?? filters.status;
    parts.push(`Status: ${label}`);
  }
  if (filters.priority) {
    const label = priorityOptions.find((o) => o.value === filters.priority)?.label ?? filters.priority;
    parts.push(`Prioridade: ${label}`);
  }
  if (parts.length === 0) return <p className="text-[10px] text-muted-foreground">Sem filtros</p>;
  return <p className="text-[10px] text-muted-foreground truncate">{parts.join(" · ")}</p>;
}

// ─── SLA tab ──────────────────────────────────────────────────────────────────

interface SlaFormState {
  name: string;
  plan: string;
  priority: string;
  first_response_minutes: string;
  resolution_minutes: string;
}

const SLA_PRIORITY_NONE = "__none__";

const emptySlaForm = (): SlaFormState => ({
  name: "",
  plan: "",
  priority: SLA_PRIORITY_NONE,
  first_response_minutes: "60",
  resolution_minutes: "480",
});

const priorityLabels: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

function SlaTab() {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SlaFormState>(emptySlaForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("desk_sla_policies")
      .select("id, name, description, plan, priority, first_response_minutes, resolution_minutes, is_active")
      .order("name");
    if (error) {
      toast.error("Erro ao carregar políticas de SLA");
    } else {
      setPolicies((data ?? []) as SlaPolicy[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setField<K extends keyof SlaFormState>(key: K, value: SlaFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    if (!form.name.trim()) return;
    setSaving(true);

    const { error } = await supabase.from("desk_sla_policies").insert({
      name: form.name.trim(),
      plan: form.plan.trim() || null,
      priority: form.priority === SLA_PRIORITY_NONE ? null : form.priority || null,
      first_response_minutes: parseInt(form.first_response_minutes) || 60,
      resolution_minutes: parseInt(form.resolution_minutes) || 480,
      is_active: true,
    });

    setSaving(false);
    if (error) {
      toast.error("Erro ao criar política de SLA");
      return;
    }
    toast.success("Política de SLA criada");
    setForm(emptySlaForm());
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("desk_sla_policies").delete().eq("id", id);
    if (error) { toast.error("Erro ao deletar política"); return; }
    toast.success("Política removida");
    setPolicies((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleToggleActive(policy: SlaPolicy) {
    const { error } = await supabase
      .from("desk_sla_policies")
      .update({ is_active: !policy.is_active })
      .eq("id", policy.id);
    if (error) { toast.error("Erro ao atualizar política"); return; }
    setPolicies((prev) =>
      prev.map((p) => (p.id === policy.id ? { ...p, is_active: !p.is_active } : p))
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Defina tempos de resposta por plano e prioridade.
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Nova política
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nome *</label>
              <Input
                placeholder="Ex: MAX Urgente"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Plano (CRM)</label>
              <Input
                placeholder="Ex: Cloud Max"
                value={form.plan}
                onChange={(e) => setField("plan", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Prioridade</label>
            <Select value={form.priority} onValueChange={(v) => setField("priority", v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Qualquer prioridade (padrão)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Qualquer (padrão)</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Primeira resposta (minutos)
              </label>
              <Input
                type="number"
                min="1"
                value={form.first_response_minutes}
                onChange={(e) => setField("first_response_minutes", e.target.value)}
              />
              {form.first_response_minutes && (
                <p className="text-[10px] text-muted-foreground">
                  = {formatMinutes(parseInt(form.first_response_minutes) || 0)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Resolução (minutos)
              </label>
              <Input
                type="number"
                min="1"
                value={form.resolution_minutes}
                onChange={(e) => setField("resolution_minutes", e.target.value)}
              />
              {form.resolution_minutes && (
                <p className="text-[10px] text-muted-foreground">
                  = {formatMinutes(parseInt(form.resolution_minutes) || 0)}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(emptySlaForm()); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!form.name.trim() || saving}>
              {saving ? "Salvando..." : "Criar"}
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : policies.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhuma política criada ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {policies.map((policy) => (
            <div
              key={policy.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-3 py-3",
                policy.is_active ? "border-border" : "border-border opacity-50"
              )}
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-card-foreground">{policy.name}</p>
                  {policy.plan && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {policy.plan}
                    </Badge>
                  )}
                  {policy.priority && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-indigo-400 border-indigo-400/30">
                      {priorityLabels[policy.priority] ?? policy.priority}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  1ª resposta: <span className="text-card-foreground font-medium">{formatMinutes(policy.first_response_minutes)}</span>
                  {" · "}
                  Resolução: <span className="text-card-foreground font-medium">{formatMinutes(policy.resolution_minutes)}</span>
                </p>
              </div>

              <Switch
                checked={policy.is_active}
                onCheckedChange={() => handleToggleActive(policy)}
                className="shrink-0"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-rose-500 shrink-0"
                onClick={() => handleDelete(policy.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared: ColorPicker ──────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          className={cn(
            "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
            value === color ? "border-white scale-110" : "border-transparent"
          )}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}
