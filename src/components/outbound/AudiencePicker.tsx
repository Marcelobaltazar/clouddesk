import { useEffect, useState } from "react";
import { Users, Loader2, X, Plus, FlaskConical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  INFRA_LABELS,
  PLAN_LABELS,
  PLAN_OPTIONS,
  type AudienceInfra,
  type AudienceSegment,
  type CampaignAudience,
  type PlanKey,
} from "@/lib/outbound";
import { estimateAudience, type AudienceEstimate } from "@/lib/outbound-api";
import { cn } from "@/lib/utils";

interface Props {
  value: CampaignAudience;
  onChange: (next: CampaignAudience) => void;
  /** Tours e banners fazem sentido por página; avisos e novidades também podem. */
  showUrl?: boolean;
}

const SEGMENTS: Array<{ value: AudienceSegment; label: string; hint: string }> = [
  { value: "all", label: "Todos", hint: "Qualquer cliente logado" },
  { value: "with_plan", label: "Com plano ativo", hint: "Tem pelo menos uma assinatura ativa" },
  { value: "without_plan", label: "Sem plano", hint: "Criou conta mas não assina nada" },
  { value: "plans", label: "Planos específicos", hint: "Escolha quais planos" },
];

/** Debounce curto: o operador mexe em vários filtros seguidos. */
const ESTIMATE_DEBOUNCE_MS = 500;

export function AudiencePicker({ value, onChange, showUrl = true }: Props) {
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");

  // Só os campos avaliados no servidor entram na estimativa (a página não).
  const estimateKey = JSON.stringify({
    segment: value.segment, plans: value.plans, infra: value.infra, days: value.new_customer_days,
  });

  useEffect(() => {
    let cancelled = false;
    setEstimating(true);
    setEstimateError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await estimateAudience(value);
        if (!cancelled) setEstimate(result);
      } catch (err) {
        if (!cancelled) setEstimateError(err instanceof Error ? err.message : "Falha ao estimar");
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, ESTIMATE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey]);

  function patch(p: Partial<CampaignAudience>) {
    onChange({ ...value, ...p });
  }

  function togglePlan(plan: PlanKey) {
    const set = new Set(value.plans ?? []);
    if (set.has(plan)) set.delete(plan); else set.add(plan);
    patch({ plans: PLAN_OPTIONS.filter((p) => set.has(p)) });
  }

  function addTestEmail() {
    const email = testEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const list = value.test_emails ?? [];
    if (!list.includes(email)) patch({ test_emails: [...list, email] });
    setTestEmail("");
  }

  return (
    <div className="space-y-4">
      {/* Segmento */}
      <div className="space-y-2">
        <Label className="text-xs">Quem vê</Label>
        <div className="grid grid-cols-2 gap-2">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => patch({ segment: s.value })}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                value.segment === s.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-accent/5",
              )}
            >
              <p className="text-sm font-medium text-foreground">{s.label}</p>
              <p className="text-[11px] text-muted-foreground">{s.hint}</p>
            </button>
          ))}
        </div>
        {value.segment === "plans" && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PLAN_OPTIONS.map((plan) => {
              const on = value.plans?.includes(plan);
              return (
                <button
                  key={plan}
                  type="button"
                  onClick={() => togglePlan(plan)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PLAN_LABELS[plan]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Infra + tempo de casa */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Infraestrutura</Label>
          <Select value={value.infra ?? "any"} onValueChange={(v) => patch({ infra: v as AudienceInfra })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(INFRA_LABELS) as AudienceInfra[]).map((k) => (
                <SelectItem key={k} value={k}>{INFRA_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Clientes novos</Label>
          <Select
            value={String(value.new_customer_days ?? 0)}
            onValueChange={(v) => patch({ new_customer_days: Number(v) || null })}
          >
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Qualquer tempo de casa</SelectItem>
              <SelectItem value="7">Conta criada há até 7 dias</SelectItem>
              <SelectItem value="14">Conta criada há até 14 dias</SelectItem>
              <SelectItem value="30">Conta criada há até 30 dias</SelectItem>
              <SelectItem value="90">Conta criada há até 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Estimativa */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
        <Users className="h-4 w-4 text-primary shrink-0" />
        {estimating ? (
          <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Estimando…</span>
        ) : estimateError ? (
          <span className="text-muted-foreground">Estimativa indisponível agora</span>
        ) : estimate ? (
          <span className="text-foreground">
            ≈ <strong>{estimate.matched.toLocaleString("pt-BR")}</strong> de {estimate.total.toLocaleString("pt-BR")} clientes
            {estimate.matched > 0 && Object.keys(estimate.by_plan).length > 1 && (
              <span className="text-muted-foreground">
                {" "}· {Object.entries(estimate.by_plan)
                  .sort((a, b) => b[1] - a[1])
                  .map(([plan, n]) => `${PLAN_LABELS[plan as PlanKey] ?? (plan === "sem-plano" ? "sem plano" : plan)} ${n}`)
                  .join(", ")}
              </span>
            )}
          </span>
        ) : null}
      </div>

      {/* Página */}
      {showUrl && (
        <div className="space-y-1.5">
          <Label htmlFor="aud-url" className="text-xs">Só nestas páginas (opcional)</Label>
          <Input
            id="aud-url"
            value={value.url_pattern ?? ""}
            onChange={(e) => patch({ url_pattern: e.target.value || null })}
            placeholder="/app/infra/*  ou  *evolution*"
            className="h-9 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            Caminho da página no app do cliente. <code>*</code> vale para qualquer trecho. Vazio = todas as páginas.
          </p>
        </div>
      )}

      {/* Teste */}
      <div className="space-y-1.5 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
        <Label className="text-xs flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5 text-amber-600" /> Enviar teste para</Label>
        <p className="text-[11px] text-muted-foreground">
          Estes e-mails veem o disparo <strong>mesmo antes de publicar</strong>, com a etiqueta "Prévia". Use sua própria conta na Cloudfy.
        </p>
        <div className="flex gap-2">
          <Input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTestEmail(); } }}
            placeholder="voce@cloudfy.host"
            className="h-8 text-sm"
          />
          <button
            type="button"
            onClick={addTestEmail}
            className="h-8 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/10 flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </button>
        </div>
        {(value.test_emails?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {value.test_emails!.map((email) => (
              <Badge key={email} variant="outline" className="gap-1 font-mono text-[11px] pr-1">
                {email}
                <button
                  type="button"
                  onClick={() => patch({ test_emails: value.test_emails!.filter((e) => e !== email) })}
                  className="rounded-sm hover:text-rose-500"
                  aria-label={`Remover ${email}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
