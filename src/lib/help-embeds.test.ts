import { describe, it, expect } from "vitest";
import { parseVideoEmbed, isVideoUrl, iframesToMarkdownLinks } from "./help-embeds";

const SMARTPLAYER = "https://player.scaleup.com.br/embed/70b350e3ef7a254b97355cdc9a1b746f3e714f77";

describe("parseVideoEmbed", () => {
  it("reconhece o SmartPlayer e usa a própria URL como player", () => {
    expect(parseVideoEmbed(SMARTPLAYER)).toEqual({
      src: SMARTPLAYER,
      provider: "SmartPlayer",
      watchUrl: SMARTPLAYER,
    });
  });

  it("converte as formas do YouTube para a URL de embed sem cookies", () => {
    const expected = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoEmbed(url)?.src, url).toBe(expected);
    }
  });

  it("converte Vimeo e Loom", () => {
    expect(parseVideoEmbed("https://vimeo.com/76979871")?.src)
      .toBe("https://player.vimeo.com/video/76979871");
    expect(parseVideoEmbed("https://www.loom.com/share/a1b2c3d4e5f60718")?.src)
      .toBe("https://www.loom.com/embed/a1b2c3d4e5f60718");
  });

  it("recusa domínio fora da lista", () => {
    expect(parseVideoEmbed("https://exemplo.com/video.mp4")).toBeNull();
    expect(parseVideoEmbed("https://player.scaleup.com.br.evil.com/embed/x")).toBeNull();
    expect(isVideoUrl("https://cloudfy.space/algum-artigo")).toBe(false);
  });

  it("recusa entrada inválida ou protocolo perigoso", () => {
    expect(parseVideoEmbed(null)).toBeNull();
    expect(parseVideoEmbed("")).toBeNull();
    expect(parseVideoEmbed("nao e url")).toBeNull();
    expect(parseVideoEmbed("javascript:alert(1)")).toBeNull();
  });
});

describe("iframesToMarkdownLinks", () => {
  it("converte o código de incorporação do SmartPlayer em link com legenda", () => {
    const html =
      `<iframe src="${SMARTPLAYER}" title="Criar instância no Evolution pela Cloudfy" ` +
      `allow="accelerometer; clipboard-write" allowfullscreen="" ` +
      `style="width: 100%; aspect-ratio: 16 / 9; border: 0px; margin: 0px auto;"></iframe>`;

    expect(iframesToMarkdownLinks(html).trim())
      .toBe(`[Criar instância no Evolution pela Cloudfy](${SMARTPLAYER})`);
  });

  it("usa 'Vídeo' quando o iframe não tem title", () => {
    expect(iframesToMarkdownLinks(`<iframe src="${SMARTPLAYER}"></iframe>`).trim())
      .toBe(`[Vídeo](${SMARTPLAYER})`);
  });

  it("preserva o texto ao redor do iframe", () => {
    const out = iframesToMarkdownLinks(
      `Veja na prática:\n<iframe src="${SMARTPLAYER}"></iframe>\nDepois disso, confirme.`,
    );
    expect(out).toContain("Veja na prática:");
    expect(out).toContain("Depois disso, confirme.");
    expect(out).toContain(`[Vídeo](${SMARTPLAYER})`);
  });

  it("descarta iframe sem src em vez de deixar HTML solto", () => {
    expect(iframesToMarkdownLinks("<iframe></iframe>").trim()).toBe("");
  });

  it("não mexe em conteúdo sem iframe", () => {
    const md = "## Título\n\nUm parágrafo qualquer.";
    expect(iframesToMarkdownLinks(md)).toBe(md);
  });
});
