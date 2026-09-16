import { describe, it, expect } from "vitest";
import {
  normalizeArticleMarkdown,
  hasMarkdownStructure,
  extractToc,
  readingTimeMinutes,
} from "./help-markdown";

describe("hasMarkdownStructure", () => {
  it("reconhece título, cerca, bullet, lista numerada e tabela", () => {
    expect(hasMarkdownStructure("## Passo 1")).toBe(true);
    expect(hasMarkdownStructure("```bash\nls\n```")).toBe(true);
    expect(hasMarkdownStructure("- item")).toBe(true);
    expect(hasMarkdownStructure("1. item")).toBe(true);
    expect(hasMarkdownStructure("| a | b |\n| --- | --- |")).toBe(true);
  });

  it("não confunde texto corrido com Markdown", () => {
    expect(hasMarkdownStructure("Um parágrafo qualquer.\nOutra linha.")).toBe(false);
  });
});

describe("normalizeArticleMarkdown — artigos já em Markdown", () => {
  it("devolve o conteúdo intacto", () => {
    const md = "## Quando ajustar\n\n-   Primeiro item\n-   Segundo item";
    expect(normalizeArticleMarkdown(md, "Qualquer título")).toBe(md);
  });

  it("remove o título repetido antes do Markdown", () => {
    const md = "# Mudando as senhas do PostgreSQL\n\n## Por que funciona assim\n\n- item";
    const out = normalizeArticleMarkdown(md, "Mudando as senhas do PostgreSQL");
    expect(out.startsWith("## Por que funciona assim")).toBe(true);
  });
});

describe("normalizeArticleMarkdown — título duplicado", () => {
  it("remove a primeira linha quando ela é uma variação do título", () => {
    const content = [
      "Como conectar o MCP da Cloudfy no meu Claude Code pessoal?",
      "Claude Code é a versão do Claude que roda no terminal do seu computador.",
    ].join("\n");

    const out = normalizeArticleMarkdown(
      content,
      "Como conectar o MCP da Cloudfy no meu Claude Code via TERMINAL pessoal?",
    );
    expect(out).not.toContain("pessoal?");
    expect(out).toContain("Claude Code é a versão do Claude");
  });

  it("preserva um primeiro parágrafo que só parece com o título", () => {
    const content = "Aqui explicamos tudo sobre outra coisa completamente diferente.";
    expect(normalizeArticleMarkdown(content, "Como resetar a senha do Chatwoot")).toBe(content);
  });
});

