/**
 * ArticleMarkdown.tsx — Renderização dos artigos da Central de Ajuda.
 *
 * Concentra a tipografia do artigo e os blocos ricos (código com botão de
 * copiar, callouts, tabelas, imagens). O conteúdo bruto passa antes pelo
 * normalizador de `@/lib/help-markdown`, que reconstrói a estrutura dos
 * artigos escritos em texto puro.
 */

import { Fragment, cloneElement, isValidElement, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import {
  AlertTriangle, CheckCircle2, XCircle, Info, Lightbulb,
  Check, Copy, ExternalLink, Link2, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { headingId } from "@/lib/help-markdown";
import { EMBED_ALLOW, parseVideoEmbed, type VideoEmbed as VideoEmbedData } from "@/lib/help-embeds";

// ─── Bloco de código ─────────────────────────────────────────────────────────

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Terminal",
  sh: "Terminal",
  shell: "Terminal",
  zsh: "Terminal",
  console: "Terminal",
  json: "JSON",
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
  sql: "SQL",
  python: "Python",
  py: "Python",
  env: ".env",
  html: "HTML",
  css: "CSS",
  text: "Código",
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const label = LANGUAGE_LABELS[language ?? ""] ?? (language || "Código");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard bloqueado (http, permissão negada): o usuário ainda pode
      // selecionar o texto manualmente — não vale quebrar a leitura por isso.
    }
  };

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-[#2a2d3e] bg-[#12141f]">
      <div className="flex items-center justify-between border-b border-[#2a2d3e] bg-[#0f1117] px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Código copiado" : "Copiar código"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
            copied
              ? "text-emerald-400"
              : "text-gray-400 hover:bg-white/5 hover:text-gray-200",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5">
        <code className="font-mono text-[13px] leading-relaxed text-[#e4e6f0]">
          {code}
        </code>
      </pre>
    </div>
  );
}

// ─── Vídeo ───────────────────────────────────────────────────────────────────

function VideoEmbed({ embed, title }: { embed: VideoEmbedData; title?: string }) {
  return (
    <figure className="mt-6 mb-8">
      <div className="overflow-hidden rounded-xl border border-border bg-[#0f1117]">
        <iframe
          src={embed.src}
          title={title || `Vídeo (${embed.provider})`}
          allow={EMBED_ALLOW}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="block aspect-video w-full border-0"
        />
      </div>
      {title && (
        <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Play className="h-3 w-3" />
          {title}
        </figcaption>
      )}
    </figure>
  );
}

/** Texto visível de um nó do hast — usado como legenda do vídeo. */
function hastText(node: Element): string {
  return node.children
    .map((child) =>
      child.type === "text" ? child.value : child.type === "element" ? hastText(child) : "",
    )
    .join("")
    .trim();
}

/**
 * O parágrafo é só um link de vídeo? Então ele vira player.
 *
 * Só conta quando o link está sozinho: um vídeo citado no meio de uma frase
 * continua sendo link, senão o texto ao redor ficaria órfão.
 */
function videoFromParagraph(node: Element | undefined): { embed: VideoEmbedData; title?: string } | null {
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
  // Autolink de URL crua: o texto é o próprio endereço, não serve de legenda.
  const title = text && text !== href ? text : undefined;
  return { embed, title };
}

// ─── Callouts ────────────────────────────────────────────────────────────────

interface CalloutStyle {
  icon: typeof AlertTriangle;
  wrapper: string;
  iconColor: string;
}

const CALLOUT_STYLES: Array<{ regex: RegExp; style: CalloutStyle }> = [
  {
    regex: /^(⚠️|❗|‼️|🚨)/u,
    style: {
      icon: AlertTriangle,
      wrapper: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
      iconColor: "text-amber-500",
    },
  },
  {
    regex: /^(🔴|❌)/u,
    style: {
      icon: XCircle,
      wrapper: "border-rose-500/40 bg-rose-500/10 text-rose-900 dark:text-rose-100",
      iconColor: "text-rose-500",
    },
  },
  {
    regex: /^(✅|🟢)/u,
    style: {
      icon: CheckCircle2,
      wrapper: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
      iconColor: "text-emerald-500",
    },
  },
  {
    regex: /^(💡|⭐)/u,
    style: {
      icon: Lightbulb,
      wrapper: "border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100",
      iconColor: "text-violet-500",
    },
  },
  {
    regex: /^(ℹ️|📌|👉)/u,
    style: {
      icon: Info,
      wrapper: "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100",
      iconColor: "text-sky-500",
    },
  },
];

/** Texto cru de um nó do ReactMarkdown — usado só para farejar o emoji guia. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props?.children);
  }
  return "";
}

/**
 * Remove o emoji-guia do começo do texto: ele já virou o ícone do callout, e
 * mostrar os dois deixa a caixa com cara de rascunho. Só a primeira ocorrência
 * com conteúdo é tocada — o resto da árvore passa intacto.
 */
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
      <blockquote className="my-5 border-l-[3px] border-primary/50 bg-muted/40 py-2.5 pl-4 pr-4 text-[15px] italic text-muted-foreground">
        {children}
      </blockquote>
    );
  }

  const Icon = match.style.icon;
  return (
    <div className={cn("my-5 flex items-start gap-3 rounded-xl border px-4 py-3.5", match.style.wrapper)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", match.style.iconColor)} />
      <div className="callout-body min-w-0 flex-1 text-[14px] leading-relaxed">
        {stripLeadingEmoji(children, match.regex)}
      </div>
    </div>
  );
}

