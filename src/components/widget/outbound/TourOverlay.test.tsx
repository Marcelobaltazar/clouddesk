import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TourOverlay } from "./TourOverlay";
import type { TourCampaign } from "./useOutbound";
import { emptyContent, type TourContent, type TourStep } from "@/lib/outbound";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

function step(partial: Partial<TourStep>): TourStep {
  return { id: Math.random().toString(36).slice(2), selector: "", title: "Passo", body: "", placement: "auto", advance_on: "button", url: "", ...partial };
}

function tourWith(steps: TourStep[], extra: Partial<TourContent> = {}): TourCampaign {
  const content = { ...(emptyContent("tour") as TourContent), steps, ...extra };
  return { id: "t", type: "tour", content, priority: 0, published_at: null, url_pattern: null, sender: null, receipt: null, is_test: false };
}

function mountTarget(id: string) {
  const el = document.createElement("button");
  el.id = id;
  el.textContent = "alvo";
  el.getBoundingClientRect = () => ({ top: 100, left: 100, width: 80, height: 30, right: 180, bottom: 130, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("TourOverlay", () => {
  it("destaca o elemento encontrado e avança pelo botão", () => {
    mountTarget("alvo");
    const onStepChange = vi.fn();
    render(
      <TourOverlay
        tour={tourWith([step({ selector: "#alvo", title: "Primeiro" }), step({ title: "Segundo" })])}
        stepIndex={0}
        onStepChange={onStepChange}
        onComplete={() => {}}
        onSkip={() => {}}
        onNavigate={() => {}}
      />,
    );
    // Recorte do spotlight (rect com rx) presente na máscara
    expect(document.querySelector("mask rect[rx]")).not.toBeNull();
    fireEvent.click(screen.getByText("Próximo"));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("avança quando o cliente clica no elemento destacado", () => {
    const el = mountTarget("alvo");
    const onStepChange = vi.fn();
    render(
      <TourOverlay
        tour={tourWith([step({ selector: "#alvo", advance_on: "click" }), step({})])}
        stepIndex={0}
        onStepChange={onStepChange}
        onComplete={() => {}}
        onSkip={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("Clique no destaque")).toBeInTheDocument();
    fireEvent.click(el);
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("pula passo opcional cujo elemento não existe", () => {
    const onStepChange = vi.fn();
    render(
      <TourOverlay
        tour={tourWith([step({ selector: "#nao-existe", optional: true }), step({ title: "Dois" })])}
        stepIndex={0}
        onStepChange={onStepChange}
        onComplete={() => {}}
        onSkip={() => {}}
        onNavigate={() => {}}
      />,
    );
    act(() => { vi.advanceTimersByTime(7000); });
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("passo de outra página mostra 'Ir para a página' e não procura o elemento", () => {
    const onNavigate = vi.fn();
    render(
      <TourOverlay
        tour={tourWith([step({ selector: "#alvo", url: "/outra-pagina" })])}
        stepIndex={0}
        onStepChange={() => {}}
        onComplete={() => {}}
        onSkip={() => {}}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText("Ir para a página"));
    expect(onNavigate).toHaveBeenCalledWith("/outra-pagina");
  });

  it("depois do último passo: card final se houver mensagem, senão conclui direto", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <TourOverlay
        tour={tourWith([step({})], { finish_message: "Pronto!" })}
        stepIndex={1}
        onStepChange={() => {}}
        onComplete={onComplete}
        onSkip={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("Pronto!")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Fechar"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    rerender(
      <TourOverlay
        tour={tourWith([step({})], { finish_message: "" })}
        stepIndex={1}
        onStepChange={() => {}}
        onComplete={onComplete}
        onSkip={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it("Esc sai do tour", () => {
    const onSkip = vi.fn();
    render(
      <TourOverlay tour={tourWith([step({})])} stepIndex={0} onStepChange={() => {}} onComplete={() => {}} onSkip={onSkip} onNavigate={() => {}} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSkip).toHaveBeenCalled();
  });
});
