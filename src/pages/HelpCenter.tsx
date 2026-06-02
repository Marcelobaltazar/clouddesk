/**
 * HelpCenter.tsx
 *
 * Central de ajuda pública — sem autenticação.
 *
 * Rotas:
 *   /ajuda              → <HelpCenterHome>  (listagem + busca)
 *   /ajuda/:articleId   → <HelpCenterArticle> (leitura de artigo)
 *
 * Dados: desk_knowledge_base WHERE is_published = true (RLS permite anon).
 * Artigos com source = 'intercom_internal' não são exibidos (internos).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronRight, ArrowLeft, BookOpen, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  title: string;
  content: string;
  category: string | null;
  source: string | null;
  source_id: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Gera slug legível a partir do título (URL-safe, lowercase, hifenizado). */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

/** Monta o path /ajuda/{source_id}-{slug} ou /ajuda/{id}-{slug} fallback. */
function articlePath(article: Article): string {
  const key = article.source_id ?? article.id;
  return `/ajuda/${key}-${slugify(article.title)}`;
}

/**
 * Extrai o id (source_id ou uuid) do param da rota.
 * Formato: "12345678-my-title" ou "abc123-my-title"
 * — pega tudo antes do primeiro hífen seguido de letra.
 */
function parseArticleId(param: string): string {
  // source_id numérico: "12292358-como-fazer..."  → "12292358"
  // uuid: "abc...xyz-titulo..." — pega os primeiros 36 chars se começar com uuid
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const uuidMatch = param.match(uuidRegex);
  if (uuidMatch) return uuidMatch[0];

  // numeric source_id
  const numMatch = param.match(/^(\d+)/);
  if (numMatch) return numMatch[1];

  // fallback: everything before the first word-char boundary preceded by a digit/letter then dash+letter
  const idx = param.search(/-[a-z]/);
  return idx > 0 ? param.slice(0, idx) : param;
}

/**
 * Rótulo de categoria para exibição.
 * 'intercom'      → usa category do artigo se preenchida, senão "Geral"
 * 'intercom_gap'  → "Problemas Comuns"
 * 'manual'        → "Outros"
 * outros          → "Geral"
 */
function categoryLabel(article: Article): string {
  if (article.source === "intercom_gap") return "Problemas Comuns";
  if (article.source === "manual") return "Outros";
  return article.category?.trim() || "Geral";
}

// ─── Markdown callout renderer ────────────────────────────────────────────────
// Blockquote com primeiro token ⚠️ → âmbar | 🔴 → vermelho | ✅ → verde

const CALLOUT_PATTERNS: Array<{
  regex: RegExp;
  icon: typeof AlertTriangle;
  bg: string;
  border: string;
  text: string;
  iconColor: string;
}> = [
  {
    regex: /^⚠️/,
    icon: AlertTriangle,
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-200",
    iconColor: "text-amber-400",
  },
  {
    regex: /^🔴/,
    icon: XCircle,
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    text: "text-rose-200",
    iconColor: "text-rose-400",
  },
  {
    regex: /^✅/,
    icon: CheckCircle2,
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    text: "text-emerald-200",
    iconColor: "text-emerald-400",
  },
];