// ─── Títulos com âncora ──────────────────────────────────────────────────────

function AnchoredHeading({
  level,
  children,
  seen,
}: {
  level: 2 | 3;
  children: ReactNode;
  seen: Map<string, number>;
}) {
  const text = textOf(children);
  const base = headingId(text);
  const count = seen.get(base) ?? 0;
  // O React chama o componente mais de uma vez em dev (StrictMode); por isso o
  // id só é registrado na primeira ocorrência de cada texto.
  if (!seen.has(base)) seen.set(base, count + 1);
  const id = count === 0 ? base : `${base}-${count}`;

  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={id}
      className={cn(
        "group scroll-mt-24 font-semibold text-foreground",
        level === 2
          ? "mt-10 mb-3 border-b border-border pb-2 text-[22px] leading-snug"
          : "mt-7 mb-2 text-[17px] leading-snug",
      )}
    >
      <a href={`#${id}`} className="inline-flex items-center gap-2 no-underline">
        {children}
        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    </Tag>
  );
}

// ─── Links ───────────────────────────────────────────────────────────────────

const INTERNAL_PREFIXES = ["/ajuda", "#"];

function ArticleLink({ href, children }: { href?: string; children: ReactNode }) {
  const target = href ?? "";
  const isAnchor = target.startsWith("#");
  const isInternal = INTERNAL_PREFIXES.some((p) => target.startsWith(p));

  const className =
    "font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary";

  if (isAnchor) return <a href={target} className={className}>{children}</a>;

  if (isInternal) {
    return <Link to={target} className={className}>{children}</Link>;
  }

  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className, "inline-flex items-baseline gap-1")}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0 self-center opacity-60" />
    </a>
  );
}

// ─── Componentes do ReactMarkdown ────────────────────────────────────────────

function buildComponents(): Components {
  // Um mapa por render: garante ids únicos para títulos repetidos.
  const seen = new Map<string, number>();

  return {
    h1: ({ children }) => (
      <h2 className="mt-10 mb-3 border-b border-border pb-2 text-[22px] font-semibold leading-snug text-foreground">
        {children}
      </h2>
    ),
    h2: ({ children }) => <AnchoredHeading level={2} seen={seen}>{children}</AnchoredHeading>,
    h3: ({ children }) => <AnchoredHeading level={3} seen={seen}>{children}</AnchoredHeading>,
    h4: ({ children }) => (
      <h4 className="mt-6 mb-2 text-[15px] font-semibold text-foreground">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-5 mb-1.5 text-sm font-semibold text-foreground">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-5 mb-1.5 text-sm font-semibold text-muted-foreground">{children}</h6>
    ),

    p: ({ node, children }) => {
      const video = videoFromParagraph(node);
      if (video) return <VideoEmbed embed={video.embed} title={video.title} />;
      return <p className="mb-4 text-[15.5px] leading-[1.75] text-foreground/90">{children}</p>;
    },
    a: ({ href, children }) => <ArticleLink href={href}>{children}</ArticleLink>,

    ul: ({ children }) => (
      <ul className="mb-5 ml-1 list-none space-y-2 text-[15.5px] leading-[1.7] text-foreground/90 [&_ul]:mt-2 [&_ul]:mb-0 [&_ol]:mt-2 [&_ol]:mb-0">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-5 ml-1 list-none space-y-3 text-[15.5px] leading-[1.7] text-foreground/90 [counter-reset:step] [&_ul]:mt-2 [&_ul]:mb-0 [&_ol]:mt-2 [&_ol]:mb-0">
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => {
      // `ordered` não existe em react-markdown v10: descobrimos o tipo da lista
      // pelo CSS do pai (ver .help-article em index.css).
      void props;
      return <li className="help-li relative pl-7">{children}</li>;
    },

    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

    code: ({ className, children, ...rest }) => {
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      const value = String(children ?? "").replace(/\n$/, "");

      // Bloco: react-markdown entrega <pre><code class="language-x">.
      if (language || value.includes("\n")) {
        return <CodeBlock code={value} language={language} />;
      }

      return (
        <code
          className="rounded-[5px] border border-border bg-muted px-[5px] py-[2px] font-mono text-[0.86em] text-foreground"
          {...rest}
        >
          {children}
        </code>
      );
    },
    // O <pre> some: o CodeBlock já traz o seu próprio.
    pre: ({ children }) => <>{children}</>,

    blockquote: ({ children }) => <Callout>{children}</Callout>,
    hr: () => <hr className="my-8 border-border" />,

    table: ({ children }) => (
      <div className="my-5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[14px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
      <th className="border-b border-border px-4 py-2.5 text-left font-semibold text-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="px-4 py-2.5 align-top text-foreground/90">{children}</td>,

    img: ({ src, alt }) =>
      typeof src === "string" ? (
        <a href={src} target="_blank" rel="noopener noreferrer" className="my-5 block">
          <img
            src={src}
            alt={alt ?? ""}
            loading="lazy"
            className="h-auto max-w-full rounded-xl border border-border transition-opacity hover:opacity-90"
          />
          {alt ? (
            <span className="mt-2 block text-center text-xs text-muted-foreground">{alt}</span>
          ) : null}
        </a>
      ) : null,

    input: ({ checked, type }) =>
      type === "checkbox" ? (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          className="mr-2 h-3.5 w-3.5 translate-y-[2px] accent-primary"
        />
      ) : null,
  };
}

// ─── Componente principal ────────────────────────────────────────────────────

export function ArticleMarkdown({ content }: { content: string }) {
  return (
    <div className="help-article min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents()}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
