/**
 * widget-message.ts — Preparo do conteúdo das mensagens do widget.
 *
 * O que chega na bolha vem de três lugares e em formatos diferentes:
 *   - IA: Markdown de verdade, mas com URLs cruas de propósito (o mesmo texto
 *     vai para o e-mail, onde Markdown apareceria literal — ver ai-pipeline.ts);
 *   - operador: texto digitado, que pode ter link, passos e trechos colados;
 *   - cliente: texto puro, que NUNCA é interpretado como Markdown (um log com
 *     `#` ou `*` viraria título e itálico no meio da conversa).
 *
 * Aqui o texto é preparado; quem desenha é WidgetMarkdown.tsx.
 */

import { isVideoUrl } from "@/lib/help-embeds";

// Uma URL termina onde começa espaço, `<`, `>` ou um fechamento de markdown.
const BARE_URL_RE = /(https?:\/\/[^\s<>()[\]]+)/gi;
const IMAGE_URL_RE = /(https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s)]*)?)/gi;

/** O trecho antes da URL indica que ela já faz parte de um link/imagem Markdown? */
function alreadyLinked(full: string, offset: number): boolean {
  const before = full.slice(Math.max(0, offset - 2), offset);
  return before === "](" || before.endsWith("(");
}

/** URL de imagem solta vira `![](url)` para aparecer como imagem, não como link. */
function linkifyImages(text: string): string {
  return text.replace(IMAGE_URL_RE, (url, _g, offset: number, full: string) =>
    alreadyLinked(full, offset) ? url : `![](${url})`,
  );
}

/**
 * URL crua vira link Markdown. A pontuação final da frase não entra no endereço
 * — sem isso, "acesse https://x.com/y." abriria um link com o ponto colado.
 */
function linkifyUrls(text: string): string {
  return text.replace(BARE_URL_RE, (url, _g, offset: number, full: string) => {
    if (alreadyLinked(full, offset)) return url;
    const trailing = url.match(/[.,;:!?]+$/)?.[0] ?? "";
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    return `[${clean}](${clean})${trailing}`;
  });
}

/**
 * Um vídeo precisa ficar sozinho no parágrafo para virar player. A IA costuma
 * mandar o link no meio do texto, então isolamos a linha.
 */
function isolateVideoLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\((\S+)\)/g, (match, label: string, url: string) =>
    isVideoUrl(url) ? `\n\n[${label}](${url})\n\n` : match,
  );
}

/** Texto da IA ou do operador, pronto para o Markdown. */
export function prepareRichMessage(content: string): string {
  return isolateVideoLinks(linkifyUrls(linkifyImages(content)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Largura da bolha ────────────────────────────────────────────────────────

/**
 * Blocos que não cabem em 75% de um painel de 380px: código, tabela, imagem e
 * vídeo. Quando a mensagem tem um deles, a bolha ocupa quase toda a largura.
 */
const WIDE_BLOCK_RE = /```|^\s{4,}\S|^\s*\|.*\|\s*$|!\[[^\]]*\]\(/m;

export function needsWideBubble(content: string): boolean {
  if (WIDE_BLOCK_RE.test(content)) return true;
  // Vídeo entra pelo link, que o WIDE_BLOCK_RE não pega.
  for (const match of content.matchAll(/\]\((\S+?)\)/g)) {
    if (isVideoUrl(match[1])) return true;
  }
  return false;
}

// ─── Agrupamento de mensagens ────────────────────────────────────────────────

/** Mensagens do mesmo autor dentro desta janela viram um bloco só. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface GroupableMessage {
  id: string;
  sender_type: "contact" | "agent" | "bot" | "system";
  ai_generated: boolean;
  created_at: string;
}

/** Quem "assina" a bolha — bot e agente são autores diferentes na mesma coluna. */
function authorOf(message: GroupableMessage): string {
  if (message.sender_type === "bot" || message.ai_generated) return "bot";
  return message.sender_type;
}

export interface MessagePosition {
  /** Primeira do bloco: mostra avatar e rótulo (IA / Suporte). */
  isFirstOfGroup: boolean;
  /** Última do bloco: mostra o horário. */
  isLastOfGroup: boolean;
  /** Primeira mensagem de um novo dia: pede separador de data. */
  startsNewDay: boolean;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Calcula, para cada mensagem, se ela abre/fecha um bloco e se começa um dia.
 * Mensagens de sistema quebram o bloco: elas aparecem centralizadas no meio.
 */
export function positionsFor(messages: GroupableMessage[]): MessagePosition[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const at = new Date(message.created_at);

    const startsNewDay = !previous || !sameDay(new Date(previous.created_at), at);

    const continuesFrom =
      !!previous &&
      !startsNewDay &&
      message.sender_type !== "system" &&
      previous.sender_type !== "system" &&
      authorOf(previous) === authorOf(message) &&
      at.getTime() - new Date(previous.created_at).getTime() < GROUP_WINDOW_MS;

    const continuesInto =
      !!next &&
      message.sender_type !== "system" &&
      next.sender_type !== "system" &&
      authorOf(next) === authorOf(message) &&
      sameDay(new Date(next.created_at), at) &&
      new Date(next.created_at).getTime() - at.getTime() < GROUP_WINDOW_MS;

    return {
      isFirstOfGroup: !continuesFrom,
      isLastOfGroup: !continuesInto,
      startsNewDay,
    };
  });
}

// ─── Datas ───────────────────────────────────────────────────────────────────

/** "Hoje", "Ontem" ou "12 de setembro" — separador entre os dias da conversa. */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