function CalloutBlockquote({ children }: { children: React.ReactNode }) {
  // Extract raw text to detect the leading emoji
  const raw = String(
    (Array.isArray(children) ? children : [children])
      .map((c) => (typeof c === "string" ? c : ""))
      .join("")
  ).trimStart();

  const pattern = CALLOUT_PATTERNS.find((p) => p.regex.test(raw));

  if (!pattern) {
    return (
      <blockquote className="border-l-4 border-primary/40 pl-4 italic text-muted-foreground my-4">
        {children}
      </blockquote>
    );
  }

  const Icon = pattern.icon;
  return (
    <div
      className={cn(
        "flex gap-3 items-start rounded-lg border px-4 py-3 my-4",
        pattern.bg,
        pattern.border,
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", pattern.iconColor)} />
      <div className={cn("text-sm leading-relaxed", pattern.text)}>{children}</div>
    </div>
  );
}

function buildMarkdownComponents(isDark = true): Components {
  return {
    h1: ({ children }) => <h1 className="text-2xl font-bold text-foreground mt-8 mb-3">{children}</h1>,
    h2: ({ children }) => <h2 className="text-xl font-semibold text-foreground mt-7 mb-2 border-b border-border pb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-lg font-semibold text-foreground mt-5 mb-2">{children}</h3>,
    p:  ({ children }) => <p className="text-[15px] leading-relaxed text-foreground/90 mb-4">{children}</p>,
    a:  ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80">
        {children}
      </a>
    ),
    ul: ({ children }) => <ul className="list-disc ml-5 space-y-1.5 mb-4 text-[15px] text-foreground/90">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal ml-5 space-y-1.5 mb-4 text-[15px] text-foreground/90">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em:     ({ children }) => <em className="italic text-foreground/80">{children}</em>,
    code: ({ className, children, ...rest }) => {
      const isBlock = !!className;
      if (isBlock) {
        return (
          <code className={cn("block bg-muted rounded-lg p-4 text-sm font-mono overflow-x-auto text-foreground", className)} {...rest}>
            {children}
          </code>
        );
      }
      return <code className="bg-muted text-primary rounded px-1.5 py-0.5 text-[13px] font-mono" {...rest}>{children}</code>;
    },
    pre: ({ children }) => <pre className="mb-4 rounded-lg overflow-hidden">{children}</pre>,
    blockquote: ({ children }) => <CalloutBlockquote>{children}</CalloutBlockquote>,
    hr: () => <hr className="border-border my-6" />,
    table: ({ children }) => (
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border border-border bg-muted px-3 py-2 text-left font-semibold text-foreground">{children}</th>,
    td: ({ children }) => <td className="border border-border px-3 py-2 text-foreground/90">{children}</td>,
    img: ({ src, alt }) => (
      typeof src === "string"
        ? <img src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-lg my-4 border border-border" />
        : null
    ),
    // Special handling for 📚 Fonte: links — renders naturally via `a` + `p`
    // No special override needed; markdown parses them as paragraphs with links.
    ...(isDark ? {} : {}),
  };
}

// ─── Layout wrapper ───────────────────────────────────────────────────────────

function HelpCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
      <footer className="border-t border-border mt-16 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Cloudfy · Central de Ajuda
        </div>
      </footer>
    </div>
  );
}

// ─── PAGE: HelpCenterHome ─────────────────────────────────────────────────────

