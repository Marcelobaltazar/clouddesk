/**
 * WidgetMarkdown.tsx — Conteúdo rico dentro da bolha do chat.
 *
 * É o mesmo repertório da Central de Ajuda (código, tabela, imagem, vídeo,
 * callout), mas redesenhado para uma coluna de ~300px: tipografia menor,
 * espaçamento curto e blocos largos que "furam" o padding da bolha para usar
 * toda a largura disponível em vez de espremer.
 *
 * Só bolhas de IA e de operador passam por aqui. O texto do CLIENTE nunca é
 * interpretado como Markdown — ver ChatWidgetThread.
 */

import { Fragment, cloneElement, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Element } from "hast";
import {
  AlertTriangle, CheckCircle2, XCircle, Info, Lightbulb,
  Check, Copy, ExternalLink,
} from "lucide-react";
import { EMBED_ALLOW, parseVideoEmbed, type VideoEmbed } from "@/lib/help-embeds";
import { prepareRichMessage } from "./widget-message";

// ─── Utilidades de árvore ────────────────────────────────────────────────────

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function hastText(node: Element): string {
  return node.children
    .map((child) =>
      child.type === "text" ? child.value : child.type === "element" ? hastText(child) : "",
    )
    .join("")
    .trim();
}

// ─── Código ──────────────────────────────────────────────────────────────────

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Terminal", sh: "Terminal", shell: "Terminal", zsh: "Terminal", console: "Terminal",
  json: "JSON", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript",
  typescript: "TypeScript", yaml: "YAML", yml: "YAML", sql: "SQL",
  python: "Python", py: "Python", env: ".env", html: "HTML", css: "CSS", text: "Código",
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const label = LANGUAGE_LABELS[language ?? ""] ?? (language || "Código");

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    // -mx-3: fura o padding da bolha para o código usar a largura inteira.
    <div className="-mx-3 my-2 overflow-hidden border-y border-[#2a2d3e] bg-[#12141f]">
      <div className="flex items-center justify-between border-b border-[#2a2d3e] bg-[#0f1117] px-3 py-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Código copiado" : "Copiar código"}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
            copied ? "text-emerald-400" : "text-gray-400 hover:bg-white/10 hover:text-gray-200"
          }`}
        >
          {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 scrollbar-thin">
        <code className="font-mono text-[11.5px] leading-[1.6] text-[#e4e6f0]">{code}</code>
      </pre>
    </div>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Site host em http ou sem permissão: cai no método antigo.
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(field);
    return ok;
  }
}

// ─── Link ────────────────────────────────────────────────────────────────────

/**
 * Endereço como ele aparece na bolha: sem o protocolo, que só ocupa espaço.
 * O corte em si fica com o CSS (`truncate`), que conhece a largura real — um
 * limite fixo de caracteres erra em telas diferentes e deixava a URL quebrando
 * no meio ("...cloudfy.clo" / "ud/ajuda"). O href, o title e o que vai para a
 * área de transferência continuam completos.
 */
function prettyUrl(href: string): string {
  return href.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/**
 * Link da conversa. Quando o texto do link É o próprio endereço (caso das URLs
 * cruas que a IA manda — 2ª via de fatura, convite de comunidade), ele aparece
 * encurtado e ganha um botão de copiar: no widget o cliente costuma querer
 * levar o link embora. Link com rótulo escrito não ganha o botão, que só
 * viraria ruído.
 */
function MessageLink({ href, children }: { href: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const label = textOf(children).trim();
  const isBareUrl = label === href || label === href.replace(/^https?:\/\//, "");

  const copy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (await copyText(href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <span className="inline-flex max-w-full items-baseline gap-1">
      {/* Cor herdada da bolha: a bolha da IA muda de fundo entre os temas
          (azul claro / roxo), e um link de cor fixa some num dos dois. O
          sublinhado e o ícone é que sinalizam o link. */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={isBareUrl ? href : undefined}
        className={`min-w-0 font-medium underline decoration-1 underline-offset-2 opacity-90 transition-opacity hover:opacity-100 ${
          isBareUrl ? "inline-block max-w-full truncate align-bottom" : "break-words"
        }`}
      >
        {isBareUrl ? prettyUrl(href) : children}
        {!isBareUrl && <ExternalLink className="ml-0.5 inline h-2.5 w-2.5 shrink-0 align-baseline opacity-60" />}
      </a>
      {isBareUrl && (
        <button
          type="button"
          onClick={copy}
          title={copied ? "Copiado!" : "Copiar link"}
          aria-label={copied ? "Link copiado" : "Copiar link"}
          className="inline-flex shrink-0 items-center justify-center self-center rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
        >
          {copied
            ? <Check className="h-3 w-3 text-emerald-500" />
            : <Copy className="h-3 w-3" />}
        </button>
      )}
    </span>
  );
}

// ─── Vídeo ───────────────────────────────────────────────────────────────────

function VideoPlayer({ embed, title }: { embed: VideoEmbed; title?: string }) {
  return (
    <figure className="-mx-3 my-2">
      <iframe
        src={embed.src}
        title={title || `Vídeo (${embed.provider})`}
        allow={EMBED_ALLOW}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        className="block aspect-video w-full border-y border-black/10"
      />
      {title && (
        <figcaption className="px-3 pt-1 text-[10.5px] opacity-70">{title}</figcaption>
      )}
    </figure>
  );
}

/** Parágrafo que é só um link de vídeo vira player. */
function videoFromParagraph(node: Element | undefined): { embed: VideoEmbed; title?: string } | null {
  if (!node) return null;

  const meaningful = node.children.filter(
    (child) => !(child.type === "text" && child.value.trim() === ""),
  );
  if (meaningful.length !== 1) return null;

  const only = meaningful[0];
  if (only.type !== "element" || only.tagName !== "a") return null;

  const href = only.properties?.href;
  const embed = parseVideoEmbed(typeof href === "string" ? href : null);
  if (!embed) return null;

  const text = hastText(only);
  return { embed, title: text && text !== href ? text : undefined };
}

// ─── Callouts ────────────────────────────────────────────────────────────────

const CALLOUT_STYLES: Array<{ regex: RegExp; icon: typeof Info; wrapper: string; color: string }> = [
  { regex: /^(⚠️|❗|‼️|🚨)/u, icon: AlertTriangle, wrapper: "border-amber-500/40 bg-amber-500/10", color: "text-amber-500" },
  { regex: /^(🔴|❌)/u, icon: XCircle, wrapper: "border-rose-500/40 bg-rose-500/10", color: "text-rose-500" },
  { regex: /^(✅|🟢)/u, icon: CheckCircle2, wrapper: "border-emerald-500/40 bg-emerald-500/10", color: "text-emerald-500" },
  { regex: /^(💡|⭐)/u, icon: Lightbulb, wrapper: "border-violet-500/40 bg-violet-500/10", color: "text-violet-500" },
  { regex: /^(ℹ️|📌|👉)/u, icon: Info, wrapper: "border-sky-500/40 bg-sky-500/10", color: "text-sky-500" },
];

/** O emoji já virou ícone — mostrar os dois deixa a caixa poluída. */
function stripLeadingEmoji(node: ReactNode, regex: RegExp): ReactNode {
  if (typeof node === "string") return node.replace(regex, "").replace(/^\s+/, "");

  if (Array.isArray(node)) {
    let stripped = false;
    return node.map((child, index) => {
      if (stripped || !textOf(child).trim()) return child;
      stripped = true;
      return <Fragment key={index}>{stripLeadingEmoji(child, regex)}</Fragment>;
    });
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return cloneElement(node, undefined, stripLeadingEmoji(node.props.children, regex));
  }
  return node;
}

function Callout({ children }: { children: ReactNode }) {
  const raw = textOf(children).trimStart();
  const match = CALLOUT_STYLES.find((c) => c.regex.test(raw));

  if (!match) {
    return (
      <blockquote className="my-2 border-l-2 pl-2.5 text-[13px] opacity-80 [border-color:color-mix(in_srgb,currentColor_35%,transparent)]">
        {children}
      </blockquote>
    );
  }

  const Icon = match.icon;
  return (
    <div className={`my-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 ${match.wrapper}`}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${match.color}`} />
      <div className="widget-callout min-w-0 flex-1 text-[12.5px] leading-[1.55]">
        {stripLeadingEmoji(children, match.regex)}
      </div>
    </div>
  );
}

