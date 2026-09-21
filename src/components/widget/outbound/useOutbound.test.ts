import { describe, it, expect, beforeEach } from "vitest";
import {
  selectPopupNotice,
  selectNotices,
  selectBanner,
  selectNews,
  selectAutoStartTour,
  countUnreadNews,
  findResumableTour,
  saveTourProgress,
  clearTourProgress,
} from "./useOutbound";
import { emptyContent, type WidgetCampaign, type NoticeContent, type TourContent } from "@/lib/outbound";

const href = "https://app.cloudfy.space/app/instancias";

function campaign(partial: Partial<WidgetCampaign> & { type: WidgetCampaign["type"] }): WidgetCampaign {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    content: emptyContent(partial.type),
    priority: 0,
    published_at: "2026-09-20T00:00:00Z",
    url_pattern: null,
    sender: null,
    receipt: null,
    is_test: false,
    ...partial,
  };
}

beforeEach(() => localStorage.clear());

describe("avisos", () => {
  it("ignora fechados/clicados e respeita a página", () => {
    const list = [
      campaign({ id: "a", type: "notice" }),
      campaign({ id: "b", type: "notice", receipt: { seen: true, clicked: false, dismissed: true, completed: false, step_reached: null, reaction: null } }),
      campaign({ id: "c", type: "notice", receipt: { seen: true, clicked: true, dismissed: false, completed: false, step_reached: null, reaction: null } }),
      campaign({ id: "d", type: "notice", url_pattern: "/billing/*" }),
    ];
    expect(selectNotices(list, href).map((c) => c.id)).toEqual(["a"]);
  });

  it("popup pega o de maior prioridade entre os do tipo popup", () => {
    const card = campaign({ id: "card", type: "notice", priority: 99, content: { ...(emptyContent("notice") as NoticeContent), display: "card" } });
    const low = campaign({ id: "low", type: "notice", priority: 0 });
    const high = campaign({ id: "high", type: "notice", priority: 10 });
    expect(selectPopupNotice([card, low, high], href)?.id).toBe("high");
  });
});

describe("banner", () => {
  it("um só: maior prioridade, depois mais recente", () => {
    const older = campaign({ id: "older", type: "banner", published_at: "2026-09-01T00:00:00Z" });
    const newer = campaign({ id: "newer", type: "banner", published_at: "2026-09-19T00:00:00Z" });
    const dismissed = campaign({ id: "x", type: "banner", priority: 50, receipt: { seen: true, clicked: false, dismissed: true, completed: false, step_reached: null, reaction: null } });
    expect(selectBanner([older, newer, dismissed], href)?.id).toBe("newer");
  });
});

describe("novidades", () => {
  it("ordena por publicação e conta não lidas", () => {
    const a = campaign({ id: "a", type: "news", published_at: "2026-09-01T00:00:00Z" });
    const b = campaign({ id: "b", type: "news", published_at: "2026-09-19T00:00:00Z", receipt: { seen: true, clicked: false, dismissed: false, completed: false, step_reached: null, reaction: null } });
    expect(selectNews([a, b]).map((c) => c.id)).toEqual(["b", "a"]);
    expect(countUnreadNews([a, b])).toBe(1);
  });
});

describe("tour", () => {
  function tour(id: string, extra: Partial<TourContent> = {}): WidgetCampaign {
    const content = emptyContent("tour") as TourContent;
    content.steps[0].title = "Passo";
    return campaign({ id, type: "tour", content: { ...content, ...extra } });
  }

  it("começa sozinho só na página certa, uma vez, e não se já concluiu", () => {
    const t = tour("t", { start_url: "/app/instancias" });
    expect(selectAutoStartTour([t], href)?.id).toBe("t");
    expect(selectAutoStartTour([t], "https://app.cloudfy.space/outra")).toBeNull();

    clearTourProgress("t", true); // marcado como feito localmente
    expect(selectAutoStartTour([t], href)).toBeNull();
  });

  it("tour com auto_start desligado nunca começa sozinho", () => {
    expect(selectAutoStartTour([tour("t", { auto_start: false })], href)).toBeNull();
  });

  it("retoma do passo salvo e descarta progresso de tour já concluído", () => {
    const t = tour("t");
    saveTourProgress("t", 0);
    expect(findResumableTour([t])?.step).toBe(0);

    const done = { ...t, receipt: { seen: true, clicked: false, dismissed: false, completed: true, step_reached: 0, reaction: null } };
    expect(findResumableTour([done])).toBeNull();
    expect(localStorage.getItem("clouddesk-tour:t")).toBeNull();
  });
});
