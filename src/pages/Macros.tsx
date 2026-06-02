import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Zap, Plus, Search, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Snippet {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

interface SnippetDraft {
  id?: string;
  title: string;
  content: string;
  shortcut: string;
  category: string;
}

const EMPTY_DRAFT: SnippetDraft = { title: "", content: "", shortcut: "", category: "" };

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MacrosPage() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState("");

  const [editing, setEditing]   = useState<SnippetDraft | null>(null);
  const [saving, setSaving]     = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("desk_snippets")
      .select("id, title, content, shortcut, category, created_at, updated_at")
      .order("title");
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar respostas rápidas");
      console.error(error);
      return;
    }
    setSnippets((data ?? []) as Snippet[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = snippets.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.shortcut?.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q)
    );
  });

  // ── Save (create or update) ─────────────────────────────────────────────────
  async function handleSave() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.content.trim()) {
      toast.error("Título e conteúdo são obrigatórios");
      return;
    }
    setSaving(true);

    const payload = {
      title: editing.title.trim(),
      content: editing.content.trim(),
      shortcut: editing.shortcut.trim() || null,
      category: editing.category.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = editing.id
      ? await supabase.from("desk_snippets").update(payload).eq("id", editing.id)
      : await supabase.from("desk_snippets").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar resposta rápida");
      console.error(error);
      return;
    }
    toast.success(editing.id ? "Resposta rápida atualizada" : "Resposta rápida criada");
    setEditing(null);
    load();
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from("desk_snippets").delete().eq("id", deleteId);
    setDeleteId(null);
    if (error) {
      toast.error("Erro ao excluir");
      console.error(error);
      return;
    }
    toast.success("Resposta rápida excluída");
    load();
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-semibold text-foreground">Respostas rápidas</h1>
            <p className="text-xs text-muted-foreground">
              Textos reutilizáveis que o operador insere no atendimento
            </p>
          </div>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
          <Plus className="h-4 w-4" /> Nova resposta
        </Button>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {loading ? (
          <div className="space-y-3 max-w-3xl">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <Zap className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {snippets.length === 0
                ? "Nenhuma resposta rápida cadastrada"
                : "Nenhum resultado para a busca"}
            </p>
            {snippets.length === 0 && (
              <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                <Plus className="h-4 w-4" /> Criar a primeira
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="group rounded-lg border border-border bg-card p-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium text-card-foreground truncate">{s.title}</h3>
                      {s.shortcut && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-surface px-1.5 py-0.5 rounded">
                          {s.shortcut}
                        </span>
                      )}
                      {s.category && (
                        <Badge variant="outline" className="text-[10px]">{s.category}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 whitespace-pre-wrap">
                      {s.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          title: s.title,
                          content: s.content,
                          shortcut: s.shortcut ?? "",
                          category: s.category ?? "",
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                      onClick={() => setDeleteId(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit / create sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col">
          <SheetHeader>
            <SheetTitle>{editing?.id ? "Editar resposta rápida" : "Nova resposta rápida"}</SheetTitle>
          </SheetHeader>

          {editing && (
            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-4 py-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Título</label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Ex.: Saudação inicial"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Atalho (opcional)</label>
                  <Input
                    value={editing.shortcut}
                    onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })}
                    placeholder="/saudacao"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Categoria (opcional)</label>
                  <Input
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    placeholder="Ex.: Onboarding"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Conteúdo</label>
                <Textarea
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  placeholder="Texto que será inserido no composer..."
                  className="min-h-[160px] resize-none"
                />
              </div>
            </div>
          )}

          <SheetFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir resposta rápida?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
