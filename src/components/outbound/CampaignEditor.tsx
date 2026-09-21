/**
 * CampaignEditor.tsx — Criar/editar um disparo, com prévia ao vivo ao lado.
 *
 * Esquerda: formulário (conteúdo por tipo, remetente, público, agenda).
 * Direita: CampaignPreview desenhando o disparo com os componentes reais do
 * widget a cada tecla. Publicar valida, grava e avisa os widgets abertos.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Rocket, Save, CalendarClock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { AudiencePicker } from "./AudiencePicker";
import { CampaignPreview } from "./CampaignPreview";
import { TourStepsEditor } from "./TourStepsEditor";
import { ImageField } from "./ImageField";
import { saveCampaign, notifyCampaignsChanged, type AgentOption, type CampaignDraft } from "@/lib/outbound-api";
import {
  BANNER_STYLE_LABELS,
  DEFAULT_AUDIENCE,
  NEWS_TAG_LABELS,
  TYPE_LABELS,
  emptyContent,
  validateCampaign,
  type BannerContent,
  type BannerStyle,
  type Campaign,
  type CampaignType,
  type CtaAction,
  type NewsContent,
  type NewsTag,
  type NoticeContent,
  type TourContent,
} from "@/lib/outbound";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editando um existente, ou null para criar do tipo `newType`. */
  campaign: Campaign | null;
  newType: CampaignType;
  agents: AgentOption[];
  /** Tours publicados/rascunho — para o botão "iniciar tour" de um aviso. */
  tours: Campaign[];
  onSaved: (saved: Campaign) => void;
}

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function draftFrom(campaign: Campaign | null, type: CampaignType, agentId: string | null): CampaignDraft {
  if (campaign) {
    return {
      id: campaign.id,
      type: campaign.type,
      name: campaign.name,
      status: campaign.status,
      content: campaign.content,
      audience: campaign.audience,
      priority: campaign.priority,
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      published_at: campaign.published_at,
      sender_agent_id: campaign.sender_agent_id,
    };
  }
  return {
    type,
    name: "",
    status: "draft",
    content: emptyContent(type),
    audience: { ...DEFAULT_AUDIENCE },
    priority: 0,
    starts_at: null,
    ends_at: null,
    published_at: null,
    sender_agent_id: type === "notice" || type === "news" ? agentId : null,
  };
}

