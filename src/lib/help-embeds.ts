/**
 * help-embeds.ts — Vídeos embutidos nos artigos da Central de Ajuda.
 *
 * Quem escreve o artigo cola o código de incorporação que a plataforma de vídeo
 * fornece (um `<iframe>`) ou simplesmente o link do vídeo numa linha sozinha.
 * Aqui esse endereço é reconhecido e convertido na URL de player.
 *
 * SEGURANÇA: só viram `<iframe>` os endereços de uma lista fechada de domínios.
 * O conteúdo do artigo vem do banco e nunca é renderizado como HTML bruto — se
 * o domínio não estiver na lista, o endereço continua sendo apenas um link.
 */

export interface VideoEmbed {
  /** URL final carregada no iframe. */
  src: string;
  /** Nome amigável do player, usado no aria-label e no fallback. */
  provider: string;
  /** Link para abrir o vídeo fora do artigo. */
  watchUrl: string;
}

/**
 * Cada provedor reconhece a URL e devolve o endereço do player.
 * SmartPlayer é o padrão da Cloudfy; os demais entram porque o custo é zero e
 * evitam ter que mexer no código se um artigo usar outra plataforma.
 */
const PROVIDERS: Array<{
  name: string;
  matches: (url: URL) => boolean;
  toEmbed: (url: URL) => string | null;
}> = [
  {
    name: "SmartPlayer",
    matches: (u) => u.hostname === "player.scaleup.com.br",
    // O link que o SmartPlayer entrega já é o endereço do player.
    toEmbed: (u) => u.href,
  },
  {
    name: "YouTube",
    matches: (u) =>
      u.hostname === "youtu.be" ||
      /(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname),
    toEmbed: (u) => {
      const id =
        u.hostname === "youtu.be"
          ? u.pathname.slice(1)
          : u.searchParams.get("v") ?? u.pathname.replace(/^\/(embed|shorts|v)\//, "");
      const clean = id.split("/")[0];
      return /^[\w-]{6,20}$/.test(clean)
        ? `https://www.youtube-nocookie.com/embed/${clean}`
        : null;
    },
  },
  {
    name: "Vimeo",
    matches: (u) => /(^|\.)vimeo\.com$/.test(u.hostname),
    toEmbed: (u) => {
      const id = u.pathname.replace(/^\/(video\/)?/, "").split("/")[0];
      return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    },
  },
  {
    name: "Loom",
    matches: (u) => /(^|\.)loom\.com$/.test(u.hostname),
    toEmbed: (u) => {
      const id = u.pathname.replace(/^\/(share|embed)\//, "").split("/")[0];
      return /^[a-f0-9]{16,}$/i.test(id) ? `https://www.loom.com/embed/${id}` : null;
    },
  },
];

/** URL de vídeo reconhecida → dados do player. Caso contrário, `null`. */
export function parseVideoEmbed(href: string | null | undefined): VideoEmbed | null {
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  for (const provider of PROVIDERS) {
    if (!provider.matches(url)) continue;
    const src = provider.toEmbed(url);
    if (!src) return null;
    return { src, provider: provider.name, watchUrl: url.href };
  }
  return null;
}

/** O endereço aponta para um vídeo que sabemos embutir? */
export function isVideoUrl(href: string | null | undefined): boolean {
  return parseVideoEmbed(href) !== null;
}

// ─── Código de incorporação colado ───────────────────────────────────────────

const IFRAME_RE = /<iframe\b[^>]*>[\s\S]*?<\/iframe>|<iframe\b[^>]*\/?>/gi;

function attributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? "").trim() || null : null;
}

/**
 * Troca cada `<iframe>` colado no artigo por um link Markdown na própria linha.
 *
 * O ReactMarkdown não renderiza HTML bruto, então um iframe colado apareceria
 * como texto solto no meio do artigo. Virando link, o renderizador reconhece o
 * vídeo (domínio conhecido) ou deixa um link clicável (domínio desconhecido).
 */
export function iframesToMarkdownLinks(content: string): string {
  if (!content.includes("<iframe")) return content;

  return content.replace(IFRAME_RE, (tag) => {
    const src = attributeOf(tag, "src");
    if (!src) return "";

    const title = attributeOf(tag, "title") ?? "Vídeo";
    // Colchetes no título quebrariam a sintaxe do link.
    const safeTitle = title.replace(/[[\]]/g, "");
    return `\n\n[${safeTitle}](${src})\n\n`;
  });
}

/** Atributo `allow` do iframe — o mesmo conjunto que o SmartPlayer recomenda. */
export const EMBED_ALLOW =
  "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
