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
import ReactMarkdown, { type Components } from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, ChevronRight, ArrowLeft, BookOpen,
  AlertTriangle, CheckCircle2, XCircle,
  HelpCircle, RefreshCw, Wrench, CreditCard,
  Zap, MessageCircle, Server, LayoutGrid,
} from "lucide-react";
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

// ─── Markdown callouts ────────────────────────────────────────────────────────

const CALLOUT_PATTERNS: Array<{
  regex: RegExp;
  icon: typeof AlertTriangle;
  bg: string; border: string; text: string; iconColor: string;
}> = [
  { regex: /^⚠️/, icon: AlertTriangle,  bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-200",   iconColor: "text-amber-400" },
  { regex: /^🔴/, icon: XCircle,        bg: "bg-rose-500/10",    border: "border-rose-500/40",    text: "text-rose-200",    iconColor: "text-rose-400"  },
  { regex: /^✅/, icon: CheckCircle2,   bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-200", iconColor: "text-emerald-400"},
];

function CalloutBlockquote({ children }: { children: React.ReactNode }) {
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
    <div className={cn("flex gap-3 items-start rounded-lg border px-4 py-3 my-4", pattern.bg, pattern.border)}>
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", pattern.iconColor)} />
      <div className={cn("text-sm leading-relaxed", pattern.text)}>{children}</div>
    </div>
  );
}

const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-foreground mt-8 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold text-foreground mt-7 mb-2 border-b border-border pb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-foreground mt-5 mb-2">{children}</h3>,
  p:  ({ children }) => <p className="text-[15px] leading-relaxed text-foreground/90 mb-4">{children}</p>,
  a:  ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-primary underline underline-offset-2 hover:text-primary/80">{children}</a>
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
  pre:        ({ children }) => <pre className="mb-4 rounded-lg overflow-hidden">{children}</pre>,
  blockquote: ({ children }) => <CalloutBlockquote>{children}</CalloutBlockquote>,
  hr:         () => <hr className="border-border my-6" />,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-muted px-3 py-2 text-left font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="border border-border px-3 py-2 text-foreground/90">{children}</td>,
  img: ({ src, alt }) =>
    typeof src === "string"
      ? <img src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-lg my-4 border border-border" />
      : null,
};

// ─── Layout ───────────────────────────────────────────────────────────────────

function HelpCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
      <footer className="border-t border-border mt-16 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Cloudfy · Central de Ajuda
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
                  <ArticleRow key={a.id} article={a} catKey={a._cat} showCategory />
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!articleId) { setNotFound(true); setLoading(false); return; }

    const rawId = parseArticleId(articleId);
    setLoading(true);
    setNotFound(false);
    setArticle(null);

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

  if (loading) return (
    <HelpCenterLayout>
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-4">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-8 w-3/4 mt-6" />
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    </HelpCenterLayout>
  );

  if (notFound || !article) return (
    <HelpCenterLayout>
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
        <h1 className="text-xl font-semibold mb-2">Artigo não encontrado</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Este artigo pode ter sido removido ou a URL está incorreta.
        </p>
        <Link to="/ajuda" className="text-sm text-primary underline underline-offset-2">
          Voltar para a Central de Ajuda
        </Link>
      </div>
    </HelpCenterLayout>
  );

  const catKey = classifyArticle(article);
  const catDef = CAT_BY_KEY[catKey];

  return (
    <HelpCenterLayout>
      {/* ── Sticky top bar ── */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </button>
          <span className="text-muted-foreground/30 text-xs shrink-0">·</span>
          <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <Link to="/ajuda" className="hover:text-foreground shrink-0 transition-colors">
              Central de Ajuda
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <Link
              to={`/ajuda?cat=${catKey}`}
              className="hover:text-foreground shrink-0 transition-colors flex items-center gap-1"
            >
              {catDef && (
                <span className={cn("inline-flex h-4 w-4 rounded items-center justify-center shrink-0", catDef.iconBg)}>
                  <catDef.icon className="h-2.5 w-2.5 text-white" />
                </span>
              )}
              {catDef?.label ?? "Geral"}
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground truncate">{article.title}</span>
          </nav>
        </div>
      </div>

      {/* ── Content ── */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6 flex items-center gap-2">
          {catDef && (
            <Link
              to={`/ajuda?cat=${catKey}`}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors",
                catDef.iconBg + "/15",
                "hover:opacity-80",
              )}
            >
              <catDef.icon className={cn("h-3 w-3", catDef.iconText)} style={{ color: undefined }} />
              <span className="text-foreground/70">{catDef.label}</span>
            </Link>
          )}
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 leading-tight">
          {article.title}
        </h1>

        <article className="min-w-0">
          <ReactMarkdown components={MD_COMPONENTS}>
            {article.content}
          </ReactMarkdown>
        </article>

        <div className="mt-12 pt-6 border-t border-border flex items-center justify-between flex-wrap gap-3">
          <Link
            to={`/ajuda?cat=${catKey}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {catDef?.label ?? "Todos os artigos"}
          </Link>
          <span className="text-xs text-muted-foreground">
            Atualizado em{" "}
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

function ArticleRow({
  article,
  catKey,
  showCategory,
}: {
  article: Article;
  catKey: string;
  showCategory?: boolean;
}) {
  const catDef = CAT_BY_KEY[catKey];
  const Icon = catDef?.icon ?? BookOpen;
  return (
    <Link
      to={articlePath(article)}
      className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate block">
            {article.title}
          </span>
          {showCategory && catDef && (
            <span className="text-xs text-muted-foreground">{catDef.label}</span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 ml-3 transition-colors" />
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
