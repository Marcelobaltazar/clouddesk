// ─── link-guard — a IA só publica link que nós demos a ela ────────────────────
//
// O modelo inventou uma fonte plausível e inexistente
// (`https://cloudfy.com/docs/evolution-api/integracao-chatwoot`) e mandou para o
// cliente. Instrução de prompt não resolve isso: "nunca invente URLs" já estava
// escrito e foi ignorado. A garantia tem que ser estrutural — o texto passa por
// aqui antes de sair, e todo link que não veio do NOSSO contexto é removido.
//
// A allow-list é montada a cada turno a partir do que entrou no prompt (artigos
// do RAG, dados do cliente, links de fatura) mais as constantes fixas. Regra:
// **a IA só pode emitir uma URL que já estava na entrada dela**. Nada vindo do
// texto do cliente entra na lista — senão bastaria colar um link malicioso e
// pedir para a Luna repetir.
//
// Módulo puro de propósito (sem Deno.*): roda no Edge e no vitest.

/** URL em texto livre. Para em espaço, aspas e fechamento de markdown/parêntese. */
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gi;

/** Link markdown: [rótulo](url) */
const MD_LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/gi;

/** Pontuação que costuma grudar no fim de uma URL em prosa ("veja https://x.com/a."). */
const TRAILING_PUNCT_RE = /[.,;:!?»"')\]]+$/;

/**
 * Forma canônica para comparar duas URLs: esquema e host em minúsculas, sem
 * porta padrão, sem barra final, sem âncora. O caminho preserva o case — há
 * servidor que diferencia, e um falso positivo aqui apagaria link bom.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(TRAILING_PUNCT_RE, "");
  try {
    const u = new URL(trimmed);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

/** Todas as URLs presentes num texto, em forma canônica. */
export function collectUrls(text: string): string[] {
  const found = String(text ?? "").match(URL_RE) ?? [];
  return [...new Set(found.map(normalizeUrl))].filter(Boolean);
}

export interface LinkGuardResult {
  text: string;
  /** URLs descartadas, como o modelo as escreveu. Alimenta log e métrica. */
  removed: string[];
}

/** Linha que existe só para carregar a fonte — se o link cai, a linha vai junto. */
const SOURCE_LINE_RE = /^\s*(?:📚|🔗)?\s*Fontes?\s*:/i;

/** Versão sem /g de URL_RE: `test()` num regex global carrega lastIndex entre
 *  chamadas e passa a pular linhas. */
const HAS_URL_RE = /https?:\/\//i;

/**
 * Remove do texto todo link que não esteja na allow-list.
 *
 * - `[rótulo](url)` proibida vira só `rótulo` — a frase continua legível, o
 *   cliente só não recebe um link para lugar nenhum.
 * - URL solta proibida é apagada.
 * - Linha de "📚 Fonte:" que ficou sem link é removida inteira: uma fonte sem
 *   destino é pior que nenhuma fonte.
 */
export function enforceLinkAllowlist(
  text: string,
  allowed: Iterable<string>,
): LinkGuardResult {
  const allowSet = new Set([...allowed].map(normalizeUrl).filter(Boolean));
  const removed: string[] = [];
  const isAllowed = (url: string) => allowSet.has(normalizeUrl(url));

  let out = String(text ?? "");

  out = out.replace(MD_LINK_RE, (match, label: string, url: string) => {
    if (isAllowed(url)) return match;
    removed.push(url);
    return label.trim();
  });

  out = out.replace(URL_RE, (url) => {
    if (isAllowed(url)) return url;
    removed.push(url);
    // Devolve a pontuação que a regex engoliu, para não comer o ponto da frase.
    const tail = url.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    return tail;
  });

  if (removed.length > 0) {
    out = out
      .split("\n")
      .filter((line) => !(SOURCE_LINE_RE.test(line) && !HAS_URL_RE.test(line)))
      .join("\n");
  }

  // A remoção deixa espaços duplos e linhas órfãs no lugar do link.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: out, removed };
}