export function CampaignEditor({ open, onOpenChange, campaign, newType, agents, tours, onSaved }: Props) {
  const agent = useAuthStore((s) => s.agent);
  const [draft, setDraft] = useState<CampaignDraft>(() => draftFrom(campaign, newType, agent?.id ?? null));
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  // Reabrir com outro disparo/tipo recomeça o formulário.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(campaign, newType, agent?.id ?? null));
      setStepIndex(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign?.id, newType]);

  const isEditingLive = !!draft.id && draft.status === "active";
  const scheduledForLater = !!draft.starts_at && new Date(draft.starts_at).getTime() > Date.now();

  const sender = useMemo(() => {
    const a = agents.find((x) => x.id === draft.sender_agent_id);
    return a ? { name: a.name, avatar_url: a.avatar_url } : null;
  }, [agents, draft.sender_agent_id]);

  function patch(p: Partial<CampaignDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function patchContent<T extends object>(p: Partial<T>) {
    setDraft((d) => ({ ...d, content: { ...(d.content as unknown as T), ...p } as unknown as CampaignDraft["content"] }));
  }

  async function persist(mode: "draft" | "publish") {
    const errors = validateCampaign(draft);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setSaving(mode);
    try {
      const next: CampaignDraft = { ...draft };
      if (mode === "publish") {
        next.status = "active";
        next.published_at = next.published_at ?? new Date().toISOString();
      } else if (!next.id) {
        next.status = "draft";
      }
      const saved = await saveCampaign(next, agent?.id ?? null);
      // Só o que está (ou estava) no ar muda algo para o cliente.
      if (saved.status === "active" || draft.status === "active") notifyCampaignsChanged();
      toast.success(
        mode === "publish"
          ? scheduledForLater ? "Disparo agendado" : "Disparo publicado"
          : isEditingLive ? "Alterações salvas" : "Rascunho salvo",
      );
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar o disparo");
    } finally {
      setSaving(null);
    }
  }

  const typeLabel = TYPE_LABELS[draft.type];
  const folder = `outbound/${draft.id ?? "novo"}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1040px] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <SheetTitle>{draft.id ? `Editar ${typeLabel.toLowerCase()}` : `Novo ${typeLabel.toLowerCase()}`}</SheetTitle>
          <SheetDescription className="text-xs">
            {isEditingLive
              ? "Este disparo está no ar — as alterações valem assim que você salvar."
              : "A prévia à direita mostra exatamente o que o cliente vai ver."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* ── Formulário ── */}
          <div className="overflow-y-auto scrollbar-thin px-6 py-5 space-y-6 border-r border-border">
            <Section title="Identificação">
              <div className="space-y-1.5">
                <Label htmlFor="c-name" className="text-xs">Nome interno</Label>
                <Input
                  id="c-name"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Ex.: Lançamento do painel de métricas"
                  className="h-9 text-sm"
                  maxLength={80}
                />
                <p className="text-[11px] text-muted-foreground">Só a equipe vê. O cliente vê o conteúdo abaixo.</p>
              </div>
            </Section>

            <Section title="Conteúdo">
              {draft.type === "notice" && (
                <NoticeForm content={draft.content as NoticeContent} onChange={patchContent} tours={tours} folder={folder} />
              )}
              {draft.type === "news" && (
                <NewsForm content={draft.content as NewsContent} onChange={patchContent} folder={folder} />
              )}
              {draft.type === "banner" && (
                <BannerForm content={draft.content as BannerContent} onChange={patchContent} />
              )}
              {draft.type === "tour" && (
                <TourForm
                  content={draft.content as TourContent}
                  onChange={patchContent}
                  stepIndex={stepIndex}
                  onStepIndexChange={setStepIndex}
                />
              )}
            </Section>

            {(draft.type === "notice" || draft.type === "news") && (
              <Section title="Remetente">
                <div className="space-y-1.5">
                  <Label className="text-xs">Quem assina</Label>
                  <Select
                    value={draft.sender_agent_id ?? "__team__"}
                    onValueChange={(v) => patch({ sender_agent_id: v === "__team__" ? null : v })}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__team__">Equipe Cloudfy (sem rosto)</SelectItem>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Um aviso assinado por uma pessoa converte mais que um assinado por "a equipe".</p>
                </div>
              </Section>
            )}

            <Section title="Público">
              <AudiencePicker value={draft.audience} onChange={(audience) => patch({ audience })} />
            </Section>

            <Section title="Agenda e prioridade">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-start" className="text-xs">Começa em</Label>
                  <Input
                    id="c-start"
                    type="datetime-local"
                    value={toLocalInput(draft.starts_at)}
                    onChange={(e) => patch({ starts_at: fromLocalInput(e.target.value) })}
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">Vazio = assim que publicar.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-end" className="text-xs">Termina em</Label>
                  <Input
                    id="c-end"
                    type="datetime-local"
                    value={toLocalInput(draft.ends_at)}
                    onChange={(e) => patch({ ends_at: fromLocalInput(e.target.value) })}
                    className="h-9 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">Vazio = até você pausar.</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Prioridade</Label>
                <Select value={String(draft.priority)} onValueChange={(v) => patch({ priority: Number(v) })}>
                  <SelectTrigger className="h-9 text-sm w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Normal</SelectItem>
                    <SelectItem value="10">Alta</SelectItem>
                    <SelectItem value="20">Máxima</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Quando mais de um {typeLabel.toLowerCase()} vale para o mesmo cliente, o de maior prioridade aparece primeiro.
                </p>
              </div>
            </Section>
          </div>

          {/* ── Prévia ── */}
          <div className="hidden lg:block overflow-y-auto scrollbar-thin px-5 py-5 bg-muted/20">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Prévia</p>
            <CampaignPreview
              type={draft.type}
              content={draft.content}
              sender={sender}
              stepIndex={Math.max(0, stepIndex)}
              onStepIndexChange={setStepIndex}
            />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border shrink-0 flex items-center gap-2 bg-card">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={!!saving}>
            Cancelar
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {!isEditingLive && (
              <Button variant="outline" size="sm" onClick={() => persist("draft")} disabled={!!saving} className="gap-1.5">
                {saving === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar rascunho
              </Button>
            )}
            <Button size="sm" onClick={() => persist("publish")} disabled={!!saving} className="gap-1.5">
              {saving === "publish"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : isEditingLive ? <Save className="h-3.5 w-3.5" />
                : scheduledForLater ? <CalendarClock className="h-3.5 w-3.5" />
                : <Rocket className="h-3.5 w-3.5" />}
              {isEditingLive ? "Salvar alterações" : scheduledForLater ? "Agendar" : "Publicar agora"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Blocos ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer">
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// ─── Aviso ───────────────────────────────────────────────────────────────────

function NoticeForm({ content, onChange, tours, folder }: {
  content: NoticeContent;
  onChange: (p: Partial<NoticeContent>) => void;
  tours: Campaign[];
  folder: string;
}) {
  const action = content.cta_action ?? "link";
  return (
    <div className="space-y-3">
      <Field id="n-title" label="Título">
        <Input id="n-title" value={content.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex.: Novo: backups automáticos" className="h-9 text-sm" maxLength={80} />
      </Field>
      <Field id="n-body" label="Texto" hint="Markdown simples: **negrito**, listas, links.">
        <Textarea id="n-body" value={content.body} onChange={(e) => onChange({ body: e.target.value })} rows={4} className="text-sm" placeholder="Um recado curto. Duas ou três frases bastam." maxLength={1200} />
      </Field>
      <ImageField id="n-image" label="Imagem (opcional)" value={content.image_url} onChange={(url) => onChange({ image_url: url })} folder={folder} />

      <Field label="Onde aparece">
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "popup", label: "Flutuando sobre a página", hint: "Aparece mesmo com o widget fechado — maior alcance" },
            { value: "card", label: "Só dentro do widget", hint: "Card no topo da lista de chamados" },
          ] as const).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange({ display: o.value })}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                content.display === o.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              <p className="text-sm font-medium text-foreground">{o.label}</p>
              <p className="text-[11px] text-muted-foreground">{o.hint}</p>
            </button>
          ))}
        </div>
      </Field>

      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <Field id="n-cta" label="Botão (opcional)">
          <Input id="n-cta" value={content.cta_label ?? ""} onChange={(e) => onChange({ cta_label: e.target.value })} placeholder="Ex.: Ver como funciona" className="h-9 text-sm" maxLength={40} />
        </Field>
        <Field label="O botão">
          <Select value={action} onValueChange={(v) => onChange({ cta_action: v as CtaAction })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="link">Abre um link</SelectItem>
              <SelectItem value="open_chat">Abre o chat</SelectItem>
              <SelectItem value="start_tour">Inicia um tour guiado</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {action === "link" && (
        <Field id="n-url" label="Link do botão">
          <Input id="n-url" value={content.cta_url ?? ""} onChange={(e) => onChange({ cta_url: e.target.value })} placeholder="https://…" className="h-9 text-sm" />
        </Field>
      )}
      {action === "start_tour" && (
        <Field label="Tour" hint={tours.length === 0 ? "Crie um tour guiado primeiro." : undefined}>
          <Select value={content.cta_tour_id ?? ""} onValueChange={(v) => onChange({ cta_tour_id: v })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Escolha o tour" /></SelectTrigger>
            <SelectContent>
              {tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

// ─── Novidade ────────────────────────────────────────────────────────────────

function NewsForm({ content, onChange, folder }: {
  content: NewsContent;
  onChange: (p: Partial<NewsContent>) => void;
  folder: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <Field id="w-title" label="Título">
          <Input id="w-title" value={content.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex.: Painel de métricas em tempo real" className="h-9 text-sm" maxLength={100} />
        </Field>
        <Field label="Etiqueta">
          <Select value={content.tag ?? "novo"} onValueChange={(v) => onChange({ tag: v as NewsTag })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(NEWS_TAG_LABELS) as NewsTag[]).map((k) => <SelectItem key={k} value={k}>{NEWS_TAG_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field id="w-body" label="Texto" hint="Markdown: **negrito**, listas, links, imagens. Textos longos aparecem recolhidos com “Ler tudo”.">
        <Textarea id="w-body" value={content.body} onChange={(e) => onChange({ body: e.target.value })} rows={7} className="text-sm" placeholder="Conte o que mudou, para quem serve e como usar." maxLength={5000} />
      </Field>
      <ImageField id="w-image" label="Imagem de capa (opcional)" value={content.image_url} onChange={(url) => onChange({ image_url: url })} folder={folder} />
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <Field id="w-link" label="Link “saiba mais” (opcional)">
          <Input id="w-link" value={content.link_url ?? ""} onChange={(e) => onChange({ link_url: e.target.value })} placeholder="https://…" className="h-9 text-sm" />
        </Field>
        <Field id="w-link-label" label="Texto do link">
          <Input id="w-link-label" value={content.link_label ?? ""} onChange={(e) => onChange({ link_label: e.target.value })} placeholder="Saiba mais" className="h-9 text-sm" maxLength={30} />
        </Field>
      </div>
      <ToggleRow checked={content.allow_reactions} onChange={(v) => onChange({ allow_reactions: v })} label="Permitir reações (👍 ❤️ 🎉)" hint="Você vê a contagem nas métricas." />
    </div>
  );
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function BannerForm({ content, onChange }: { content: BannerContent; onChange: (p: Partial<BannerContent>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[72px_1fr] gap-3">
        <Field id="b-emoji" label="Ícone">
          <Input id="b-emoji" value={content.emoji ?? ""} onChange={(e) => onChange({ emoji: e.target.value.slice(0, 4) })} placeholder="📣" className="h-9 text-center text-base" />
        </Field>
        <Field id="b-text" label="Texto">
          <Input id="b-text" value={content.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Ex.: Manutenção programada sábado, 02h–04h" className="h-9 text-sm" maxLength={140} />
        </Field>
      </div>
      <Field label="Estilo">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(BANNER_STYLE_LABELS) as BannerStyle[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ style: k })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                content.style === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {BANNER_STYLE_LABELS[k]}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-[160px_1fr] gap-3">
        <Field id="b-cta" label="Botão (opcional)">
          <Input id="b-cta" value={content.cta_label ?? ""} onChange={(e) => onChange({ cta_label: e.target.value })} placeholder="Ver detalhes" className="h-9 text-sm" maxLength={30} />
        </Field>
        <Field id="b-url" label="Link do botão">
          <Input id="b-url" value={content.cta_url ?? ""} onChange={(e) => onChange({ cta_url: e.target.value })} placeholder="https://…" className="h-9 text-sm" />
        </Field>
      </div>
      <ToggleRow checked={content.dismissible} onChange={(v) => onChange({ dismissible: v })} label="Cliente pode fechar" hint="Fechou, some para ele. Desligue só para avisos críticos." />
      <ToggleRow checked={content.show_when_closed} onChange={(v) => onChange({ show_when_closed: v })} label="Mostrar também com o widget fechado" hint="Pílula acima da bolha — mais alcance, mais intrusivo." />
    </div>
  );
}

// ─── Tour ────────────────────────────────────────────────────────────────────

function TourForm({ content, onChange, stepIndex, onStepIndexChange }: {
  content: TourContent;
  onChange: (p: Partial<TourContent>) => void;
  stepIndex: number;
  onStepIndexChange: (i: number) => void;
}) {
  return (
    <div className="space-y-4">
      <TourStepsEditor
        steps={content.steps}
        onChange={(steps) => onChange({ steps })}
        activeIndex={stepIndex}
        onActiveIndexChange={onStepIndexChange}
      />
      <Separator />
      <ToggleRow checked={content.auto_start} onChange={(v) => onChange({ auto_start: v })} label="Começar sozinho" hint="Abre quando o cliente entra na página abaixo (uma vez por cliente)." />
      {content.auto_start && (
        <Field id="t-start" label="Página que dispara o tour" hint="Vazio = qualquer página do app. Use o mesmo formato do público por página.">
          <Input id="t-start" value={content.start_url ?? ""} onChange={(e) => onChange({ start_url: e.target.value })} placeholder="/app/instancias" className="h-9 text-sm font-mono" />
        </Field>
      )}
      <ToggleRow checked={content.list_in_news} onChange={(v) => onChange({ list_in_news: v })} label="Listar em Novidades" hint="O cliente pode iniciar (ou rever) o tour pelo widget quando quiser." />
      <ToggleRow checked={content.show_progress} onChange={(v) => onChange({ show_progress: v })} label="Mostrar progresso" hint="“Passo 2 de 5” e os pontinhos." />
      <Field id="t-finish" label="Mensagem final (opcional)" hint="Card de encerramento. Vazio = o tour termina no último passo.">
        <Textarea id="t-finish" value={content.finish_message ?? ""} onChange={(e) => onChange({ finish_message: e.target.value })} rows={2} className="text-sm" placeholder="Pronto! Agora você já sabe criar instâncias. Qualquer dúvida, é só chamar no chat. 🙌" maxLength={400} />
      </Field>
    </div>
  );
}
