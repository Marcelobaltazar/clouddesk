import { ChevronDown, ChevronUp, Plus, Trash2, GripVertical, MousePointerClick } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newStepId, type TourPlacement, type TourStep } from "@/lib/outbound";
import { cn } from "@/lib/utils";

interface Props {
  steps: TourStep[];
  onChange: (steps: TourStep[]) => void;
  /** Passo em edição — a prévia acompanha. */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

const PLACEMENTS: Array<{ value: TourPlacement; label: string }> = [
  { value: "auto", label: "Automático" },
  { value: "bottom", label: "Abaixo" },
  { value: "top", label: "Acima" },
  { value: "right", label: "À direita" },
  { value: "left", label: "À esquerda" },
];

export function TourStepsEditor({ steps, onChange, activeIndex, onActiveIndexChange }: Props) {
  function update(index: number, patch: Partial<TourStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    onActiveIndexChange(target);
  }

  function remove(index: number) {
    const next = steps.filter((_, i) => i !== index);
    onChange(next);
    onActiveIndexChange(Math.max(0, Math.min(activeIndex, next.length - 1)));
  }

  function add() {
    const next: TourStep = {
      id: newStepId(), selector: "", title: "", body: "", placement: "auto", advance_on: "button", url: "",
    };
    onChange([...steps, next]);
    onActiveIndexChange(steps.length);
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const open = index === activeIndex;
        return (
          <div
            key={step.id}
            className={cn(
              "rounded-lg border transition-colors",
              open ? "border-primary/50 bg-primary/[0.03]" : "border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onActiveIndexChange(open ? -1 : index)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <span className="h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center tabular-nums">
                {index + 1}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">
                {step.title || <span className="text-muted-foreground font-normal">Passo sem título</span>}
              </span>
              {step.advance_on === "click" && <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>

            {open && (
              <div className="px-3 pb-3 space-y-3 border-t border-border/60 pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`step-title-${step.id}`} className="text-xs">Título</Label>
                  <Input
                    id={`step-title-${step.id}`}
                    value={step.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                    placeholder="Ex.: Aqui ficam suas instâncias"
                    className="h-9 text-sm"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`step-body-${step.id}`} className="text-xs">Texto</Label>
                  <Textarea
                    id={`step-body-${step.id}`}
                    value={step.body}
                    onChange={(e) => update(index, { body: e.target.value })}
                    placeholder="Explique o que fazer nesta tela. Markdown simples funciona (**negrito**, listas)."
                    rows={3}
                    className="text-sm"
                    maxLength={600}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`step-selector-${step.id}`} className="text-xs">Elemento a destacar</Label>
                  <Input
                    id={`step-selector-${step.id}`}
                    value={step.selector}
                    onChange={(e) => update(index, { selector: e.target.value })}
                    placeholder='#btn-nova-instancia  ou  [data-tour="instancias"]'
                    className="h-9 text-sm font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Seletor CSS do elemento na página (no navegador: botão direito › Inspecionar › Copy selector).
                    Vazio = card centralizado, sem destaque.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Posição do card</Label>
                    <Select value={step.placement} onValueChange={(v) => update(index, { placement: v as TourPlacement })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLACEMENTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Avança quando</Label>
                    <Select value={step.advance_on} onValueChange={(v) => update(index, { advance_on: v as TourStep["advance_on"] })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="button">Clica em "Próximo"</SelectItem>
                        <SelectItem value="click">Clica no elemento destacado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`step-url-${step.id}`} className="text-xs">Página deste passo (opcional)</Label>
                  <Input
                    id={`step-url-${step.id}`}
                    value={step.url ?? ""}
                    onChange={(e) => update(index, { url: e.target.value })}
                    placeholder="/app/instancias"
                    className="h-9 text-sm font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Se o cliente estiver em outra página, o card oferece "Ir para a página" e o tour continua de lá.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch checked={!!step.optional} onCheckedChange={(v) => update(index, { optional: v })} />
                    Pular se o elemento não existir
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 disabled:opacity-30 flex items-center justify-center" aria-label="Mover para cima">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === steps.length - 1} className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 disabled:opacity-30 flex items-center justify-center" aria-label="Mover para baixo">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(index)} className="h-7 w-7 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 flex items-center justify-center" aria-label="Remover passo">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors flex items-center justify-center gap-1.5"
      >
        <Plus className="h-4 w-4" /> Adicionar passo
      </button>
    </div>
  );
}
