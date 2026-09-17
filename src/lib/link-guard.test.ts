import { describe, it, expect } from "vitest";
import {
  collectUrls,
  normalizeUrl,
  enforceLinkAllowlist,
} from "../../supabase/functions/_shared/link-guard";

// O guard roda no Edge (Deno), mas o módulo é puro de propósito para poder ser
// testado aqui. Se algum dia ele importar Deno.*, este teste quebra — e é bom
// que quebre.

const HELP = "https://clouddesk-omega.vercel.app";
const ARTICLE = `${HELP}/ajuda/abc123-como-conectar-evolution-api`;
const DISCORD = "https://discord.com/invite/uDftSRtfKe";

describe("normalizeUrl", () => {
  it("ignora diferença de caixa no host e barra final", () => {
    expect(normalizeUrl("HTTPS://Cloudfy.COM/docs/")).toBe(normalizeUrl("https://cloudfy.com/docs"));
  });

  it("descarta âncora e pontuação colada no fim", () => {
    expect(normalizeUrl(`${ARTICLE}#passo-2`)).toBe(ARTICLE);
    expect(normalizeUrl(`${ARTICLE}.`)).toBe(ARTICLE);
  });

  it("preserva a caixa do caminho", () => {
    expect(normalizeUrl("https://x.com/Path")).not.toBe(normalizeUrl("https://x.com/path"));
  });
});

describe("collectUrls", () => {
  it("extrai as URLs do prompt sem repetir", () => {
    const prompt = `Artigo: ${ARTICLE}\nOutro: ${ARTICLE}\nDiscord: ${DISCORD}`;
    expect(collectUrls(prompt).sort()).toEqual([ARTICLE, DISCORD].sort());
  });

  it("devolve lista vazia para texto sem link", () => {
    expect(collectUrls("nenhum link aqui")).toEqual([]);
  });
});

describe("enforceLinkAllowlist", () => {
  it("remove a linha de fonte inteira quando o link foi inventado", () => {
    // Caso real: o modelo inventou uma URL plausível de documentação.
    const reply = [
      "Sim, você consegue integrar a Evolution API com o Chatwoot.",
      "",
      "📚 Fonte: [Integração da Evolution API com Chatwoot](https://cloudfy.com/docs/evolution-api/integracao-chatwoot)",
    ].join("\n");

    const { text, removed } = enforceLinkAllowlist(reply, [HELP, ARTICLE, DISCORD]);

    expect(removed).toEqual(["https://cloudfy.com/docs/evolution-api/integracao-chatwoot"]);
    expect(text).not.toContain("cloudfy.com/docs");
    expect(text).not.toContain("Fonte:");
    expect(text).toContain("Evolution API com o Chatwoot");
  });

  it("mantém intactos os links que vieram do nosso contexto", () => {
    const reply = `Veja o passo a passo.\n\n📚 Fonte: [Como conectar](${ARTICLE})`;
    const { text, removed } = enforceLinkAllowlist(reply, [ARTICLE]);

    expect(removed).toEqual([]);
    expect(text).toBe(reply);
  });

  it("degrada link markdown proibido para só o rótulo", () => {
    const reply = "Confira o [guia oficial](https://inventado.example/guia) para detalhes.";
    const { text } = enforceLinkAllowlist(reply, [ARTICLE]);

    expect(text).toBe("Confira o guia oficial para detalhes.");
  });

  it("apaga URL solta inventada preservando a pontuação da frase", () => {
    const reply = "Acesse https://inventado.example/painel.";
    const { text, removed } = enforceLinkAllowlist(reply, [ARTICLE]);

    expect(removed).toHaveLength(1);
    expect(text).toBe("Acesse .");
  });

  it("não se confunde com o mesmo domínio em caminho diferente", () => {
    // O modelo pegou o host certo e inventou o caminho — o caso mais traiçoeiro,
    // porque parece legítimo à primeira vista.
    const reply = `📚 Fonte: [Artigo](${HELP}/ajuda/caminho-que-nao-existe)`;
    const { text, removed } = enforceLinkAllowlist(reply, [ARTICLE]);

    expect(removed).toHaveLength(1);
    expect(text).toBe("");
  });

  it("avalia cada linha de fonte separadamente", () => {
    const reply = [
      "Resposta.",
      "",
      `📚 Fonte: [Bom](${ARTICLE})`,
      "📚 Fonte: [Ruim](https://inventado.example/x)",
    ].join("\n");

    const { text } = enforceLinkAllowlist(reply, [ARTICLE]);

    expect(text).toContain(ARTICLE);
    expect(text).not.toContain("inventado.example");
    expect(text.match(/Fonte:/g)).toHaveLength(1);
  });

  it("deixa o texto intacto quando não há link nenhum", () => {
    const reply = "Olá, Fabio! Como posso ajudar?";
    expect(enforceLinkAllowlist(reply, [ARTICLE]).text).toBe(reply);
  });
});
