/**
 * TourOverlay.tsx — Motor do tour guiado na página do cliente.
 *
 * Para cada passo: acha o elemento (esperando ele aparecer, se preciso), rola
 * até ele, escurece o resto da tela com um recorte em volta (spotlight) e
 * posiciona o card ao lado. Sem elemento (passo "solto" ou seletor que não
 * existe na tela), o card fica centralizado.
 *
 * O overlay NÃO captura cliques: a página continua usável — é assim que o
 * passo "avançar por clique" funciona (o cliente clica no próprio destaque) e
 * é o que evita prender o cliente num tour que ele não quer.
 *
 * Passo em outra página: o card oferece "Ir para a página". A navegação
 * recarrega tudo, então o índice do passo fica no localStorage e o runner
 * retoma o tour quando o widget subir de novo.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { matchesUrlPattern, type TourStep } from "@/lib/outbound";
import { TourCard, TourFinishCard } from "./TourCard";
import { useCurrentHref, type TourCampaign } from "./useOutbound";

interface Props {
  tour: TourCampaign;
  stepIndex: number;
  onStepChange: (index: number) => void;
  /** Cliente passou pelo último passo (e fechou o card final, se houver). */
  onComplete: () => void;
  onSkip: () => void;
  /** Navegar para a página do passo (o runner salva o progresso antes). */
  onNavigate: (url: string) => void;
}

// ─── Alvo do passo ────────────────────────────────────────────────────────────

const FIND_TIMEOUT_MS = 6000;
const SPOT_PADDING = 6;
const SPOT_RADIUS = 8;
const CARD_GAP = 12;
const VIEWPORT_MARGIN = 12;

/** Aceita seletor CSS e, como atalho, o valor de um atributo data-tour. */
function findTarget(selector: string): HTMLElement | null {
  const sel = selector.trim();
  if (!sel) return null;
  try {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  } catch {
    // seletor inválido — tenta o atalho abaixo
  }
  if (/^[\w-]+$/.test(sel)) {
    return document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
  }
  return null;
}

/** Elementos do próprio widget nunca são alvo (evita destacar a bolha por engano). */
function isOurs(el: HTMLElement): boolean {
  return !!el.closest("#clouddesk-widget-root, #clouddesk-tour-root");
}

interface TargetState {
  el: HTMLElement | null;
  rect: DOMRect | null;
  /** searching → esperando o elemento; found; missing → desistiu. */
  status: "searching" | "found" | "missing";
}

