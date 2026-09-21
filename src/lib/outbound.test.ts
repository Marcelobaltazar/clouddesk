import { describe, it, expect } from "vitest";
import {
  matchesUrlPattern,
  derivedStatus,
  validateCampaign,
  normalizeCampaign,
  describeAudience,
  emptyContent,
  DEFAULT_AUDIENCE,
  type TourContent,
} from "./outbound";

describe("matchesUrlPattern", () => {
  const at = "https://app.cloudfy.space/app/dashboard?tab=infra#top";

  it("padrão vazio casa com qualquer página", () => {
    expect(matchesUrlPattern("", at)).toBe(true);
    expect(matchesUrlPattern(null, at)).toBe(true);
  });

  it("caminho exato, com ou sem barra final, ignorando query e hash", () => {
    expect(matchesUrlPattern("/app/dashboard", at)).toBe(true);
    expect(matchesUrlPattern("/app/dashboard/", at)).toBe(true);
    expect(matchesUrlPattern("/app", at)).toBe(false);
  });

  it("curinga no fim casa a árvore inteira", () => {
    expect(matchesUrlPattern("/app/*", at)).toBe(true);
    expect(matchesUrlPattern("/billing/*", at)).toBe(false);
  });

  it("curinga nas duas pontas casa em qualquer lugar da URL", () => {
    expect(matchesUrlPattern("*dashboard*", at)).toBe(true);
    expect(matchesUrlPattern("*evolution*", at)).toBe(false);
  });

  it("URL completa exige o mesmo host", () => {
    expect(matchesUrlPattern("https://app.cloudfy.space/app/*", at)).toBe(true);
    expect(matchesUrlPattern("https://outro.com/app/*", at)).toBe(false);
  });

  it("padrão com query compara a query também", () => {
    expect(matchesUrlPattern("/app/dashboard?tab=infra*", at)).toBe(true);
    expect(matchesUrlPattern("/app/dashboard?tab=billing", at)).toBe(false);
  });

  it("não é case-sensitive", () => {
    expect(matchesUrlPattern("/APP/Dashboard", at)).toBe(true);
  });

  it("href inválido nunca casa", () => {
    expect(matchesUrlPattern("/app", "not a url")).toBe(false);
  });
});

describe("derivedStatus", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("rascunho/pausado/arquivado passam direto", () => {
    expect(derivedStatus({ status: "draft", starts_at: null, ends_at: null }, now)).toBe("draft");
    expect(derivedStatus({ status: "paused", starts_at: null, ends_at: null }, now)).toBe("paused");
    expect(derivedStatus({ status: "archived", starts_at: null, ends_at: null }, now)).toBe("archived");
  });

  it("ativo antes da janela é agendado; depois é encerrado", () => {
    expect(derivedStatus({ status: "active", starts_at: "2026-09-22T00:00:00Z", ends_at: null }, now)).toBe("scheduled");
    expect(derivedStatus({ status: "active", starts_at: null, ends_at: "2026-09-20T00:00:00Z" }, now)).toBe("ended");
    expect(derivedStatus({ status: "active", starts_at: "2026-09-20T00:00:00Z", ends_at: "2026-09-25T00:00:00Z" }, now)).toBe("active");
  });
});

describe("validateCampaign", () => {
  const base = { name: "x", audience: { ...DEFAULT_AUDIENCE }, starts_at: null, ends_at: null };

  it("exige nome interno", () => {
    const errors = validateCampaign({ ...base, name: "", type: "banner", content: { ...emptyContent("banner"), text: "oi" } });
    expect(errors.some((e) => e.includes("nome"))).toBe(true);
  });

  it("aviso com botão exige link válido", () => {
    const errors = validateCampaign({
      ...base,
      type: "notice",
      content: { ...emptyContent("notice"), title: "t", cta_label: "Ver", cta_url: "cloudfy" },
    });
    expect(errors.some((e) => e.includes("link válido"))).toBe(true);
  });

  it("tour com passo avançando por clique exige seletor", () => {
    const content = emptyContent("tour") as TourContent;
    content.steps[0] = { ...content.steps[0], title: "Passo", advance_on: "click", selector: "" };
    const errors = validateCampaign({ ...base, type: "tour", content });
    expect(errors.some((e) => e.includes("seletor"))).toBe(true);
  });

  it("segmento por planos sem plano escolhido é erro", () => {
    const errors = validateCampaign({
      ...base,
      type: "banner",
      content: { ...emptyContent("banner"), text: "oi" },
      audience: { ...DEFAULT_AUDIENCE, segment: "plans", plans: [] },
    });
    expect(errors.some((e) => e.includes("plano"))).toBe(true);
  });

  it("término antes do início é erro", () => {
    const errors = validateCampaign({
      ...base,
      type: "banner",
      content: { ...emptyContent("banner"), text: "oi" },
      starts_at: "2026-09-22T00:00:00Z",
      ends_at: "2026-09-21T00:00:00Z",
    });
    expect(errors.some((e) => e.includes("término"))).toBe(true);
  });

  it("campanha válida não tem erros", () => {
    const errors = validateCampaign({ ...base, type: "banner", content: { ...emptyContent("banner"), text: "Manutenção sábado" } });
    expect(errors).toEqual([]);
  });
});

describe("normalizeCampaign", () => {
  it("preenche defaults de conteúdo e público que a linha antiga não tinha", () => {
    const c = normalizeCampaign({
      id: "1", type: "banner", name: "b", status: "active",
      content: { text: "oi" }, audience: {},
      priority: null, starts_at: null, ends_at: null, published_at: null,
      sender_agent_id: null, created_by: null,
      created_at: "2026-01-01", updated_at: "2026-01-01",
    });
    expect(c.content).toMatchObject({ text: "oi", style: "info", dismissible: true });
    expect(c.audience.segment).toBe("all");
    expect(c.priority).toBe(0);
  });

  it("garante id em cada passo do tour", () => {
    const c = normalizeCampaign({
      id: "1", type: "tour", name: "t", status: "draft",
      content: { steps: [{ selector: "#a", title: "A", body: "", placement: "auto", advance_on: "button" }] },
      audience: null,
      priority: 0, starts_at: null, ends_at: null, published_at: null,
      sender_agent_id: null, created_by: null,
      created_at: "2026-01-01", updated_at: "2026-01-01",
    });
    expect((c.content as TourContent).steps[0].id).toBeTruthy();
  });
});

describe("describeAudience", () => {
  it("monta a frase em português", () => {
    expect(describeAudience({ segment: "plans", plans: ["ultra", "max"], infra: "active", url_pattern: "/app/*" }))
      .toBe("Planos Ultra e Max · com infraestrutura ativa · em /app/*");
    expect(describeAudience({ segment: "all" })).toBe("Todos os clientes");
  });
});
