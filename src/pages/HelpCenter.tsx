/**
 * HelpCenter.tsx — Central de ajuda pública (sem autenticação).
 *
 * Rotas:
 *   /ajuda                → <HelpCenterHome>    (home com categorias)
 *   /ajuda/:articleId     → <HelpCenterArticle> (artigo)
 *
 * Categorias: classificadas por palavra-chave no título/source.
 * Dados: desk_knowledge_base WHERE is_published = true.
 * Artigos source='intercom_internal' nunca são exibidos.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ArticleMarkdown } from "@/components/help/ArticleMarkdown";
import {
  Search, ChevronRight, ChevronLeft, ArrowLeft, BookOpen,
  HelpCircle, RefreshCw, Wrench, CreditCard, Clock, List,
  Zap, MessageCircle, Server, LayoutGrid, FileText, Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeArticleMarkdown,
  readingTimeMinutes,
  extractToc,
  type TocEntry,
} from "@/lib/help-markdown";

const SITE_NAME = "Central de Ajuda Cloudfy";

/** Mantém o título da aba coerente com a página aberta. */
function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    return () => { document.title = "CloudDesk — Suporte Cloudfy"; };
  }, [title]);
}

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

// ─── Categoria config ─────────────────────────────────────────────────────────

interface CategoryDef {
  key: string;
  label: string;
  description: string;
  icon: typeof BookOpen;
  iconBg: string;       // Tailwind bg class
  iconText: string;     // Tailwind text class
  keywords: string[];   // testados contra título normalizado
  order: number;        // ordem na home (menor = primeiro)
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "primeiros-passos",
    label: "Dúvidas Gerais",
    description: "Entendendo o básico e dando os primeiros passos com sua infraestrutura.",
    icon: HelpCircle,
    iconBg: "bg-indigo-500",
    iconText: "text-white",
    keywords: [
      "console", "primeiro acesso", "comec", "configur", "credencial",
      "cloudfy", "acesso", "conta", "painel", "o que e", "o que é",
      "como usar", "como funciona", "duvida", "dúvida", "geral",
      "plataforma", "servico", "serviço",
    ],
    order: 1,
  },
  {
    key: "n8n",
    label: "n8n",
    description: "Automações, workflows, execuções e integrações com o n8n.",
    icon: Zap,
    iconBg: "bg-orange-500",
    iconText: "text-white",
    keywords: [
      "n8n", "workflow", "execucao", "execução", "fluxo", "automacao",
      "automação", "node", "webhook", "trigger", "schedule",
    ],
    order: 2,
  },
  {
    key: "evolution",
    label: "Evolution API / WhatsApp",
    description: "Conecte seu número, configure instâncias e resolva problemas de WhatsApp.",
    icon: MessageCircle,
    iconBg: "bg-emerald-500",
    iconText: "text-white",
    keywords: [
      "evolution", "whatsapp", "instancia", "instância", "qr code",
      "qrcode", "numero", "número", "conectar", "chatwoot",
    ],
    order: 3,
  },
  {
    key: "infraestrutura",
    label: "Infraestrutura",
    description: "Deploy, servidores, domínios, subdomínios, Redis e PostgreSQL.",
    icon: Server,
    iconBg: "bg-violet-500",
    iconText: "text-white",
    keywords: [
      "infra", "deploy", "servidor", "subdominio", "subdomínio",
      "dominio", "domínio", "redis", "postgres", "postgresql",
      "banco de dados", "database", "ssl", "certificado", "dns",
      "502", "503", "504", "timeout", "offline", "fora do ar",
    ],
    order: 4,
  },
  {
    key: "atualizacoes",
    label: "Atualização e Versões",
    description: "Detalhes sobre como o n8n e outros serviços são atualizados na Cloudfy.",
    icon: RefreshCw,
    iconBg: "bg-sky-500",
    iconText: "text-white",
    keywords: [
      "atualiz", "versao", "versão", "update", "upgrade de versao",
      "upgrade de versão", "nova versao", "nova versão",
    ],
    order: 5,
  },
  {
    key: "conta-assinaturas",
    label: "Conta e Assinaturas",
    description: "Gerencia sua conta, pagamentos, cobranças e upgrades de plano.",
    icon: CreditCard,
    iconBg: "bg-pink-500",
    iconText: "text-white",
    keywords: [
      "plano", "assinatura", "cobranca", "cobrança", "cancelar",
      "cancelamento", "upgrade", "downgrade", "pagamento", "fatura",
      "reembolso", "estorno", "invoice", "stripe",
    ],
    order: 6,
  },
  {
    key: "problemas-comuns",
    label: "Problemas Comuns",
    description: "Soluções rápidas para falhas, erros e situações frequentes.",
    icon: Wrench,
    iconBg: "bg-rose-500",
    iconText: "text-white",
    keywords: [], // pegado por source='intercom_gap' OU source='manual' + "Comuns" no category
    order: 7,
  },
  {
    key: "outros",
    label: "Outros",
    description: "Artigos que não se encaixam em outras categorias.",
    icon: LayoutGrid,
    iconBg: "bg-zinc-600",
    iconText: "text-white",
    keywords: [],
    order: 99,
  },
];