describe("normalizeArticleMarkdown — texto puro", () => {
  it("numera os passos anunciados por 'Passo a passo:'", () => {
    const content = [
      "Passo a passo:",
      "",
      "Abra o painel.",
      "Clique em Conectar.",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("1. Abra o painel.");
    expect(out).toContain("2. Clique em Conectar.");
  });

  it("vira bullets quando a linha anterior termina em dois-pontos", () => {
    const content = "Depende de onde você conectou:\nToken de projeto: exclua o token.\nConector OAuth: revogue na ferramenta.";
    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("- Token de projeto: exclua o token.");
    expect(out).toContain("- Conector OAuth: revogue na ferramenta.");
  });

  it("fecha a lista num parágrafo de conclusão", () => {
    const content = [
      "Alguns exemplos:",
      "",
      "Primeiro exemplo.",
      "Segundo exemplo.",
      "Ou seja: no fim das contas tudo fica mais simples.",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("- Segundo exemplo.");
    expect(out).toContain("\nOu seja: no fim das contas tudo fica mais simples.");
    expect(out).not.toContain("- Ou seja:");
  });

  it("transforma comando de terminal em bloco de código bash", () => {
    const content = "Rode o comando:\n\nclaude mcp add --transport http cloudfy https://api.cloudfy.space/mcp";
    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("```bash");
    expect(out).toContain("claude mcp add --transport http cloudfy");
  });

  it("não confunde prosa em português com comando de terminal", () => {
    const content = "claude é monstrão, faz muita coisa bacana, mas tem que saber pedir";
    const out = normalizeArticleMarkdown(content, "Outro título");
    expect(out).not.toContain("```");
    expect(out).toBe(content);
  });

  it("agrupa o JSON colado no texto numa cerca json indentada no passo", () => {
    const content = [
      "Passo a passo:",
      "",
      "Crie um arquivo .mcp.json com o conteúdo:",
      "{",
      '  "mcpServers": {',
      '    "cloudfy": { "type": "http" }',
      "  }",
      "}",
      "(troque os valores pelos seus)",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("1. Crie um arquivo .mcp.json com o conteúdo:");
    expect(out).toContain("   ```json");
    expect(out).toContain('   "mcpServers"');
    expect(out).toContain("   (troque os valores pelos seus)");
  });

  it("converte linhas separadas por TAB em tabela", () => {
    const content = [
      "Resumindo:",
      "",
      "Onde usar\tPrecisa pagar?",
      "Claude.ai\tNão",
      "Claude Code\tSim",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("| Onde usar | Precisa pagar? |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| Claude Code | Sim |");
  });

  it("promove rótulo de seção a subtítulo dentro da lista", () => {
    const content = [
      "Você pode pedir coisas como:",
      "",
      "Sobre suas infraestruturas",
      "",
      "Listar as infraestruturas que você tem.",
      "Sobre automações",
      "",
      "Ver quais fluxos já existem.",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("### Sobre suas infraestruturas");
    expect(out).toContain("### Sobre automações");
    expect(out).toContain("- Listar as infraestruturas que você tem.");
    expect(out).toContain("- Ver quais fluxos já existem.");
  });

  it("vira callout quando a linha começa com emoji de aviso", () => {
    const content = "Texto normal.\n\nℹ️ Um aviso importante para o leitor.";
    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("> ℹ️ Um aviso importante para o leitor.");
  });

  it("preserva quebras de linha do parágrafo em vez de colar tudo", () => {
    const content = "Primeira linha do parágrafo.\nSegunda linha do parágrafo.";
    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toBe("Primeira linha do parágrafo.  \nSegunda linha do parágrafo.");
  });

  it("um passo que termina em ':' continua sendo passo, não abre nova lista", () => {
    const content = [
      "Passo a passo:",
      "",
      "Abra o terminal.",
      "Exporte o token como variável de ambiente:",
      "export CLOUDFY_MCP_TOKEN=\"cfy_mcp_...\"",
      "Confirme a conexão.",
    ].join("\n");

    const out = normalizeArticleMarkdown(content, "Título");
    expect(out).toContain("2. Exporte o token como variável de ambiente:");
    expect(out).toContain("3. Confirme a conexão.");
    expect(out).toContain("   ```bash");
  });

  it("devolve vazio quando o corpo é só o título", () => {
    expect(normalizeArticleMarkdown("Como trocar o nó do Gemini", "Como trocar o nó do Gemini")).toBe("");
  });
});

describe("extractToc", () => {
  it("lista h2 e h3 e ignora títulos dentro de cercas", () => {
    const md = [
      "## Primeira seção",
      "texto",
      "```bash",
      "## isto é um comentário, não um título",
      "```",
      "### Sub seção",
    ].join("\n");

    expect(extractToc(md)).toEqual([
      { id: "primeira-secao", text: "Primeira seção", level: 2 },
      { id: "sub-secao", text: "Sub seção", level: 3 },
    ]);
  });

  it("desambigua ids repetidos", () => {
    const toc = extractToc("## Configuração\n## Configuração");
    expect(toc.map((t) => t.id)).toEqual(["configuracao", "configuracao-1"]);
  });
});

describe("readingTimeMinutes", () => {
  it("nunca fica abaixo de 1 minuto", () => {
    expect(readingTimeMinutes("três palavras aqui")).toBe(1);
  });

  it("cresce com o tamanho do texto", () => {
    expect(readingTimeMinutes("palavra ".repeat(600))).toBe(3);
  });
});

describe("reparo de URL", () => {
  it("conserta https: sem as duas barras para o autolink funcionar", () => {
    const out = normalizeArticleMarkdown(
      "Suas credenciais estão em https:cloudfy.space/login na aba meus serviços.",
      "Onde encontrar minhas credenciais?",
    );
    expect(out).toContain("https://cloudfy.space/login");
  });

  it("não mexe em URL dentro de bloco de código", () => {
    const md = "## Config\n\n```json\n{ \"url\": \"https:exemplo.com\" }\n```";
    expect(normalizeArticleMarkdown(md, "Título")).toContain('"https:exemplo.com"');
  });

  it("preserva URL já correta", () => {
    const out = normalizeArticleMarkdown("Acesse https://api.cloudfy.space/mcp agora.", "Título");
    expect(out).toContain("https://api.cloudfy.space/mcp");
    expect(out).not.toContain("////");
  });
});
