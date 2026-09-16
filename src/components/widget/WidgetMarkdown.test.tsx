import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetMarkdown } from "./WidgetMarkdown";

const SMART = "https://player.scaleup.com.br/embed/70b350e3ef7a254b97355cdc9a1b746f3e714f77";

describe("WidgetMarkdown", () => {
  it("mostra bloco de código com rótulo e botão de copiar", () => {
    const { container } = render(<WidgetMarkdown content={"```bash\ndocker ps\n```"} />);

    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código" })).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe("docker ps");
  });

  it("transforma URL crua em link e deixa o CSS cortar o excesso", () => {
    const long = "https://chat.whatsapp.com/JOee5dBfOATATPyZZeHoet";
    render(<WidgetMarkdown content={`Entre aqui: ${long}`} />);

    const link = screen.getByRole("link");
    // O endereço e o title continuam inteiros; só o visível é cortado.
    expect(link).toHaveAttribute("href", long);
    expect(link).toHaveAttribute("title", long);
    expect(link).toHaveClass("truncate");
    // O protocolo sai: em bolha estreita ele só ocupa espaço.
    expect(link.textContent).toBe("chat.whatsapp.com/JOee5dBfOATATPyZZeHoet");
  });

  it("nunca deixa a URL quebrar em várias linhas", () => {
    render(<WidgetMarkdown content="https://cloudfy.space/login" />);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("cloudfy.space/login");
    expect(link).toHaveClass("max-w-full");
  });

  it("dá botão de copiar só para URL crua, não para link com rótulo", () => {
    const { rerender } = render(<WidgetMarkdown content="https://cloudfy.space/x" />);
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();

    rerender(<WidgetMarkdown content="[nosso site](https://cloudfy.space/x)" />);
    expect(screen.queryByRole("button", { name: "Copiar link" })).toBeNull();
  });

  it("mantém as três linhas do convite de comunidade separadas", () => {
    const { container } = render(
      <WidgetMarkdown
        content={[
          "💬 WhatsApp #1: https://chat.whatsapp.com/AAA",
          "💬 WhatsApp #2: https://chat.whatsapp.com/BBB",
          "🎮 Discord: https://discord.com/invite/CCC",
        ].join("\n")}
      />,
    );

    // remark-breaks: uma quebra simples vira <br>, não um parágrafo colado.
    expect(container.querySelectorAll("br")).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("vira player quando o vídeo está sozinho na linha", () => {
    const { container } = render(
      <WidgetMarkdown content={`Veja este vídeo: [Criar instância](${SMART})`} />,
    );
    expect(container.querySelector("iframe")).toHaveAttribute("src", SMART);
  });

  it("renderiza tabela com rolagem horizontal", () => {
    const { container } = render(
      <WidgetMarkdown content={"| Recurso | Uso |\n| --- | --- |\n| Memória | 2 GB |"} />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });

  it("mostra imagem solta como imagem, não como link de texto", () => {
    const { container } = render(
      <WidgetMarkdown content="Olha: https://x.supabase.co/desk-kb-images/a/b.png" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://x.supabase.co/desk-kb-images/a/b.png");
    // object-contain: print de erro não pode ser cortado.
    expect(img).toHaveClass("object-contain");
  });

  it("vira callout e tira o emoji duplicado", () => {
    const { container } = render(<WidgetMarkdown content="> ⚠️ Não reinicie duas vezes." />);

    expect(container.textContent).toContain("Não reinicie duas vezes.");
    expect(container.textContent).not.toContain("⚠️");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("título vira rótulo compacto, não título de documento", () => {
    const { container } = render(<WidgetMarkdown content="## O que checar primeiro" />);

    expect(container.querySelector("h2")).toBeNull();
    expect(screen.getByText("O que checar primeiro").tagName).toBe("STRONG");
  });
});