const CAT_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
);

// ─── Classificação por palavra-chave ─────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
}

/** Retorna o key de categoria de um artigo. */
function classifyArticle(article: Article): string {
  // Fonte 'intercom_gap' ou category contém "Comuns" → Problemas Comuns
  if (
    article.source === "intercom_gap" ||
    article.category?.toLowerCase().includes("comun")
  ) {
    return "problemas-comuns";
  }

  const haystack = normalize(article.title + " " + (article.category ?? ""));

  // Ordem importa: temas mais específicos primeiro
  const order: CategoryDef["key"][] = [
    "evolution",
    "n8n",
    "atualizacoes",
    "conta-assinaturas",
    "infraestrutura",
    "primeiros-passos",
  ];

  for (const key of order) {
    const def = CAT_BY_KEY[key];
    if (def.keywords.some((kw) => haystack.includes(normalize(kw)))) {
      return key;
    }
  }

  return "outros";
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

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

function articlePath(article: Article): string {
  const key = article.source_id ?? article.id;
  return `/ajuda/${key}-${slugify(article.title)}`;
}

function parseArticleId(param: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const uuidMatch = param.match(uuidRegex);
  if (uuidMatch) return uuidMatch[0];
  const numMatch = param.match(/^(\d+)/);
  if (numMatch) return numMatch[1];
  const idx = param.search(/-[a-z]/);
  return idx > 0 ? param.slice(0, idx) : param;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const BRAND_GRADIENT = "linear-gradient(135deg, #6366f1, #a855f7, #E8784A)";

function HelpCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex-1">{children}</div>

      <footer className="mt-20 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <Link to="/ajuda" className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ background: BRAND_GRADIENT }}
            >
              <BookOpen className="h-3 w-3 text-white" />
            </span>
            <span className="text-sm font-semibold text-foreground">Central de Ajuda</span>
          </Link>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Não encontrou o que procurava? Fale com o suporte pelo chat da sua conta Cloudfy.
            <span className="mx-2 hidden text-muted-foreground/40 sm:inline">·</span>
            <span className="block sm:inline">© {new Date().getFullYear()} Cloudfy</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function HelpCenterHeader({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (v: string) => void;
}) {
  return (
    <header
      className="relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #1a1040 0%, #0f0820 40%, #0f1117 100%)" }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }} />
        <div className="absolute top-8 right-1/4 w-64 h-64 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #E8784A 0%, transparent 70%)" }} />
      </div>

      <div className="relative max-w-5xl mx-auto px-6 py-16 text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center"
            style={{ background: BRAND_GRADIENT }}>
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

        <div className="relative max-w-xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            type="text"
            placeholder="Pesquisar artigos..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/60 transition-all"
          />
        </div>
      </div>
    </header>
  );
}

// ─── PAGE: HelpCenterHome ─────────────────────────────────────────────────────

