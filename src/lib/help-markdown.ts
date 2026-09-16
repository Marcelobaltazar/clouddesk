/**
 * help-markdown.ts — Normaliza o conteúdo dos artigos da Central de Ajuda.
 *
 * Boa parte dos artigos foi escrita/colada como TEXTO PURO, sem sintaxe
 * Markdown. Como o Markdown junta linhas separadas por uma única quebra,
 * esses artigos viram um paredão de texto: os passos perdem a numeração,
 * comandos e JSON se misturam ao parágrafo e o título aparece repetido na
 * primeira linha.
 *
 * Este módulo reconstrói a estrutura ANTES de entregar o conteúdo ao
 * ReactMarkdown:
 *   - remove o título repetido no começo do corpo;
 *   - transforma blocos de comando/JSON em cercas de código;
 *   - numera os passos quando o texto anuncia "Passo a passo:";
 *   - vira bullets quando a linha anterior termina em ":";
 *   - promove rótulos de seção a subtítulo;
 *   - monta tabela a partir de linhas separadas por TAB;
 *   - converte linhas iniciadas por emoji de aviso em callout (blockquote);
 *   - troca o `<iframe>` de vídeo colado por um link (ver @/lib/help-embeds),
 *     isolado em parágrafo próprio para o renderizador virar player.
 *
 * REGRA DE OURO: se o artigo JÁ usa Markdown (títulos, listas ou cercas), o
 * conteúdo volta intacto — só o título duplicado é removido. A heurística só
 * roda em texto puro, onde não há estrutura para preservar.
 */

import { iframesToMarkdownLinks, isVideoUrl } from "@/lib/help-embeds";

// ─── Detecção de Markdown existente ──────────────────────────────────────────