function useTarget(selector: string, active: boolean): TargetState {
  const [state, setState] = useState<TargetState>({ el: null, rect: null, status: selector ? "searching" : "missing" });

  useEffect(() => {
    if (!active) return;
    if (!selector.trim()) {
      setState({ el: null, rect: null, status: "missing" });
      return;
    }

    let cancelled = false;
    let el: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let resizeObs: ResizeObserver | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;

    const measure = () => {
      if (cancelled || !el) return;
      if (!el.isConnected) {
        // Elemento sumiu (re-render do app do host): procura de novo.
        el = null;
        setState({ el: null, rect: null, status: "searching" });
        startSearch();
        return;
      }
      setState({ el, rect: el.getBoundingClientRect(), status: "found" });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    const attach = (found: HTMLElement) => {
      el = found;
      observer?.disconnect();
      observer = null;
      if (timeout) { clearTimeout(timeout); timeout = null; }

      // scrollIntoView não existe em todo ambiente (jsdom) — guard.
      if (typeof found.scrollIntoView === "function") {
        try { found.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch { /* ignore */ }
      }
      resizeObs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
      resizeObs?.observe(found);
      window.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
      window.addEventListener("resize", scheduleMeasure);
      document.addEventListener("transitionend", scheduleMeasure, true);
      measure();
      // Rolagem suave: mede de novo quando ela assenta.
      setTimeout(scheduleMeasure, 400);
    };

    const startSearch = () => {
      const now = findTarget(selector);
      if (now && !isOurs(now)) { attach(now); return; }

      setState({ el: null, rect: null, status: "searching" });
      observer = new MutationObserver(() => {
        const found = findTarget(selector);
        if (found && !isOurs(found)) attach(found);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      timeout = setTimeout(() => {
        if (cancelled || el) return;
        observer?.disconnect();
        observer = null;
        setState({ el: null, rect: null, status: "missing" });
      }, FIND_TIMEOUT_MS);
    };

    startSearch();

    return () => {
      cancelled = true;
      observer?.disconnect();
      resizeObs?.disconnect();
      if (timeout) clearTimeout(timeout);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", scheduleMeasure, { capture: true });
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("transitionend", scheduleMeasure, true);
    };
  }, [selector, active]);

  return state;
}

// ─── Posição do card ──────────────────────────────────────────────────────────

type Side = "top" | "bottom" | "left" | "right";

interface CardPosition {
  top: number;
  left: number;
  arrow: Side | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function positionCard(
  target: DOMRect | null,
  card: { width: number; height: number },
  placement: TourStep["placement"],
): CardPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!target) {
    return { top: Math.max(VIEWPORT_MARGIN, (vh - card.height) / 2), left: Math.max(VIEWPORT_MARGIN, (vw - card.width) / 2), arrow: null };
  }

  const spot = {
    top: target.top - SPOT_PADDING,
    left: target.left - SPOT_PADDING,
    right: target.right + SPOT_PADDING,
    bottom: target.bottom + SPOT_PADDING,
  };
  const space = {
    bottom: vh - spot.bottom,
    top: spot.top,
    right: vw - spot.right,
    left: spot.left,
  };
  const fits: Record<Side, boolean> = {
    bottom: space.bottom >= card.height + CARD_GAP + VIEWPORT_MARGIN,
    top: space.top >= card.height + CARD_GAP + VIEWPORT_MARGIN,
    right: space.right >= card.width + CARD_GAP + VIEWPORT_MARGIN,
    left: space.left >= card.width + CARD_GAP + VIEWPORT_MARGIN,
  };

  const order: Side[] =
    placement === "auto" ? ["bottom", "top", "right", "left"]
    : [placement, ...(["bottom", "top", "right", "left"] as Side[]).filter((s) => s !== placement)];
  const side = order.find((s) => fits[s]) ?? null;

  const centerX = (spot.left + spot.right) / 2;
  const centerY = (spot.top + spot.bottom) / 2;
  const maxLeft = vw - card.width - VIEWPORT_MARGIN;
  const maxTop = vh - card.height - VIEWPORT_MARGIN;

  switch (side) {
    case "bottom":
      return { top: spot.bottom + CARD_GAP, left: clamp(centerX - card.width / 2, VIEWPORT_MARGIN, maxLeft), arrow: "top" };
    case "top":
      return { top: spot.top - CARD_GAP - card.height, left: clamp(centerX - card.width / 2, VIEWPORT_MARGIN, maxLeft), arrow: "bottom" };
    case "right":
      return { top: clamp(centerY - card.height / 2, VIEWPORT_MARGIN, maxTop), left: spot.right + CARD_GAP, arrow: "left" };
    case "left":
      return { top: clamp(centerY - card.height / 2, VIEWPORT_MARGIN, maxTop), left: spot.left - CARD_GAP - card.width, arrow: "right" };
    default:
      // Não cabe em lado nenhum (elemento gigante): sobrepõe centralizado.
      return { top: clamp(centerY - card.height / 2, VIEWPORT_MARGIN, maxTop), left: clamp(centerX - card.width / 2, VIEWPORT_MARGIN, maxLeft), arrow: null };
  }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export function TourOverlay({ tour, stepIndex, onStepChange, onComplete, onSkip, onNavigate }: Props) {
  const steps = tour.content.steps;
  const total = steps.length;
  const finished = stepIndex >= total;
  const step: TourStep | null = finished ? null : steps[stepIndex];
  const href = useCurrentHref();

  const needsNavigation = useMemo(() => {
    if (!step?.url?.trim()) return null;
    if (matchesUrlPattern(step.url, href)) return null;
    let sameOrigin = false;
    try { sameOrigin = new URL(step.url, window.location.href).origin === window.location.origin; } catch { /* padrão com curinga */ }
    return { url: step.url.trim(), sameOrigin };
  }, [step, href]);

  // Sem navegação pendente e com seletor → procura o alvo.
  const target = useTarget(step?.selector ?? "", !!step && !needsNavigation);

  // Passo opcional cujo elemento não existe: pula sozinho.
  useEffect(() => {
    if (!step || needsNavigation) return;
    if (step.optional && step.selector.trim() && target.status === "missing") {
      onStepChange(stepIndex + 1);
    }
  }, [step, needsNavigation, target.status, stepIndex, onStepChange]);

  // Avançar por clique no elemento destacado.
  useEffect(() => {
    if (!step || step.advance_on !== "click" || !target.el) return;
    const el = target.el;
    const handler = () => onStepChange(stepIndex + 1);
    el.addEventListener("click", handler, { capture: true, once: true });
    return () => el.removeEventListener("click", handler, { capture: true });
  }, [step, target.el, stepIndex, onStepChange]);

  // Teclado: Esc sai; setas navegam nos passos por botão.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onSkip(); return; }
      if (!step || needsNavigation) return;
      if (e.key === "ArrowRight" && step.advance_on !== "click") onStepChange(stepIndex + 1);
      if (e.key === "ArrowLeft" && stepIndex > 0) onStepChange(stepIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, needsNavigation, stepIndex, onStepChange, onSkip]);

  // Mede o card para posicionar (o tamanho depende do texto).
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 300, height: 160 });
  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const update = () => setCardSize({ width: node.offsetWidth, height: node.offsetHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [stepIndex, target.status, finished]);

  // Passo centralizado enquanto procura o alvo ainda mostra o card (o
  // cliente lê o texto enquanto a tela termina de carregar).
  const rect = target.status === "found" ? target.rect : null;
  const showSpot = !!rect && !needsNavigation;
  const position = useMemo(
    () => positionCard(showSpot ? rect : null, cardSize, step?.placement ?? "auto"),
    [showSpot, rect, cardSize, step?.placement],
  );

  const goNext = useCallback(() => onStepChange(stepIndex + 1), [onStepChange, stepIndex]);
  const goPrev = useCallback(() => onStepChange(stepIndex - 1), [onStepChange, stepIndex]);

  // Terminou sem card final configurado: conclui direto (efeito, não render).
  const finishMessage = tour.content.finish_message?.trim() ?? "";
  useEffect(() => {
    if (finished && !finishMessage) onComplete();
  }, [finished, finishMessage, onComplete]);

  if (typeof window === "undefined") return null;

  // Terminou: card final (se configurado).
  if (finished) {
    const message = finishMessage;
    if (!message) return null;
    return (
      <div id="clouddesk-tour-root" className="fixed inset-0 z-[10000]">
        <div className="absolute inset-0 bg-black/55 animate-in fade-in-0 duration-200" onClick={onComplete} />
        <div className="absolute inset-0 flex items-center justify-center p-3 pointer-events-none">
          <div className="pointer-events-auto animate-in zoom-in-95 fade-in-0 duration-200">
            <TourFinishCard message={message} onClose={onComplete} />
          </div>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const spot = rect && {
    x: rect.left - SPOT_PADDING,
    y: rect.top - SPOT_PADDING,
    w: rect.width + SPOT_PADDING * 2,
    h: rect.height + SPOT_PADDING * 2,
  };

  return (
    <div id="clouddesk-tour-root" className="fixed inset-0 z-[10000] pointer-events-none">
      {/* Escurecimento com recorte no alvo. pointer-events: none — a página
          continua clicável (necessário para "avançar por clique"). */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="clouddesk-tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {showSpot && spot && (
              <rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={SPOT_RADIUS} fill="black" />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(15, 17, 23, 0.55)" mask="url(#clouddesk-tour-mask)" />
        {showSpot && spot && (
          <rect
            x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={SPOT_RADIUS}
            fill="none" stroke="hsl(var(--primary))" strokeWidth="2"
            className="animate-pulse"
          />
        )}
      </svg>

      <div
        ref={cardRef}
        className="absolute pointer-events-auto animate-in fade-in-0 zoom-in-95 duration-200"
        style={{ top: position.top, left: position.left }}
      >
        <TourCard
          step={step}
          index={stepIndex}
          total={total}
          showProgress={tour.content.show_progress}
          needsNavigation={needsNavigation}
          arrow={position.arrow}
          isTest={tour.is_test}
          onPrev={stepIndex > 0 ? goPrev : undefined}
          onNext={goNext}
          onSkip={onSkip}
          onNavigate={needsNavigation ? () => onNavigate(needsNavigation.url) : undefined}
        />
      </div>
    </div>
  );
}
