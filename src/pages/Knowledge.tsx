import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BookOpen,
  Plus,
  Search,
  Pencil,
  Trash2,
  Globe,
  FileText,
  Eye,
  EyeOff,
  Filter,
  X,
  Cpu,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  is_published: boolean;
  created_at: string;
  updated_at: string;
  embedding: unknown;
}

interface Snippet {
  id: string;
  title: string;
  content: string;
  category: string | null;
  created_at: string;
  embedding: unknown;
  shortcut: string | null;
}

type FilterStatus = "all" | "published" | "draft";
type ActiveTab = "articles" | "snippets";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Knowledge() {
  const agent = useAuthStore((s) => s.agent);
  const [activeTab, setActiveTab] = useState<ActiveTab>("articles");

  // ── Articles state ──────────────────────────────────────────────────────────
  const [articles, setArticles]           = useState<Article[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [search, setSearch]               = useState("");
  const [filterStatus, setFilterStatus]   = useState<FilterStatus>("all");
  const [filterCategory, setFilterCategory] = useState("");
  const [sheetOpen, setSheetOpen]         = useState(false);
  const [editing, setEditing]             = useState<Article | null>(null);
  const [saving, setSaving]               = useState(false);
  const [embedding, setEmbedding]         = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "", is_published: false });
  const [deleteTarget, setDeleteTarget]   = useState<Article | null>(null);
  const [deleting, setDeleting]           = useState(false);

  // ── Snippets state ──────────────────────────────────────────────────────────
  const [snippets, setSnippets]           = useState<Snippet[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState("");
  const [snippetSheetOpen, setSnippetSheetOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [embeddingSnippet, setEmbeddingSnippet] = useState(false);
  const [snippetForm, setSnippetForm]     = useState({ title: "", content: "", category: "", shortcut: "" });
  const [deleteSnippetTarget, setDeleteSnippetTarget] = useState<Snippet | null>(null);
  const [deletingSnippet, setDeletingSnippet] = useState(false);

  // ── Load articles ────────────────────────────────────────────────────────────
  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("desk_knowledge_base")
      .select("id, title, content, category, tags, is_published, created_at, updated_at, embedding")
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar artigos", { description: error.message });
    } else {
      setArticles((data ?? []) as Article[]);
    }
    setIsLoading(false);
  }, []);

  // ── Load snippets ────────────────────────────────────────────────────────────
  const loadSnippets = useCallback(async () => {
    setSnippetsLoading(true);
    const { data, error } = await supabase
      .from("desk_snippets")
      .select("id, title, content, category, created_at, embedding, shortcut")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar snippets", { description: error.message });
    } else {
      setSnippets((data ?? []) as Snippet[]);
    }
    setSnippetsLoading(false);
  }, []);

  useEffect(() => { loadArticles(); }, [loadArticles]);
  useEffect(() => { loadSnippets(); }, [loadSnippets]);

  // ── Derived: filtered articles ───────────────────────────────────────────────
  const categories = [...new Set(articles.map((a) => a.category).filter(Boolean))] as string[];
  const filtered = articles.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q || a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "published" && a.is_published) ||
      (filterStatus === "draft" && !a.is_published);
    const matchCategory = !filterCategory || a.category === filterCategory;
    return matchSearch && matchStatus && matchCategory;
  });

  const filteredSnippets = snippets.filter((s) => {
    const q = snippetSearch.toLowerCase();
    return !q || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
  });

  const publishedCount = articles.filter((a) => a.is_published).length;
  const draftCount     = articles.filter((a) => !a.is_published).length;

  // ── Article sheet helpers ────────────────────────────────────────────────────
  const openNew = () => {
    setEditing(null);
    setForm({ title: "", content: "", category: "", is_published: false });
    setSheetOpen(true);
  };

  const openEdit = (article: Article) => {
    setEditing(article);
    setForm({ title: article.title, content: article.content, category: article.category ?? "", is_published: article.is_published });
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("O título é obrigatório"); return; }
    if (!form.content.trim()) { toast.error("O conteúdo é obrigatório"); return; }
    setSaving(true);

    const payload = {
      title:        form.title.trim(),
      content:      form.content.trim(),
      category:     form.category.trim() || null,
      is_published: form.is_published,
      updated_at:   new Date().toISOString(),
    };

    let savedId: string | null = editing?.id ?? null;
    let saveError: unknown = null;

    if (editing) {
      const { error } = await supabase.from("desk_knowledge_base").update(payload).eq("id", editing.id);
      saveError = error;
    } else {
      const { data, error } = await supabase.from("desk_knowledge_base").insert(payload).select("id").single();
      saveError = error;
      if (data) savedId = data.id;
    }

    if (saveError) {
      const err = saveError as { message: string };
      toast.error("Erro ao salvar artigo", { description: err.message });
      setSaving(false);
      return;
    }

    toast.success(editing ? "Artigo atualizado" : "Artigo criado com sucesso");
    setSaving(false);
    setSheetOpen(false);
    loadArticles();

    if (savedId) generateArticleEmbedding(savedId, `${payload.title}\n\n${payload.content}`);
  };

  const generateArticleEmbedding = async (id: string, content: string) => {
    setEmbedding(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke("desk-embed-article", {
        body: { id, content, table: "desk_knowledge_base" },
      });
      if (fnErr) console.warn("[Knowledge] Embedding failed (non-fatal):", fnErr.message);
    } catch (err) {
      console.warn("[Knowledge] Embedding error (non-fatal):", err);
    } finally {
      setEmbedding(false);
    }
  };

  const handleTogglePublish = async (article: Article) => {
    const next = !article.is_published;
    const { error } = await supabase.from("desk_knowledge_base")
      .update({ is_published: next, updated_at: new Date().toISOString() }).eq("id", article.id);
    if (error) {
      toast.error("Erro ao alterar status", { description: error.message });
    } else {
      toast.success(next ? "Artigo publicado" : "Artigo despublicado");
      setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, is_published: next } : a)));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("desk_knowledge_base").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error("Erro ao excluir artigo", { description: error.message });
    } else {
      toast.success("Artigo excluído");
      setArticles((prev) => prev.filter((a) => a.id !== deleteTarget.id));
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  // ── Snippet sheet helpers ────────────────────────────────────────────────────
  const openNewSnippet = () => {
    setEditingSnippet(null);
    setSnippetForm({ title: "", content: "", category: "", shortcut: "" });
    setSnippetSheetOpen(true);
  };

  const openEditSnippet = (s: Snippet) => {
    setEditingSnippet(s);
    setSnippetForm({ title: s.title, content: s.content, category: s.category ?? "", shortcut: s.shortcut ?? "" });
    setSnippetSheetOpen(true);
  };

  const handleSaveSnippet = async () => {
    if (!snippetForm.title.trim()) { toast.error("O título é obrigatório"); return; }
    if (!snippetForm.content.trim()) { toast.error("O conteúdo é obrigatório"); return; }
    setSavingSnippet(true);

    const payload = {
      title:    snippetForm.title.trim(),
      content:  snippetForm.content.trim(),
      category: snippetForm.category.trim() || null,
      shortcut: snippetForm.shortcut.trim() || null,
    };

    let savedId: string | null = editingSnippet?.id ?? null;
    let saveError: unknown = null;

    if (editingSnippet) {
      const { error } = await supabase.from("desk_snippets").update(payload).eq("id", editingSnippet.id);
      saveError = error;
    } else {
      const { data, error } = await supabase.from("desk_snippets").insert(payload).select("id").single();
      saveError = error;
      if (data) savedId = data.id;
    }

    if (saveError) {
      const err = saveError as { message: string };
      toast.error("Erro ao salvar snippet", { description: err.message });
      setSavingSnippet(false);
      return;
    }

    toast.success(editingSnippet ? "Snippet atualizado" : "Snippet criado");
    setSavingSnippet(false);
    setSnippetSheetOpen(false);
    loadSnippets();

    if (savedId) generateSnippetEmbedding(savedId, `${payload.title}\n\n${payload.content}`);
  };

  const generateSnippetEmbedding = async (id: string, content: string) => {
    setEmbeddingSnippet(true);
    try {
      const { error: fnErr } = await supabase.functions.invoke("desk-embed-article", {
        body: { id, content, table: "desk_snippets" },
      });
      if (fnErr) console.warn("[Snippets] Embedding failed (non-fatal):", fnErr.message);
    } catch (err) {
      console.warn("[Snippets] Embedding error (non-fatal):", err);
    } finally {
      setEmbeddingSnippet(false);
    }
  };

  const handleDeleteSnippet = async () => {
    if (!deleteSnippetTarget) return;
    setDeletingSnippet(true);
    const { error } = await supabase.from("desk_snippets").delete().eq("id", deleteSnippetTarget.id);
    if (error) {
      toast.error("Erro ao excluir snippet", { description: error.message });
    } else {
      toast.success("Snippet excluído");
      setSnippets((prev) => prev.filter((s) => s.id !== deleteSnippetTarget.id));
    }
    setDeletingSnippet(false);
    setDeleteSnippetTarget(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">

      {/* ── Header ── */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-base font-semibold text-card-foreground">Base de Conhecimento</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Artigos e snippets usados pela IA para responder clientes
              </p>
            </div>
          </div>
          {activeTab === "articles" ? (
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo Artigo
            </Button>
          ) : (
            <Button size="sm" onClick={openNewSnippet} className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo Snippet
            </Button>
          )}
        </div>

        {/* Stats row (articles only) */}
        {activeTab === "articles" && (
          <div className="px-6 pb-3 flex items-center gap-6">
            <StatPill label="Total" value={articles.length} />
            <StatPill label="Publicados" value={publishedCount} variant="published" />
            <StatPill label="Rascunhos" value={draftCount} variant="draft" />
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 flex items-center gap-0 border-t border-border">
          <button
            onClick={() => setActiveTab("articles")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === "articles"
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Artigos
          </button>
          <button
            onClick={() => setActiveTab("snippets")}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
              activeTab === "snippets"
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Snippets para IA
          </button>
        </div>
      </div>

      {/* ── Articles tab ── */}
      {activeTab === "articles" && (
        <>
          {/* Toolbar */}
          <div className="px-6 py-3 border-b border-border bg-card shrink-0 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por título ou conteúdo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-surface border-none text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 bg-surface rounded-md p-0.5 h-9">
              {(["all", "published", "draft"] as FilterStatus[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setFilterStatus(v)}
                  className={cn(
                    "px-3 py-1 rounded text-xs font-medium transition-colors",
                    filterStatus === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v === "all" ? "Todos" : v === "published" ? "Publicados" : "Rascunhos"}
                </button>
              ))}
            </div>
            {categories.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="flex gap-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}
                      className={cn(
                        "text-[10px] px-2 py-1 rounded-full border transition-colors",
                        filterCategory === cat
                          ? "bg-primary/10 border-primary/40 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Article list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {isLoading ? (
              <LoadingSkeleton />
            ) : filtered.length === 0 ? (
              <EmptyState hasFilters={!!(search || filterCategory || filterStatus !== "all")} onNew={openNew} />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((article) => (
                  <ArticleRow
                    key={article.id}
                    article={article}
                    onEdit={() => openEdit(article)}
                    onTogglePublish={() => handleTogglePublish(article)}
                    onDelete={() => setDeleteTarget(article)}
                    onRegenerate={() => generateArticleEmbedding(article.id, `${article.title}\n\n${article.content}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Snippets tab ── */}
      {activeTab === "snippets" && (
        <>
          {/* Snippets info banner */}
          <div className="px-6 py-3 bg-primary/5 border-b border-border shrink-0">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Snippets são respostas curtas para uso interno da IA</span>
              {" "}— não são artigos públicos. A IA os usa como referência rápida durante buscas semânticas (RAG),
              priorizando snippets antes dos artigos. Ideal para comandos, respostas padrão e instruções técnicas curtas.
            </p>
          </div>

          {/* Toolbar */}
          <div className="px-6 py-3 border-b border-border bg-card shrink-0 flex items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar snippet..."
                value={snippetSearch}
                onChange={(e) => setSnippetSearch(e.target.value)}
                className="pl-9 h-9 bg-surface border-none text-sm"
              />
              {snippetSearch && (
                <button onClick={() => setSnippetSearch("")} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{snippets.length} snippets</span>
          </div>

          {/* Snippets list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {snippetsLoading ? (
              <LoadingSkeleton />
            ) : filteredSnippets.length === 0 ? (
              <SnippetsEmptyState hasFilters={!!snippetSearch} onNew={openNewSnippet} />
            ) : (
              <div className="divide-y divide-border">
                {filteredSnippets.map((s) => (
                  <SnippetRow
                    key={s.id}
                    snippet={s}
                    onEdit={() => openEditSnippet(s)}
                    onDelete={() => setDeleteSnippetTarget(s)}
                    onRegenerate={() => generateSnippetEmbedding(s.id, `${s.title}\n\n${s.content}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Article sheet ── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[560px] sm:w-[600px] flex flex-col p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle className="text-base">{editing ? "Editar artigo" : "Novo artigo"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Título <span className="text-rose-500">*</span></label>
              <Input placeholder="Ex: Como reiniciar o N8N?" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Categoria</label>
              <Input placeholder="Ex: Infraestrutura, Billing..." value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-9" list="kb-categories" />
              <datalist id="kb-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="space-y-1.5 flex flex-col">
              <label className="text-xs font-medium text-foreground">Conteúdo <span className="text-rose-500">*</span></label>
              <p className="text-[10px] text-muted-foreground">Suporta Markdown. Este conteúdo é indexado semanticamente pela IA.</p>
              <Textarea placeholder="Escreva o conteúdo do artigo em Markdown..." value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} className="min-h-[300px] resize-y font-mono text-sm leading-relaxed" />
              <p className="text-[10px] text-muted-foreground text-right">{form.content.length} caracteres</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Publicar artigo</p>
                <p className="text-xs text-muted-foreground mt-0.5">Artigos publicados ficam disponíveis para a IA usar em respostas</p>
              </div>
              <Switch checked={form.is_published} onCheckedChange={(v) => setForm((f) => ({ ...f, is_published: v }))} />
            </div>
          </div>
          <SheetFooter className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
            {embedding ? <p className="text-[11px] text-muted-foreground animate-pulse">Gerando embedding...</p> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar artigo"}</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Snippet sheet ── */}
      <Sheet open={snippetSheetOpen} onOpenChange={setSnippetSheetOpen}>
        <SheetContent side="right" className="w-[520px] sm:w-[560px] flex flex-col p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle className="text-base">{editingSnippet ? "Editar snippet" : "Novo snippet"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
              Snippets são usados <strong className="text-foreground">exclusivamente pela IA</strong> como referência rápida.
              Não aparecem para o cliente. Mantenha o conteúdo curto e objetivo.
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Título <span className="text-rose-500">*</span></label>
              <Input placeholder="Ex: Reiniciar N8N via SSH" value={snippetForm.title} onChange={(e) => setSnippetForm((f) => ({ ...f, title: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Categoria</label>
              <Input placeholder="Ex: Infraestrutura, Comandos..." value={snippetForm.category} onChange={(e) => setSnippetForm((f) => ({ ...f, category: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Conteúdo <span className="text-rose-500">*</span></label>
              <p className="text-[10px] text-muted-foreground">Texto curto e direto que a IA usará como referência em respostas.</p>
              <Textarea placeholder="Ex: Para reiniciar o N8N, execute: docker restart n8n" value={snippetForm.content} onChange={(e) => setSnippetForm((f) => ({ ...f, content: e.target.value }))} className="min-h-[180px] resize-y text-sm leading-relaxed" />
              <p className="text-[10px] text-muted-foreground text-right">{snippetForm.content.length} caracteres</p>
            </div>
          </div>
          <SheetFooter className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
            {embeddingSnippet ? <p className="text-[11px] text-muted-foreground animate-pulse">Indexando snippet...</p> : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSnippetSheetOpen(false)}>Cancelar</Button>
              <Button onClick={handleSaveSnippet} disabled={savingSnippet}>{savingSnippet ? "Salvando..." : editingSnippet ? "Salvar alterações" : "Criar snippet"}</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Article delete dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span>{" "}será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Excluindo..." : "Sim, excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Snippet delete dialog ── */}
      <AlertDialog open={!!deleteSnippetTarget} onOpenChange={(o) => !o && setDeleteSnippetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir snippet?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteSnippetTarget?.title}</span>{" "}será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSnippet} disabled={deletingSnippet} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingSnippet ? "Excluindo..." : "Sim, excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── ArticleRow ───────────────────────────────────────────────────────────────

function ArticleRow({
  article,
  onEdit,
  onTogglePublish,
  onDelete,
  onRegenerate,
}: {
  article: Article;
  onEdit: () => void;
  onTogglePublish: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const preview = article.content.replace(/[#*`>\-]/g, "").slice(0, 140).trim();
  const updatedAt = format(new Date(article.updated_at), "dd MMM yyyy", { locale: ptBR });
  const hasEmbedding = article.embedding != null;

  return (
    <div className="px-6 py-4 hover:bg-surface transition-colors group flex items-start gap-4">
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5", article.is_published ? "bg-primary/10" : "bg-muted")}>
        {article.is_published ? <Globe className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-card-foreground truncate">{article.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{preview || "Sem conteúdo"}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7", hasEmbedding ? "text-muted-foreground hover:text-primary" : "text-amber-500 hover:text-amber-400")} onClick={onRegenerate} title={hasEmbedding ? "Regenerar embedding" : "Gerar embedding (ausente)"}>
              <Cpu className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onTogglePublish} title={article.is_published ? "Despublicar" : "Publicar"}>
              {article.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onEdit} title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-500" onClick={onDelete} title="Excluir">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 border", article.is_published ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5" : "text-muted-foreground border-border")}>
            {article.is_published ? "Publicado" : "Rascunho"}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 border gap-0.5", hasEmbedding ? "text-primary border-primary/30 bg-primary/5" : "text-amber-500 border-amber-500/30 bg-amber-500/5")}>
            <Cpu className="h-2.5 w-2.5" />
            {hasEmbedding ? "Indexado" : "Sem índice"}
          </Badge>
          {article.category && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">{article.category}</Badge>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">Atualizado {updatedAt}</span>
        </div>
      </div>
    </div>
  );
}

// ─── SnippetRow ───────────────────────────────────────────────────────────────

function SnippetRow({
  snippet,
  onEdit,
  onDelete,
  onRegenerate,
}: {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const preview = snippet.content.slice(0, 160).trim();
  const createdAt = format(new Date(snippet.created_at), "dd MMM yyyy", { locale: ptBR });
  const hasEmbedding = snippet.embedding != null;

  return (
    <div className="px-6 py-4 hover:bg-surface transition-colors group flex items-start gap-4">
      <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-indigo-500/10">
        <Sparkles className="h-4 w-4 text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-card-foreground truncate">{snippet.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed font-mono">{preview || "Sem conteúdo"}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7", hasEmbedding ? "text-muted-foreground hover:text-primary" : "text-amber-500 hover:text-amber-400")} onClick={onRegenerate} title={hasEmbedding ? "Regenerar índice semântico" : "Gerar índice (ausente)"}>
              <Cpu className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onEdit} title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-500" onClick={onDelete} title="Excluir">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border text-indigo-500 border-indigo-500/30 bg-indigo-500/5">
            Somente IA
          </Badge>
          <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 border gap-0.5", hasEmbedding ? "text-primary border-primary/30 bg-primary/5" : "text-amber-500 border-amber-500/30 bg-amber-500/5")}>
            <Cpu className="h-2.5 w-2.5" />
            {hasEmbedding ? "Indexado" : "Sem índice"}
          </Badge>
          {snippet.category && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">{snippet.category}</Badge>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">Criado {createdAt}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatPill({ label, value, variant = "default" }: { label: string; value: number; variant?: "default" | "published" | "draft" }) {
  const cls = { default: "text-muted-foreground", published: "text-emerald-500", draft: "text-amber-500" }[variant];
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("text-sm font-bold", cls)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-6 py-4 flex items-start gap-4">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-full max-w-md" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasFilters, onNew }: { hasFilters: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-64 text-muted-foreground">
      <BookOpen className="h-10 w-10 opacity-20" />
      {hasFilters ? (
        <>
          <p className="text-sm font-medium">Nenhum artigo encontrado</p>
          <p className="text-xs">Tente ajustar os filtros de busca</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Base de conhecimento vazia</p>
          <p className="text-xs">Crie o primeiro artigo para a IA usar em respostas</p>
          <Button size="sm" onClick={onNew} className="gap-1.5 mt-1"><Plus className="h-4 w-4" /> Criar primeiro artigo</Button>
        </>
      )}
    </div>
  );
}

function SnippetsEmptyState({ hasFilters, onNew }: { hasFilters: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-64 text-muted-foreground">
      <Sparkles className="h-10 w-10 opacity-20" />
      {hasFilters ? (
        <>
          <p className="text-sm font-medium">Nenhum snippet encontrado</p>
          <p className="text-xs">Tente ajustar a busca</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Nenhum snippet ainda</p>
          <p className="text-xs">Snippets são referências rápidas para a IA — curtas, objetivas e técnicas</p>
          <Button size="sm" onClick={onNew} className="gap-1.5 mt-1"><Plus className="h-4 w-4" /> Criar primeiro snippet</Button>
        </>
      )}
    </div>
  );
}
