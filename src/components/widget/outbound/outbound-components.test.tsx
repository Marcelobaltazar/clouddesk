import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoticeCard } from "./NoticeCard";
import { BannerStrip } from "./BannerStrip";
import { NewsCard } from "./NewsCard";
import { TourCard } from "./TourCard";
import { CampaignPreview } from "@/components/outbound/CampaignPreview";
import { emptyContent, type NoticeContent, type BannerContent, type NewsContent, type TourContent } from "@/lib/outbound";

// ResizeObserver não existe no jsdom — os componentes de prévia/tour usam com guard,
// mas o Recharts/Radix podem pedir. Stub mínimo.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

describe("NoticeCard", () => {
  const content: NoticeContent = {
    ...(emptyContent("notice") as NoticeContent),
    title: "Backups automáticos",
    body: "Agora **todo dia** às 3h.",
    cta_label: "Ver como funciona",
    cta_url: "https://cloudfy.space/backups",
  };

  it("mostra remetente, título, markdown e botão", () => {
    const onCta = vi.fn();
    const onDismiss = vi.fn();
    render(<NoticeCard content={content} sender={{ name: "Marc", avatar_url: null }} variant="popup" onCta={onCta} onDismiss={onDismiss} />);
    expect(screen.getByText("Marc")).toBeInTheDocument();
    expect(screen.getByText("Backups automáticos")).toBeInTheDocument();
    expect(screen.getByText("todo dia").tagName).toBe("STRONG");
    fireEvent.click(screen.getByText("Ver como funciona"));
    expect(onCta).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Fechar aviso"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("sem remetente assina como Equipe Cloudfy e marca prévia", () => {
    render(<NoticeCard content={content} sender={null} variant="card" isTest />);
    expect(screen.getByText("Equipe Cloudfy")).toBeInTheDocument();
    expect(screen.getByText("Prévia")).toBeInTheDocument();
  });
});

describe("BannerStrip", () => {
  it("botão de fechar só quando dismissible", () => {
    const content: BannerContent = { ...(emptyContent("banner") as BannerContent), text: "Manutenção sábado", dismissible: false };
    const { rerender } = render(<BannerStrip content={content} onDismiss={() => {}} />);
    expect(screen.queryByLabelText("Fechar banner")).toBeNull();
    rerender(<BannerStrip content={{ ...content, dismissible: true }} onDismiss={() => {}} />);
    expect(screen.getByLabelText("Fechar banner")).toBeInTheDocument();
  });
});

describe("NewsCard", () => {
  it("texto longo começa recolhido e expande em 'Ler tudo'; reações alternam", () => {
    const content: NewsContent = {
      ...(emptyContent("news") as NewsContent),
      title: "Painel novo",
      body: "x".repeat(400),
      link_url: "https://cloudfy.space",
    };
    const onReact = vi.fn();
    render(<NewsCard content={content} publishedAt="2026-09-21T10:00:00Z" reaction="👍" onReact={onReact} />);
    fireEvent.click(screen.getByText("Ler tudo"));
    expect(screen.queryByText("Ler tudo")).toBeNull();
    // Reagir de novo com a mesma remove; outra troca.
    fireEvent.click(screen.getByText("👍"));
    expect(onReact).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByText("🎉"));
    expect(onReact).toHaveBeenLastCalledWith("🎉");
  });
});

describe("TourCard", () => {
  const step = (emptyContent("tour") as TourContent).steps[0];

  it("último passo mostra Concluir; passo por clique mostra a dica", () => {
    const onNext = vi.fn();
    const { rerender } = render(
      <TourCard step={{ ...step, title: "Fim" }} index={2} total={3} showProgress onNext={onNext} onSkip={() => {}} />,
    );
    expect(screen.getByText("Passo 3 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Concluir"));
    expect(onNext).toHaveBeenCalled();

    rerender(
      <TourCard step={{ ...step, selector: "#x", advance_on: "click" }} index={0} total={3} showProgress onNext={onNext} onSkip={() => {}} />,
    );
    expect(screen.getByText("Clique no destaque")).toBeInTheDocument();
  });

  it("passo em outra página oferece navegação", () => {
    const onNavigate = vi.fn();
    render(
      <TourCard step={step} index={0} total={1} showProgress needsNavigation={{ url: "/app/x", sameOrigin: true }} onNext={() => {}} onSkip={() => {}} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByText("Ir para a página"));
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe("CampaignPreview", () => {
  it("renderiza os quatro tipos sem quebrar", () => {
    for (const type of ["notice", "news", "banner", "tour"] as const) {
      const { unmount } = render(<CampaignPreview type={type} content={emptyContent(type)} sender={null} />);
      unmount();
    }
  });

  it("tour: navega entre passos pela prévia", () => {
    const content = emptyContent("tour") as TourContent;
    content.steps = [
      { ...content.steps[0], title: "Um" },
      { ...content.steps[0], id: "b", title: "Dois" },
    ];
    const onChange = vi.fn();
    render(<CampaignPreview type="tour" content={content} sender={null} stepIndex={0} onStepIndexChange={onChange} />);
    expect(screen.getByText("Passo 1 de 2", { selector: "span.tabular-nums" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próximo passo"));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