// ─── Componentes do ReactMarkdown ────────────────────────────────────────────

const heading = (size: string) =>
  ({ children }: { children?: ReactNode }) => (
    <strong className={`mb-1 mt-3 block ${size} font-semibold leading-snug text-foreground first:mt-0`}>
      {children}
    </strong>
  );

const COMPONENTS: Components = {
  // Em bolha de chat não existe hierarquia de documento: todo título vira um
  // rótulo em negrito, só variando o tamanho.
  h1: heading("text-[14.5px]"),
  h2: heading("text-[14px]"),
  h3: heading("text-[13.5px]"),
  h4: heading("text-[13px]"),
  h5: heading("text-[13px]"),
  h6: heading("text-[13px]"),

  p: ({ node, children }) => {
    const video = videoFromParagraph(node);
    if (video) return <VideoPlayer embed={video.embed} title={video.title} />;
    return <p className="mb-2 last:mb-0">{children}</p>;
  },

  a: ({ href, children }) =>
    typeof href === "string"
      ? <MessageLink href={href}>{children}</MessageLink>
      : <span>{children}</span>,

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-60 line-through">{children}</del>,

  ul: ({ children }) => (
    <ul className="mb-2 list-none space-y-1 last:mb-0 [&_ul]:mb-0 [&_ul]:mt-1 [&_ol]:mb-0 [&_ol]:mt-1">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-none space-y-1.5 last:mb-0 [&_ul]:mb-0 [&_ul]:mt-1 [&_ol]:mb-0 [&_ol]:mt-1">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="widget-li relative pl-5">{children}</li>,

  code: ({ className, children, ...rest }) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const value = String(children ?? "").replace(/\n$/, "");

    if (language || value.includes("\n")) {
      return <CodeBlock code={value} language={language} />;
    }
    return (
      <code className="rounded px-1 py-px font-mono text-[11.5px] [background-color:color-mix(in_srgb,currentColor_12%,transparent)]" {...rest}>
        {children}
      </code>
    );
  },
  // O CodeBlock já traz o seu próprio <pre>.
  pre: ({ children }) => <>{children}</>,

  blockquote: ({ children }) => <Callout>{children}</Callout>,
  hr: () => <hr className="my-2.5 [border-color:color-mix(in_srgb,currentColor_18%,transparent)]" />,

  table: ({ children }) => (
    <div className="-mx-3 my-2 overflow-x-auto px-3 scrollbar-thin">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="[background-color:color-mix(in_srgb,currentColor_7%,transparent)]">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y [&>tr]:[border-color:color-mix(in_srgb,currentColor_15%,transparent)]">{children}</tbody>,
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b px-2 py-1 text-left font-semibold [border-color:color-mix(in_srgb,currentColor_20%,transparent)]">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,

  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="-mx-3 my-2 block">
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          // object-contain: print de erro não pode ser cortado.
          className="max-h-64 w-full border-y border-black/10 bg-black/5 object-contain transition-opacity hover:opacity-90"
        />
      </a>
    ) : null,

  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={!!checked} readOnly className="mr-1.5 h-3 w-3 translate-y-px accent-primary" />
    ) : null,
};

export function WidgetMarkdown({ content }: { content: string }) {
  return (
    <div className="widget-md min-w-0 text-[13.5px] leading-[1.6] [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {prepareRichMessage(content)}
      </ReactMarkdown>
    </div>
  );
}
