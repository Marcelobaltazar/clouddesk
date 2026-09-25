// ─── Fatiamento de artigos da Central de Ajuda para a busca da IA ──────────────
//
// Por que fatiar: o modelo de embedding (gte-small) só enxerga ~512 tokens. Com
// o artigo inteiro num vetor só, tudo o que vinha depois dos primeiros ~2000
// caracteres era invisível para a busca — e 66 dos 116 artigos passam disso
// (o de planos, o de especificações técnicas, o de upgrade...).
//
// Cada trecho carrega o título do artigo e a seção em que está ("contextual
// chunk header"): um trecho "Plano Advanced — Redis, Chatwoot, 10 GB" sozinho
// não diz que é sobre planos da Cloudfy; com o título na frente, diz.
//
// Módulo PURO (sem Deno/Supabase): roda igual na Edge Function e nos testes em
// Node, para o índice gerado aqui e o testado no laboratório serem idênticos.

export interface KbChunk {
  index: number;
  /** Seção do artigo onde o trecho começa (último título Markdown visto). */
  heading: string | null;
  /** Texto limpo do trecho, sem o cabeçalho de contexto. */
  content: string;
  /** Texto que vai para o embedding: título + seção + trecho. */
  embedText: string;
}

/** Tamanho alvo de um trecho. ~900 caracteres cabem com folga nos 512 tokens
 *  do gte-small mesmo com o cabeçalho (português quebra em mais tokens). */
const MAX_CHUNK_CHARS = 900;
/** Abaixo disso um trecho não "fecha" num título: junta com a seção seguinte.
 *  Seções de uma linha só viram vetores fracos quando isoladas. */
const MIN_CHUNK_CHARS = 280;
/** Teto do texto de embedding (cabeçalho + trecho). */
const MAX_EMBED_CHARS = 1400;

/** Normaliza para comparar títulos: sem acento, sem pontuação, minúsculo. */
function looseKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Limpa o Markdown/texto colado para busca: tira imagens, URLs de links,
 * separadores, marcações de ênfase, escapes do Intercom e caracteres
 * invisíveis. O que sobra é o texto que um cliente leria.
 */
export function cleanArticleText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    // caracteres invisíveis (zero-width, BOM) que vêm do Intercom
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    // imagens não ajudam a busca por texto
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // [texto](url) → texto
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    // separadores "* * *", "---", "___"
    .replace(/^\s*(?:\*\s*){3,}\s*$/gm, '')
    .replace(/^\s*[-_]{3,}\s*$/gm, '')
    // ênfase e escapes do Markdown exportado ("1\.", "\-")
    .replace(/\*\*|__/g, '')
    .replace(/\\([.\-*_#()[\]])/g, '$1')
    // linhas só com espaço viram linha vazia; espaços repetidos somem
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Block {
  heading: string | null;
  text: string;
  /** true quando o bloco é o próprio título de uma seção */
  isHeading: boolean;
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*$/;

/** Quebra um bloco grande em pedaços ≤ max, preferindo fim de linha/frase. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
    );
    const at = cut > max * 0.4 ? cut + 1 : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function toBlocks(title: string, cleaned: string): Block[] {
  const lines = cleaned.split('\n');
  const titleKey = looseKey(title);

  // Artigos colados como texto repetem o título na primeira linha.
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  if (start < lines.length) {
    const first = lines[start].replace(HEADING_RE, '$1');
    if (looseKey(first) === titleKey) start++;
  }

  const blocks: Block[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ heading, text, isHeading: false });
    buf = [];
  };

  for (const line of lines.slice(start)) {
    const h = line.match(HEADING_RE);
    if (h) {
      flush();
      heading = h[1].trim();
      blocks.push({ heading, text: heading, isHeading: true });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

/**
 * Fatia um artigo em trechos de até ~900 caracteres, respeitando seções:
 * um título Markdown encerra o trecho corrente (se ele já tiver corpo), e
 * listas/parágrafos curtos são agrupados até o tamanho alvo.
 */
export function chunkArticle(title: string, rawContent: string): KbChunk[] {
  const cleanTitle = cleanArticleText(title).replace(/\s+/g, ' ').trim();
  const cleaned = cleanArticleText(rawContent);
  const blocks = toBlocks(cleanTitle, cleaned);

  const pieces: Array<{ heading: string | null; text: string }> = [];
  let cur: string[] = [];
  let curLen = 0;
  let curHeading: string | null = null;

  const emit = () => {
    const text = cur.join('\n').trim();
    if (text) pieces.push({ heading: curHeading, text });
    cur = [];
    curLen = 0;
  };

  for (const b of blocks) {
    if (b.isHeading) {
      if (curLen >= MIN_CHUNK_CHARS) emit();
      if (curLen === 0) curHeading = b.heading;
      cur.push(b.text);
      curLen += b.text.length + 1;
      continue;
    }
    for (const part of splitLong(b.text, MAX_CHUNK_CHARS)) {
      if (curLen > 0 && curLen + part.length + 1 > MAX_CHUNK_CHARS) {
        emit();
        curHeading = b.heading;
      }
      if (curLen === 0) curHeading = b.heading;
      cur.push(part);
      curLen += part.length + 1;
    }
  }
  emit();

  // Último trecho pequeno demais: cola no anterior (se couber com folga).
  if (pieces.length >= 2) {
    const last = pieces[pieces.length - 1];
    const prev = pieces[pieces.length - 2];
    if (last.text.length < MIN_CHUNK_CHARS && prev.text.length + last.text.length < MAX_CHUNK_CHARS * 1.3) {
      prev.text = `${prev.text}\n${last.text}`;
      pieces.pop();
    }
  }

  // Artigo vazio (só imagem/vídeo): ainda indexa pelo título.
  if (pieces.length === 0) pieces.push({ heading: null, text: cleanTitle });

  const chunks = pieces.map((p, index) => {
    // A seção entra no cabeçalho só quando o trecho não começa por ela (trecho
    // do meio de uma seção longa) — senão ela apareceria duas vezes.
    const withHeading = !!p.heading &&
      looseKey(p.heading) !== looseKey(cleanTitle) &&
      !p.text.startsWith(p.heading);
    const header = withHeading ? `${cleanTitle}\n${p.heading}` : cleanTitle;
    return {
      index,
      heading: p.heading,
      content: p.text,
      embedText: `${header}\n${p.text}`.slice(0, MAX_EMBED_CHARS),
    };
  });

  // Um vetor só do título. Os títulos da Central são escritos como a pergunta
  // do cliente ("Preciso pagar o Claude para usar o MCP?"); diluído no primeiro
  // trecho, esse sinal se perde. No gabarito: MRR 0.68 → 0.70.
  if (chunks.length > 1 || chunks[0].content !== cleanTitle) {
    chunks.push({ index: chunks.length, heading: null, content: cleanTitle, embedText: cleanTitle });
  }
  return chunks;
}

/** Snippets são curtos e canônicos: um trecho só, com o título na frente. */
export function chunkSnippet(title: string, rawContent: string): KbChunk[] {
  const cleanTitle = cleanArticleText(title).replace(/\s+/g, ' ').trim();
  const text = cleanArticleText(rawContent);
  const parts = splitLong(text || cleanTitle, MAX_CHUNK_CHARS);
  return parts.map((content, index) => ({
    index,
    heading: null,
    content,
    embedText: `${cleanTitle}\n${content}`.slice(0, MAX_EMBED_CHARS),
  }));
}