const MD_HEADING_RE = /^ {0,3}#{1,6}\s+\S/m;
const MD_FENCE_RE = /^ {0,3}(```|~~~)/m;
const MD_BULLET_RE = /^ {0,3}[-*+]\s+\S/m;
const MD_ORDERED_RE = /^ {0,3}\d+[.)]\s+\S/m;
const MD_TABLE_RE = /^ {0,3}\|.*\|/m;

/** O artigo já vem escrito em Markdown de verdade? */
export function hasMarkdownStructure(content: string): boolean {
  return (
    MD_HEADING_RE.test(content) ||
    MD_FENCE_RE.test(content) ||
    MD_BULLET_RE.test(content) ||
    MD_ORDERED_RE.test(content) ||
    MD_TABLE_RE.test(content)
  );
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokenize(s: string): string[] {
  return deaccent(s.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// ─── Título duplicado ────────────────────────────────────────────────────────

const TITLE_ECHO_THRESHOLD = 0.7;

/**
 * A primeira linha do corpo é o próprio título do artigo?
 * Comparação por conjunto de palavras — os autores costumam colar uma variação
 * do título ("...no meu Claude Code pessoal?" vs "...via TERMINAL pessoal?").
 */
function isTitleEcho(line: string, title: string): boolean {
  const lineTokens = tokenize(line.replace(/^#{1,6}\s+/, ""));
  const titleTokens = tokenize(title);
  if (titleTokens.length < 2 || lineTokens.length === 0) return false;
  // Linha bem maior que o título já é um parágrafo de verdade.
  if (lineTokens.length > titleTokens.length * 1.6 + 2) return false;

  const lineSet = new Set(lineTokens);
  const shared = titleTokens.filter((t) => lineSet.has(t)).length;
  return shared / titleTokens.length >= TITLE_ECHO_THRESHOLD;
}

/** Remove a primeira linha quando ela apenas repete o título do artigo. */
export function stripDuplicateTitle(content: string, title: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return content;

  if (!isTitleEcho(lines[i], title)) return content;
  return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
}

// ─── Classificação de linha (texto puro) ─────────────────────────────────────

const SHELL_COMMANDS = [
  "export", "set", "npm", "npx", "yarn", "pnpm", "bun", "curl", "wget",
  "docker", "docker-compose", "sudo", "apt", "apt-get", "apk", "git", "cd",
  "mkdir", "chmod", "chown", "ssh", "scp", "bash", "sh", "zsh", "python",
  "python3", "pip", "pip3", "node", "deno", "psql", "mysql", "redis-cli",
  "systemctl", "journalctl", "claude", "codex", "supabase", "kubectl", "helm",
];
const SHELL_COMMAND_RE = new RegExp(`^(${SHELL_COMMANDS.join("|")})\\s+\\S`);
const SHELL_PROMPT_RE = /^[$#]\s+\S/;
const ENV_ASSIGN_RE = /^[A-Z][A-Z0-9_]{2,}=/;
const CALLOUT_RE = /^(ℹ️|⚠️|✅|❌|🔴|🟢|🟡|💡|📌|❗|‼️|🚨|👉|⭐)/u;
/** Linha que é só um vídeo: `[título](url)` ou a URL sozinha. */
const LONE_LINK_RE = /^\[([^\]]*)\]\((\S+)\)$|^(https?:\/\/\S+)$/;
const PARENTHETICAL_RE = /^\(.+\)[.!?]?$/;
const STEPS_CUE_RE =
  /^(passo a passo|passo-a-passo|como fazer|etapas|passos|siga os passos|como configurar|como proceder|procedimento|para configurar)\b[^:]*:$/i;
const CONCLUSION_RE =
  /^(ou seja|resumindo|em resumo|no fim|no final|portanto|por isso|isso significa|em outras palavras|resumo|pronto|vale lembrar)\b/i;
/** Comando de verdade não tem acento — prosa em português tem. */
const ACCENT_RE = /[À-ÿ]/;

function isCodeLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 400) return false;
  if (ACCENT_RE.test(t)) return false;
  if (t.split(/\s+/).length > 25) return false;
  return SHELL_PROMPT_RE.test(t) || SHELL_COMMAND_RE.test(t) || ENV_ASSIGN_RE.test(t);
}

/** Início de um bloco JSON/objeto colado no meio do texto. */
function isBraceStart(line: string): boolean {
  return /^[{[]\s*$/.test(line.trim());
}

function countBraces(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth;
}

/** A linha inteira é um vídeo reconhecido (link Markdown ou URL solta)? */
function isVideoLine(line: string): boolean {
  const match = line.trim().match(LONE_LINK_RE);
  return match ? isVideoUrl(match[2] ?? match[3]) : false;
}

function isTableRow(line: string): boolean {
  return line.includes("\t") && line.split("\t").filter((c) => c.trim()).length >= 2;
}

function guessLanguage(lines: string[]): string {
  const first = lines[0]?.trim() ?? "";
  if (/^[{[]/.test(first)) return "json";
  if (SHELL_PROMPT_RE.test(first) || SHELL_COMMAND_RE.test(first) || ENV_ASSIGN_RE.test(first)) {
    return "bash";
  }
  return "text";
}

const CUE_MAX_LEN = 120;
const SECTION_LABEL_MAX_LEN = 60;
const HEADING_MAX_LEN = 80;

/** "Passo a passo:" / "Alguns exemplos:" — anuncia a lista do bloco seguinte. */
function cueTypeOf(line: string): "ol" | "ul" | null {
  const t = line.trim();
  if (!t.endsWith(":") || t.length > CUE_MAX_LEN) return null;
  return STEPS_CUE_RE.test(t) ? "ol" : "ul";
}

/** Rótulo curto de seção ("Sobre automações (n8n)", "No geral"). */
function isSectionLabel(line: string, maxLen: number): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > maxLen) return false;
  if (/[.,;:!]$/.test(t)) return false;
  if (CALLOUT_RE.test(t) || isCodeLine(t) || PARENTHETICAL_RE.test(t) || isTableRow(t)) return false;
  if (/\]\(|https?:\/\//.test(t)) return false;
  return tokenize(t).length >= 2;
}

// ─── Chunks: a unidade intermediária de um bloco ─────────────────────────────

type Chunk =
  | { kind: "text"; lines: string[] }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "embed"; line: string }       // vídeo sozinho na linha
  | { kind: "note"; line: string }        // "(observação entre parênteses)"
  | { kind: "callout"; line: string };

/** Quebra um bloco em trechos de texto, código, tabela, nota e callout. */
function splitIntoChunks(blockLines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;

  const isSpecial = (l: string) =>
    isBraceStart(l) || isCodeLine(l) || isTableRow(l) || isVideoLine(l) ||
    CALLOUT_RE.test(l.trim()) || PARENTHETICAL_RE.test(l.trim());

  while (i < blockLines.length) {
    const line = blockLines[i];

    // Bloco JSON/objeto: consome até as chaves fecharem.
    if (isBraceStart(line)) {
      const buf: string[] = [];
      let depth = 0;
      while (i < blockLines.length) {
        buf.push(blockLines[i]);
        depth += countBraces(blockLines[i]);
        i++;
        if (depth <= 0) break;
      }
      chunks.push({ kind: "code", lines: buf });
      continue;
    }

    if (isCodeLine(line)) {
      const buf: string[] = [];
      while (i < blockLines.length && isCodeLine(blockLines[i])) {
        buf.push(blockLines[i].trim());
        i++;
      }
      chunks.push({ kind: "code", lines: buf });
      continue;
    }

    // Duas ou mais linhas com TAB viram tabela (a primeira é o cabeçalho).
    if (isTableRow(line) && isTableRow(blockLines[i + 1] ?? "")) {
      const rows: string[][] = [];
      while (i < blockLines.length && isTableRow(blockLines[i])) {
        rows.push(blockLines[i].split("\t").map((c) => c.trim()));
        i++;
      }
      chunks.push({ kind: "table", rows });
      continue;
    }

    // Vídeo precisa ficar sozinho no parágrafo para virar player.
    if (isVideoLine(line)) {
      chunks.push({ kind: "embed", line: line.trim() });
      i++;
      continue;
    }

    if (CALLOUT_RE.test(line.trim())) {
      chunks.push({ kind: "callout", line: line.trim() });
      i++;
      continue;
    }

    if (PARENTHETICAL_RE.test(line.trim())) {
      chunks.push({ kind: "note", line: line.trim() });
      i++;
      continue;
    }

    const buf: string[] = [];
    while (i < blockLines.length && !isSpecial(blockLines[i])) {
      buf.push(blockLines[i].trim());
      i++;
    }
    if (buf.length) chunks.push({ kind: "text", lines: buf });
  }

  return chunks;
}

function fence(lines: string[], indent = ""): string[] {
  return [
    `${indent}\`\`\`${guessLanguage(lines)}`,
    ...lines.map((l) => (l.trim() ? indent + l : "")),
    `${indent}\`\`\``,
  ];
}