export function HelpCenterHome() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query   = searchParams.get("q") ?? "";
  const catKey  = searchParams.get("cat") ?? "";

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading]   = useState(true);

  usePageTitle(null);

  // Load all published articles once (category filtering is client-side)
  useEffect(() => {
    setLoading(true);
    supabase
      .from("desk_knowledge_base")
      .select("id, title, category, source, source_id, is_published, created_at, updated_at, content")
      .eq("is_published", true)
      .neq("source", "intercom_internal")
      .order("title")
      .then(({ data, error }) => {
        if (error) console.error("[HelpCenter] fetch:", error.message);
        setArticles((data ?? []) as Article[]);
        setLoading(false);
      });
  }, []);

  // Classify articles
  const classified = useMemo(
    () => articles.map((a) => ({ ...a, _cat: classifyArticle(a) })),
    [articles],
  );

  // Search filter (title + content)
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = normalize(query);
    return classified.filter(
      (a) => normalize(a.title).includes(q) || normalize(a.content).includes(q),
    );
  }, [classified, query]);

  // Category filter
  const catArticles = useMemo(() => {
    if (!catKey) return [];
    return classified.filter((a) => a._cat === catKey);
  }, [classified, catKey]);

  // Groups for home grid
  const groups = useMemo(() => {
    const map = new Map<string, typeof classified>();
    for (const a of classified) {
      if (!map.has(a._cat)) map.set(a._cat, []);
      map.get(a._cat)!.push(a);
    }
    return CATEGORIES
      .filter((c) => map.has(c.key))
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ def: c, articles: map.get(c.key)! }));
  }, [classified]);

  const activeCat = catKey ? CAT_BY_KEY[catKey] : null;

  const setQuery = (v: string) => {
    const p: Record<string, string> = {};
    if (v.trim()) p.q = v;
    if (catKey) p.cat = catKey;
    setSearchParams(p);
  };

  const clearCat = () => {
    const p: Record<string, string> = {};
    if (query.trim()) p.q = query;
    setSearchParams(p);
  };

  return (
    <HelpCenterLayout>
      <HelpCenterHeader query={query} onQueryChange={setQuery} />

      <main className="max-w-5xl mx-auto px-6 py-12">

        {/* ── Search results ── */}
        {query.trim() ? (
          <>
            <div className="mb-6 flex items-center gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {loading ? "Buscando..." : `${searchResults.length} resultado${searchResults.length !== 1 ? "s" : ""} para`}
              </p>
              {!loading && (
                <>
                  <span className="text-sm font-medium text-foreground">"{query}"</span>
                  <button
                    onClick={() => setSearchParams(catKey ? { cat: catKey } : {})}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Limpar busca
                  </button>
                </>
              )}
            </div>

            {loading ? <ListSkeleton /> : searchResults.length === 0 ? (
              <EmptySearch query={query} />
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {searchResults.map((a) => (
                  <ArticleRow key={a.id} article={a} catKey={a._cat} showCategory showExcerpt />
                ))}
              </div>
            )}
          </>
        ) : catKey && activeCat ? (
          /* ── Category drill-down ── */
          <>
            <div className="flex items-center gap-3 mb-8">
              <button
                onClick={clearCat}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Todas as categorias
              </button>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
              <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", activeCat.iconBg)}>
                <activeCat.icon className={cn("h-4 w-4", activeCat.iconText)} />
              </div>
              <h2 className="text-base font-semibold text-foreground">{activeCat.label}</h2>
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {catArticles.length} artigos
              </span>
            </div>

            {loading ? <ListSkeleton /> : (
              <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {catArticles.map((a) => (
                  <ArticleRow key={a.id} article={a} catKey={a._cat} />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Home: category cards ── */
          loading ? (
            <CategoryCardsSkeleton />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {groups.map(({ def, articles: arts }) => (
                <CategoryCard
                  key={def.key}
                  def={def}
                  count={arts.length}
                  onClick={() => setSearchParams({ cat: def.key })}
                />
              ))}
            </div>
          )
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
  const [related, setRelated] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  usePageTitle(article?.title ?? null);

  useEffect(() => {
    if (!articleId) { setNotFound(true); setLoading(false); return; }

    const rawId = parseArticleId(articleId);
    setLoading(true);
    setNotFound(false);
    setArticle(null);
    setRelated([]);
    window.scrollTo({ top: 0 });

    const isUuid = /^[0-9a-f]{8}-/i.test(rawId);
    const req = isUuid
      ? supabase.from("desk_knowledge_base").select("*").eq("id", rawId).eq("is_published", true).maybeSingle()
      : supabase.from("desk_knowledge_base").select("*").eq("source_id", rawId).eq("is_published", true).maybeSingle();

    req.then(({ data, error }) => {
      if (error) console.error("[HelpCenter] article fetch:", error.message);
      if (data) setArticle(data as Article);
      else setNotFound(true);
      setLoading(false);
    });
  }, [articleId]);

  // Artigos da mesma categoria, para o rodapé "Continue lendo".
  useEffect(() => {
    if (!article) return;
    const key = classifyArticle(article);

    supabase
      .from("desk_knowledge_base")
      .select("id, title, category, source, source_id, is_published, created_at, updated_at, content")
      .eq("is_published", true)
      .neq("source", "intercom_internal")
      .neq("id", article.id)
      .limit(120)
      .then(({ data, error }) => {
        if (error) { console.error("[HelpCenter] related fetch:", error.message); return; }
        const same = (data ?? []).filter((a) => classifyArticle(a as Article) === key);
        setRelated(same.slice(0, 4) as Article[]);
      });
  }, [article]);

  if (loading) return (
    <HelpCenterLayout>
      <ArticleSkeleton />
    </HelpCenterLayout>
  );

  if (notFound || !article) return (
    <HelpCenterLayout>
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <BookOpen className="mx-auto mb-4 h-12 w-12 opacity-20" />
        <h1 className="mb-2 text-xl font-semibold">Artigo não encontrado</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Este artigo pode ter sido removido ou a URL está incorreta.
        </p>
        <Link
          to="/ajuda"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Home className="h-3.5 w-3.5" />
          Voltar para a Central de Ajuda
        </Link>
      </div>
    </HelpCenterLayout>
  );

  const catKey = classifyArticle(article);
  const catDef = CAT_BY_KEY[catKey];
  const markdown = normalizeArticleMarkdown(article.content, article.title);
  const toc = extractToc(markdown);
  const minutes = readingTimeMinutes(markdown);

  return (
    <HelpCenterLayout>
      <ArticleTopBar article={article} catKey={catKey} catDef={catDef} onBack={() => navigate(-1)} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex gap-12">
          {/* ── Coluna do artigo ── */}
          <div className="min-w-0 flex-1 lg:max-w-3xl">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              {catDef && <CategoryPill catKey={catKey} def={catDef} />}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {minutes} min de leitura
              </span>
            </div>

            <h1 className="mb-3 text-[28px] font-bold leading-tight text-foreground sm:text-[34px]">
              {article.title}
            </h1>

            <p className="mb-8 border-b border-border pb-6 text-xs text-muted-foreground">
              Atualizado em{" "}
              {new Date(article.updated_at).toLocaleDateString("pt-BR", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>

            {markdown ? (
              <ArticleMarkdown content={markdown} />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Este artigo ainda não tem conteúdo publicado.
              </p>
            )}

            <ArticleFeedback articleId={article.id} />

            {related.length > 0 && <RelatedArticles articles={related} />}

            <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
              <Link
                to={`/ajuda?cat=${catKey}`}
                className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                {catDef?.label ?? "Todos os artigos"}
              </Link>
              <Link
                to="/ajuda"
                className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Home className="h-3.5 w-3.5" />
                Central de Ajuda
              </Link>
            </div>
          </div>

          {/* ── Índice lateral ── */}
          {toc.length > 1 && (
            <aside className="hidden w-56 shrink-0 lg:block">
              <TableOfContents entries={toc} />
            </aside>
          )}
        </div>
      </main>
    </HelpCenterLayout>
  );
}

function ArticleTopBar({
  article, catKey, catDef, onBack,
}: {
  article: Article;
  catKey: string;
  catDef?: CategoryDef;
  onBack: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex min-w-0 max-w-6xl items-center gap-2 px-6 py-3">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
        <span className="shrink-0 text-xs text-muted-foreground/30">·</span>
        <nav aria-label="Trilha de navegação" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link to="/ajuda" className="shrink-0 transition-colors hover:text-foreground">
            Central de Ajuda
          </Link>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <Link
            to={`/ajuda?cat=${catKey}`}
            className="flex shrink-0 items-center gap-1 transition-colors hover:text-foreground"
          >
            {catDef && (
              <span className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded", catDef.iconBg)}>
                <catDef.icon className="h-2.5 w-2.5 text-white" />
              </span>
            )}
            {catDef?.label ?? "Geral"}
          </Link>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="truncate text-foreground">{article.title}</span>
        </nav>
      </div>
    </div>
  );
}

function CategoryPill({ catKey, def }: { catKey: string; def: CategoryDef }) {
  return (
    <Link
      to={`/ajuda?cat=${catKey}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/40"
    >
      <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded", def.iconBg)}>
        <def.icon className="h-2.5 w-2.5 text-white" />
      </span>
      <span className="text-foreground/80">{def.label}</span>
    </Link>
  );
}

/** Índice lateral: acompanha a rolagem e destaca a seção visível. */
function TableOfContents({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>(entries[0]?.id ?? "");

  useEffect(() => {
    const headings = entries
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [entries]);

  return (
    <nav aria-label="Índice do artigo" className="sticky top-24">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <List className="h-3 w-3" />
        Nesta página
      </p>
      <ul className="space-y-1 border-l border-border">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className={cn(
                "-ml-px block border-l-2 py-1 text-[13px] leading-snug transition-colors",
                entry.level === 3 ? "pl-6" : "pl-3",
                activeId === entry.id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Voto simples de utilidade — guardado no navegador do leitor. */
function ArticleFeedback({ articleId }: { articleId: string }) {
  const storageKey = `clouddesk:help-feedback:${articleId}`;
  const [vote, setVote] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setVote(saved === "yes" || saved === "no" ? saved : null);
    } catch {
      // localStorage indisponível (janela anônima): o voto só não fica salvo.
    }
  }, [storageKey]);

  const send = (value: "yes" | "no") => {
    setVote(value);
    try { localStorage.setItem(storageKey, value); } catch { /* ver acima */ }
  };

  return (
    <div className="mt-12 rounded-xl border border-border bg-card px-5 py-4">
      {vote ? (
        <p className="text-sm text-muted-foreground">
          {vote === "yes"
            ? "Obrigado pelo retorno! Ficamos felizes em ajudar."
            : "Obrigado pelo retorno. Se ainda precisar de ajuda, fale com o suporte pelo chat da sua conta Cloudfy."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Este artigo resolveu sua dúvida?</p>
          <div className="flex gap-2">
            <button
              onClick={() => send("yes")}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10"
            >
              👍 Sim
            </button>
            <button
              onClick={() => send("no")}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-rose-500/50 hover:bg-rose-500/10"
            >
              👎 Não
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RelatedArticles({ articles }: { articles: Article[] }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Continue lendo</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {articles.map((a) => (
          <Link
            key={a.id}
            to={articlePath(a)}
            className="group flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm leading-snug text-foreground transition-colors group-hover:text-primary">
              {a.title}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ArticleSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-6 h-9 w-3/4" />
      <Skeleton className="h-3 w-40" />
      <div className="space-y-3 pt-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className={cn("h-4", i % 3 === 0 ? "w-2/3" : "w-full")} />
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryCard({
  def,
  count,
  onClick,
}: {
  def: CategoryDef;
  count: number;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card p-5 flex items-start gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all group"
    >
      <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0", def.iconBg)}>
        <Icon className={cn("h-6 w-6", def.iconText)} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors mb-1">
          {def.label}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
          {def.description}
        </p>
        <span className="text-[11px] text-muted-foreground">
          {count} {count === 1 ? "artigo" : "artigos"}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
    </button>
  );
}

/** Primeiras linhas do artigo em texto corrido, sem marcação de Markdown. */
function excerptOf(content: string, max = 150): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function ArticleRow({
  article,
  catKey,
  showCategory,
  showExcerpt,
}: {
  article: Article;
  catKey: string;
  showCategory?: boolean;
  showExcerpt?: boolean;
}) {
  const catDef = CAT_BY_KEY[catKey];
  const Icon = catDef?.icon ?? BookOpen;
  const excerpt = showExcerpt ? excerptOf(article.content ?? "") : "";

  return (
    <Link
      to={articlePath(article)}
      className="group flex items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <span className="block text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
            {article.title}
          </span>
          {excerpt && (
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {excerpt}
            </span>
          )}
          {showCategory && catDef && (
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn("inline-flex h-3 w-3 items-center justify-center rounded-sm", catDef.iconBg)}>
                <catDef.icon className="h-2 w-2 text-white" />
              </span>
              {catDef.label}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </Link>
  );
}

function CategoryCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-4 w-4 rounded shrink-0" />
          <Skeleton className="h-4 flex-1" />
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
          veja todas as categorias
        </Link>
        .
      </p>
    </div>
  );
}
