import { X, ArrowLeft, ArrowRight, Check, MousePointerClick, ExternalLink } from "lucide-react";
import type { TourStep } from "@/lib/outbound";
import { WidgetMarkdown } from "../WidgetMarkdown";

interface Props {
  step: TourStep;
  index: number;
  total: number;
  showProgress: boolean;
  /** O passo pede outra página: mostra o botão de ir para lá em vez de "Próximo". */
  needsNavigation?: { url: string; sameOrigin: boolean } | null;
  onPrev?: () => void;
  onNext: () => void;
  onSkip: () => void;
  onNavigate?: () => void;
  /** Lado em que a setinha aponta para o elemento (null = card centralizado). */
  arrow?: "top" | "bottom" | "left" | "right" | null;
  isTest?: boolean;
}

/**
 * Card de um passo do tour. Puro: o motor na página do cliente e a prévia do
 * editor no painel desenham exatamente o mesmo card.
 */
export function TourCard({
  step, index, total, showProgress, needsNavigation, onPrev, onNext, onSkip, onNavigate, arrow, isTest,
}: Props) {
  const isLast = index >= total - 1;
  const byClick = step.advance_on === "click" && !!step.selector && !needsNavigation;

  return (
    <div className="relative w-[300px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-card shadow-2xl text-foreground">
      {arrow && <Arrow side={arrow} />}

      <button
        type="button"
        onClick={onSkip}
        className="absolute top-2 right-2 h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/20 hover:text-foreground flex items-center justify-center transition-colors"
        aria-label="Sair do tour"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="p-4 pr-8">
        {(showProgress || isTest) && (
          <div className="flex items-center gap-2 mb-1.5">
            {showProgress && total > 1 && (
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                Passo {index + 1} de {total}
              </span>
            )}
            {isTest && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600">
                Prévia
              </span>
            )}
          </div>
        )}
        {step.title && (
          <h4 className="text-[14.5px] font-semibold leading-snug mb-1">{step.title}</h4>
        )}
        {step.body && (
          <div className="text-foreground/90">
            <WidgetMarkdown content={step.body} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        {showProgress && total > 1 && (
          <div className="flex items-center gap-1" aria-hidden="true">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === index ? "w-4 bg-primary" : i < index ? "w-1.5 bg-primary/50" : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              className="h-8 w-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/10 flex items-center justify-center transition-colors"
              aria-label="Passo anterior"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}

          {needsNavigation ? (
            <button
              type="button"
              onClick={onNavigate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              Ir para a página <ExternalLink className="h-3.5 w-3.5" />
            </button>
          ) : byClick ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary">
              <MousePointerClick className="h-3.5 w-3.5" /> Clique no destaque
            </span>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              {isLast ? <>Concluir <Check className="h-3.5 w-3.5" /></> : <>Próximo <ArrowRight className="h-3.5 w-3.5" /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Setinha do card apontando para o elemento destacado. */
function Arrow({ side }: { side: "top" | "bottom" | "left" | "right" }) {
  // Lado do CARD em que a seta fica (aponta para fora, na direção do alvo).
  const pos: Record<typeof side, string> = {
    top: "-top-[7px] left-1/2 -translate-x-1/2 border-l border-t",
    bottom: "-bottom-[7px] left-1/2 -translate-x-1/2 border-r border-b",
    left: "-left-[7px] top-1/2 -translate-y-1/2 border-l border-b",
    right: "-right-[7px] top-1/2 -translate-y-1/2 border-r border-t",
  };
  return (
    <span
      aria-hidden="true"
      className={`absolute h-3.5 w-3.5 rotate-45 bg-card border-border ${pos[side]}`}
    />
  );
}

/** Card final do tour ("Pronto!"). */
export function TourFinishCard({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="w-[300px] max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-card shadow-2xl text-foreground p-5 text-center">
      <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Check className="h-5 w-5 text-emerald-600" />
      </div>
      <div className="text-foreground/90">
        <WidgetMarkdown content={message} />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-lg bg-primary py-2 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.99] transition-all"
      >
        Fechar
      </button>
    </div>
  );
}