function renderTable(rows: string[][]): string[] {
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (r: string[], c: number) => (r[c] ?? "").replace(/\|/g, "\\|");
  const line = (r: string[]) =>
    "| " + Array.from({ length: cols }, (_, c) => cell(r, c)).join(" | ") + " |";

  return [
    line(rows[0]),
    "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |",
    ...rows.slice(1).map(line),
  ];
}

// ─── Conversão principal ─────────────────────────────────────────────────────

/** Texto puro → Markdown estruturado. */
function plainTextToMarkdown(content: string): string {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => l.trim() !== ""))
    .filter((b) => b.length > 0);

  const out: string[] = [];
  /** Lista em andamento — atravessa blocos até algo quebrá-la. */
  let list: { type: "ol" | "ul"; counter: number } | null = null;

  const push = (...lines: string[]) => out.push(...lines);
  const closeList = () => { list = null; };
  const indent = () => (list?.type === "ol" ? "   " : "  ");

  const pushItem = (text: string) => {
    if (!list) list = { type: "ul", counter: 0 };
    list.counter++;
    push(list.type === "ol" ? `${list.counter}. ${text}` : `- ${text}`);
  };

  blocks.forEach((blockLines, blockIndex) => {
    const hasNextBlock = blockIndex < blocks.length - 1;
    const chunks = splitIntoChunks(blockLines);

    chunks.forEach((chunk, chunkIndex) => {
      const isLastChunk = chunkIndex === chunks.length - 1;

      if (chunk.kind === "code") {
        // Dentro de um passo, o código fica indentado para continuar o item.
        const inItem = list !== null && list.counter > 0;
        push("", ...fence(chunk.lines, inItem ? indent() : ""), "");
        return;
      }

      if (chunk.kind === "table") {
        closeList();
        push("", ...renderTable(chunk.rows), "");
        return;
      }

      if (chunk.kind === "embed") {
        // Fora da lista: um player no meio de um item ficaria ilegível.
        closeList();
        push("", chunk.line, "");
        return;
      }

      if (chunk.kind === "callout") {
        closeList();
        push("", `> ${chunk.line}`, "");
        return;
      }

      if (chunk.kind === "note") {
        if (list && list.counter > 0) push("", `${indent()}${chunk.line}`, "");
        else push(chunk.line, "");
        return;
      }

      // ── texto ──
      const paragraph: string[] = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        // Duas barras no fim = quebra de linha forte: nada de paredão.
        push(paragraph.join("  \n"), "");
        paragraph.length = 0;
      };

      chunk.lines.forEach((line, lineIndex) => {
        const isLastLine = isLastChunk && lineIndex === chunk.lines.length - 1;
        const cue = cueTypeOf(line);

        // Fecho de raciocínio depois de uma lista ("Ou seja: ...", "Resumindo:").
        if (list && list.counter > 0 && CONCLUSION_RE.test(line)) {
          flushParagraph();
          push("", line, "");
          list = cue ? { type: cue, counter: 0 } : null;
          return;
        }

        // "Passo a passo:" — anuncia a lista, nunca é item dela.
        // Dentro de uma lista em andamento, um passo pode terminar em ":" para
        // apresentar o comando seguinte; aí a linha continua sendo um item.
        if (cue && (list === null || STEPS_CUE_RE.test(line.trim()))) {
          flushParagraph();
          push("", line, "");
          list = { type: cue, counter: 0 };
          return;
        }

        // Rótulo de seção fechando o bloco ("Sobre automações (n8n)").
        if (isLastLine && hasNextBlock && list && isSectionLabel(line, SECTION_LABEL_MAX_LEN)) {
          const resumeType = list.type;
          flushParagraph();
          push("", `### ${line}`, "");
          list = { type: resumeType, counter: 0 };
          return;
        }

        if (list) {
          flushParagraph();
          pushItem(line);
          return;
        }

        // Subtítulo: linha curta abrindo o bloco, com conteúdo depois dela.
        const isBlockOpener = chunkIndex === 0 && lineIndex === 0;
        const hasMoreContent = chunk.lines.length > 1 || !isLastChunk || hasNextBlock;
        if (isBlockOpener && hasMoreContent && isSectionLabel(line, HEADING_MAX_LEN)) {
          push(`## ${line}`, "");
          return;
        }

        paragraph.push(line);
      });

      flushParagraph();
    });
  });

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Reparo de URL ───────────────────────────────────────────────────────────