export function HelpCenterHome() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let req = supabase
      .from("desk_knowledge_base")
      .select("id, title, category, source, source_id, is_published, created_at, updated_at, content")
      .eq("is_published", true)
      .neq("source", "intercom_internal")
      .order("title");

    if (query.trim()) {
      req = req.or(`title.ilike.%${query.trim()}%,content.ilike.%${query.trim()}%`);
    }

    req.then(({ data, error }) => {
      if (error) console.error("[HelpCenter] fetch:", error.message);
      setArticles((data ?? []) as Article[]);
      setLoading(false);
    });
  }, [query]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of articles) {
      const cat = categoryLabel(a);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(a);
    }
    // Sort: "Geral" first, then alpha
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Geral") return -1;
      if (b === "Geral") return 1;
      return a.localeCompare(b, "pt-BR");
    });
  }, [articles]);

  return (
    <HelpCenterLayout>
      {/* ── Header ── */}
      <header
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1a1040 0%, #0f0820 40%, #0f1117 100%)" }}
      >
        {/* Decorative glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }} />
          <div className="absolute top-8 right-1/4 w-64 h-64 rounded-full opacity-15 blur-3xl"
            style={{ background: "radial-gradient(circle, #E8784A 0%, transparent 70%)" }} />
        </div>

        <div className="relative max-w-4xl mx-auto px-6 py-16 text-center">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #6366f1, #E8784A)" }}>
              <BookOpen className="h-4 w-4 text-white" />
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">Cloudfy</span>
            <span className="text-white/40 text-lg">·</span>
            <span className="text-white/60 text-sm">Central de Ajuda</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            Encontre o que está buscando
          </h1>
          <p className="text-white/50 text-sm mb-8">
            Documentação, tutoriais e soluções para sua infraestrutura Cloudfy
          </p>

          {/* Search */}
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              type="text"
              placeholder="Pesquisar artigos..."
              defaultValue={query}
              onChange={(e) => {
                const v = e.target.value;
                if (v.trim()) setSearchParams({ q: v });
                else setSearchParams({});
              }}
              className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/60 transition-all"
            />
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {query.trim() && (
          <div className="mb-8 flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {loading ? "Buscando..." : `${articles.length} resultado${articles.length !== 1 ? "s" : ""} para`}
            </p>
            {!loading && (
              <>
                <span className="text-sm font-medium text-foreground">"{query}"</span>
                <button
                  onClick={() => setSearchParams({})}
                  className="text-xs text-muted-foreground hover:text-foreground ml-2 underline underline-offset-2"
                >
                  Limpar
                </button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <CategorySkeleton />
        ) : articles.length === 0 ? (
          <EmptySearch query={query} />
        ) : query.trim() ? (
          // Flat list when searching
          <div className="space-y-2">
            {articles.map((a) => (
              <ArticleRow key={a.id} article={a} showCategory />
            ))}
          </div>
        ) : (
          // Grouped by category
          <div className="space-y-10">
            {grouped.map(([cat, arts]) => (
              <section key={cat}>
                <div className="flex items-center gap-2 mb-4">
                  <CategoryIcon category={cat} />
                  <h2 className="text-base font-semibold text-foreground">{cat}</h2>
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                    {arts.length} {arts.length === 1 ? "artigo" : "artigos"}
                  </span>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                  {arts.map((a) => (
                    <ArticleRow key={a.id} article={a} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </HelpCenterLayout>
  );
}

// ─── PAGE: HelpCenterArticle ──────────────────────────────────────────────────

export function HelpCenterArticle() {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const mdComponents = useMemo(() => buildMarkdownComponents(true), []);

  useEffect(() => {
    if (!articleId) { setNotFound(true); setLoading(false); return; }

    const rawId = parseArticleId(articleId);
    setLoading(true);
    setNotFound(false);
    setArticle(null);

    // Try by source_id first (numeric Intercom ID), then by UUID
    const isUuid = /^[0-9a-f]{8}-/i.test(rawId);

    const req = isUuid
      ? supabase.from("desk_knowledge_base")
          .select("*")
          .eq("id", rawId)
          .eq("is_published", true)
          .maybeSingle()
      : supabase.from("desk_knowledge_base")
          .select("*")
          .eq("source_id", rawId)
          .eq("is_published", true)
          .maybeSingle();

    req.then(({ data, error }) => {
      if (error) console.error("[HelpCenter] article fetch:", error.message);
      if (data) setArticle(data as Article);
      else setNotFound(true);
      setLoading(false);
    });
  }, [articleId]);

  if (loading) return (
    <HelpCenterLayout>
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-3/4 mt-6" />
        <Skeleton className="h-4 w-full mt-4" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </HelpCenterLayout>
  );

  if (notFound || !article) return (
    <HelpCenterLayout>
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
        <h1 className="text-xl font-semibold text-foreground mb-2">Artigo não encontrado</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Este artigo pode ter sido removido ou a URL está incorreta.
        </p>
        <Link to="/ajuda" className="text-sm text-primary underline underline-offset-2">
          Voltar para a Central de Ajuda
        </Link>
      </div>
    </HelpCenterLayout>
  );

  const cat = categoryLabel(article);

  return (
    <HelpCenterLayout>
      {/* ── Top bar ── */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </button>
          <span className="text-muted-foreground/40 text-xs">·</span>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <Link to="/ajuda" className="hover:text-foreground shrink-0">Central de Ajuda</Link>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="shrink-0">{cat}</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground truncate">{article.title}</span>
          </nav>
        </div>
      </div>

      {/* ── Content ── */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 leading-tight">
          {article.title}
        </h1>

        <article className="min-w-0">
          <ReactMarkdown components={mdComponents}>
            {article.content}
          </ReactMarkdown>
        </article>

        {/* ── Footer nav ── */}
        <div className="mt-12 pt-6 border-t border-border flex items-center justify-between">
          <Link
            to="/ajuda"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Todos os artigos
          </Link>
          <span className="text-xs text-muted-foreground">
            Última atualização:{" "}
            {new Date(article.updated_at).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "short", year: "numeric",
            })}
          </span>
        </div>
      </main>
    </HelpCenterLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ArticleRow({ article, showCategory }: { article: Article; showCategory?: boolean }) {
  return (
    <Link
      to={articlePath(article)}
      className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate block">
            {article.title}
          </span>
          {showCategory && (
            <span className="text-xs text-muted-foreground">{categoryLabel(article)}</span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 ml-3 transition-colors" />
    </Link>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  "Geral":            "bg-indigo-500/15 text-indigo-400",
  "Problemas Comuns": "bg-rose-500/15   text-rose-400",
  "Outros":           "bg-zinc-500/15   text-zinc-400",
};

function CategoryIcon({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-primary/15 text-primary";
  return (
    <div className={cn("h-6 w-6 rounded-md flex items-center justify-center shrink-0", cls)}>
      <BookOpen className="h-3.5 w-3.5" />
    </div>
  );
}

function CategorySkeleton() {
  return (
    <div className="space-y-10">
      {[5, 3, 4].map((n, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
            {Array.from({ length: n }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-4 w-4 rounded shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptySearch({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Search className="h-10 w-10 text-muted-foreground/30 mb-4" />
      <p className="text-sm font-medium text-foreground mb-1">
        Nenhum artigo encontrado para "{query}"
      </p>
      <p className="text-xs text-muted-foreground">
        Tente outras palavras-chave ou{" "}
        <Link to="/ajuda" className="text-primary underline underline-offset-2">
          veja todos os artigos
        </Link>
        .
      </p>
    </div>
  );
}
