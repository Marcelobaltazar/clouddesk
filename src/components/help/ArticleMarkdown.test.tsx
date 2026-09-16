import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArticleMarkdown } from "./ArticleMarkdown";
import { normalizeArticleMarkdown } from "@/lib/help-markdown";

function renderMarkdown(md: string) {
  return render(
    <MemoryRouter>
      <ArticleMarkdown content={md} />
    </MemoryRouter>,
  );
}

describe("ArticleMarkdown", () => {
  it("renderiza bloco de código com rótulo e botão de copiar", () => {
    const { container } = renderMarkdown("```bash\nnpm install\n```");

    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código" })).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe("npm install");
  });

  it("mantém código inline dentro do parágrafo", () => {
    const { container } = renderMarkdown("Use o comando `ls` para listar.");

    expect(container.querySelector("p code")?.textContent).toBe("ls");
    expect(screen.queryByRole("button", { name: "Copiar código" })).toBeNull();
  });

  it("transforma URL solta em link (GFM autolink)", () => {
    renderMarkdown("Acesse https://api.cloudfy.space/mcp para conectar.");

    const link = screen.getByRole("link", { name: /api\.cloudfy\.space/ });
    expect(link).toHaveAttribute("href", "https://api.cloudfy.space/mcp");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renderiza tabela GFM", () => {
    renderMarkdown("| Onde | Preço |\n| --- | --- |\n| App | Grátis |");

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Onde" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Grátis" })).toBeInTheDocument();
  });

  it("dá âncora aos títulos para o índice lateral", () => {
    const { container } = renderMarkdown("## Configurando o webhook");
    expect(container.querySelector("h2")?.id).toBe("configurando-o-webhook");
  });

  it("vira callout quando o blockquote começa com emoji", () => {
    const { container } = renderMarkdown("> ⚠️ Cuidado com essa configuração.");

    expect(container.querySelector("blockquote")).toBeNull();
    expect(screen.getByText(/Cuidado com essa configuração/)).toBeInTheDocument();
  });

  it("mantém blockquote comum quando não há emoji", () => {
    const { container } = renderMarkdown("> Uma citação sem emoji.");
    expect(container.querySelector("blockquote")).toBeInTheDocument();
  });

  it("renderiza o artigo em texto puro já com passos e código", () => {
    const content = [
      "Passo a passo:",
      "",
      "Abra o terminal.",
      "Exporte o token:",
      'export CLOUDFY_MCP_TOKEN="cfy_mcp_..."',
    ].join("\n");

    const { container } = renderMarkdown(normalizeArticleMarkdown(content, "Título"));

    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain("export CLOUDFY_MCP_TOKEN");
  });
});

describe("ArticleMarkdown — vídeo", () => {
  const SMARTPLAYER = "https://player.scaleup.com.br/embed/70b350e3ef7a254b97355cdc9a1b746f3e714f77";

  it("transforma link de vídeo sozinho no parágrafo em player", () => {
    const { container } = renderMarkdown(`[Criar instância](${SMARTPLAYER})`);

    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", SMARTPLAYER);
    expect(iframe).toHaveAttribute("title", "Criar instância");
    expect(iframe).toHaveClass("aspect-video");
    expect(screen.getByText("Criar instância")).toBeInTheDocument();
  });

  it("embute também a URL solta (autolink do GFM)", () => {
    const { container } = renderMarkdown(SMARTPLAYER);
    expect(container.querySelector("iframe")).toHaveAttribute("src", SMARTPLAYER);
  });

  it("mantém como link quando o vídeo está no meio de uma frase", () => {
    const { container } = renderMarkdown(`Veja [o vídeo](${SMARTPLAYER}) para entender.`);

    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /o vídeo/ })).toBeInTheDocument();
  });

  it("não embute domínio fora da lista", () => {
    const { container } = renderMarkdown("https://exemplo.com/video.mp4");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renderiza o iframe colado no artigo como player", () => {
    const content = `Veja como fazer:\n\n<iframe src="${SMARTPLAYER}" title="Passo a passo"></iframe>`;
    const { container } = renderMarkdown(normalizeArticleMarkdown(content, "Título"));

    expect(container.querySelector("iframe")).toHaveAttribute("src", SMARTPLAYER);
    expect(container.innerHTML).not.toContain("&lt;iframe");
  });
});

describe("ArticleMarkdown — callout sem emoji duplicado", () => {
  it("remove o emoji do texto, já que ele virou ícone", () => {
    const { container } = renderMarkdown("> ⚠️ Cuidado com essa configuração.");

    expect(container.textContent?.trim()).toBe("Cuidado com essa configuração.");
    expect(container.textContent).not.toContain("⚠️");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("preserva o restante da formatação dentro do callout", () => {
    const { container } = renderMarkdown("> ℹ️ Use o comando `ls` para **listar**.");

    expect(container.querySelector("code")?.textContent).toBe("ls");
    expect(container.querySelector("strong")?.textContent).toBe("listar");
    expect(container.textContent).not.toContain("ℹ️");
  });
});