/** "https:cloudfy.space/login" → "https://cloudfy.space/login" (erro de digitação comum). */
const BROKEN_SCHEME_RE = /\bhttps?:(?!\/\/)(?=[a-z0-9-]+(\.[a-z0-9-]+)+)/gi;

/**
 * Conserta URLs sem as duas barras para que o autolink do GFM as reconheça.
 * Blocos de código ficam de fora: lá o texto é literal.
 */
function repairUrls(content: string): string {
  return content
    .split(/(^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)[ \t]*$)/m)
    .map((part) => (/^ {0,3}(```|~~~)/.test(part) ? part : part.replace(BROKEN_SCHEME_RE, (m) => `${m}//`)))
    .join("");
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Prepara o conteúdo do artigo para o ReactMarkdown.
 * Artigos já escritos em Markdown passam quase intactos.
 */
export function normalizeArticleMarkdown(content: string, title = ""): string {
  if (!content?.trim()) return "";

  const embedded = iframesToMarkdownLinks(content);
  const withoutTitle = title ? stripDuplicateTitle(embedded, title) : embedded;
  if (!withoutTitle.trim()) return "";

  if (hasMarkdownStructure(withoutTitle)) {
    return repairUrls(withoutTitle.replace(/\r\n/g, "\n")).trim();
  }

  return repairUrls(plainTextToMarkdown(withoutTitle));
}

/** Tempo de leitura aproximado, em minutos (mínimo 1). */
export function readingTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Gera um id estável para âncoras de título. */
export function headingId(text: string): string {
  return (
    deaccent(text.toLowerCase())
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 60) || "secao"
  );
}

/** Extrai os títulos h2/h3 do Markdown já normalizado (índice lateral). */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  let insideFence = false;

  for (const line of markdown.split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    const match = line.match(/^ {0,3}(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const level = match[1].length as 2 | 3;
    // Limpa marcações inline que não devem aparecer no índice.
    const text = match[2]
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();
    if (!text) continue;

    const base = headingId(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    entries.push({ id: count === 0 ? base : `${base}-${count}`, text, level });
  }

  return entries;
}
