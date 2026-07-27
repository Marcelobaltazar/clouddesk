import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowLeft, GitMerge, Loader2, MessageSquare, Mail } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface MergeCandidate {
  id: string;
  status: string;
  subject: string | null;
  channel: string;
  created_at: string;
  updated_at: string;
  preview: string;
}

interface PreviewMessage {
  id: string;
  sender_type: string;
  content: string;
  created_at: string;
  is_private_note: boolean;
  ai_generated: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** conversa ATUAL (será absorvida) */
  sourceId: string;
  sourceContactName: string;
  /** callback após mesclar com sucesso — recebe o id do destino para navegar */
  onMerged: (targetId: string) => void;
}

const statusLabel: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberta",    cls: "bg-emerald-100 text-emerald-700" },
  pending:  { label: "Pendente",  cls: "bg-amber-100 text-amber-700"     },
  snoozed:  { label: "Adiada",    cls: "bg-violet-100 text-violet-700"   },
  resolved: { label: "Fechada",   cls: "bg-muted text-muted-foreground"  },
};

function ChannelIcon({ channel }: { channel: string }) {
  return channel === "email"
    ? <Mail className="h-3 w-3 shrink-0" />
    : <MessageSquare className="h-3 w-3 shrink-0" />;
}

// Mini-thread para o preview lado a lado
function MiniThread({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<PreviewMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("desk_messages")
      .select("id, sender_type, content, created_at, is_private_note, ai_generated")
      .eq("conversation_id", conversationId)
      .eq("is_private_note", false)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setMessages((data ?? []) as PreviewMessage[]);
      });
    return () => { cancelled = true; };
  }, [conversationId]);

  if (messages === null) {
    return <div className="space-y-2 p-3">{[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-3/4 rounded-lg" />)}</div>;
  }
  if (messages.length === 0) {
    return <p className="p-4 text-xs text-muted-foreground text-center">Sem mensagens.</p>;
  }

  return (
    <div className="p-3 space-y-2 overflow-y-auto scrollbar-thin">
      {messages.map((m) => {
        const isContact = m.sender_type === "contact";
        const isBot = m.sender_type === "bot" || m.ai_generated;
        const isSystem = m.sender_type === "system";
        if (isSystem) {
          return (
            <p key={m.id} className="text-center text-[10px] text-muted-foreground">{m.content}</p>
          );
        }
        return (
          <div key={m.id} className={cn("flex", isContact ? "justify-start" : "justify-end")}>
            <div className={cn(
              "max-w-[80%] rounded-lg px-3 py-1.5 text-[12px] leading-snug whitespace-pre-wrap break-words",
              isContact ? "bg-muted text-foreground"
                : isBot ? "bg-[hsl(var(--bubble-bot))]/15 text-foreground"
                : "bg-primary text-primary-foreground"
            )}>
              {m.content.slice(0, 500)}
              <span className="block text-[9px] opacity-60 mt-0.5">
                {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MergeDialog({ open, onOpenChange, sourceId, sourceContactName, onMerged }: Props) {
  const agent = useAuthStore((s) => s.agent);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [target, setTarget] = useState<MergeCandidate | null>(null);
  const [merging, setMerging] = useState(false);

  // Carrega as conversas do mesmo cliente ao abrir
  const load = useCallback(async () => {
    setCandidates(null);
    const { data, error } = await supabase.functions.invoke<{ conversations: MergeCandidate[] }>(
      "desk-merge-conversations",
      { body: { action: "list", conversation_id: sourceId } },
    );
    if (error) {
      toast.error("Erro ao buscar conversas do cliente");
      setCandidates([]);
      return;
    }
    setCandidates(data?.conversations ?? []);
  }, [sourceId]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTarget(null);
      load();
    }
  }, [open, load]);

  const filtered = (candidates ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (c.subject ?? "").toLowerCase().includes(q) || c.preview.toLowerCase().includes(q) || c.id.includes(q);
  });

  const handleMerge = async () => {
    if (!target || merging) return;
    setMerging(true);
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
      "desk-merge-conversations",
      {
        body: {
          action: "merge",
          source_id: sourceId,
          target_id: target.id,
          agent_name: agent?.name ?? undefined,
        },
      },
    );
    setMerging(false);
    if (error || !data?.ok) {
      toast.error("Erro ao mesclar", { description: data?.error ?? error?.message });
      return;
    }
    toast.success("Conversas mescladas");
    onOpenChange(false);
    onMerged(target.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("gap-0 p-0 overflow-hidden", target ? "max-w-4xl" : "max-w-lg")}>
        {!target ? (
          // ── Passo 1: escolher a conversa destino ──────────────────────────────
          <>
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="text-base">Mesclar esta conversa com…</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Outras conversas de <strong>{sourceContactName}</strong>. As mensagens desta conversa
                serão movidas para a que você escolher.
              </p>
            </DialogHeader>

            <div className="px-4 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Buscar por assunto ou conteúdo…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto scrollbar-thin px-2 pb-3">
              {candidates === null ? (
                <div className="space-y-2 p-2">{[0,1,2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {candidates.length === 0
                    ? "Este cliente não tem outras conversas."
                    : "Nenhuma conversa corresponde à busca."}
                </p>
              ) : (
                filtered.map((c) => {
                  const st = statusLabel[c.status] ?? statusLabel.open;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setTarget(c)}
                      className="w-full flex items-start gap-2 px-2 py-2.5 rounded-lg hover:bg-surface transition-colors text-left"
                    >
                      <ChannelIcon channel={c.channel} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">
                            {c.subject || "Conversa"}
                          </span>
                          <Badge className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0", st.cls)}>{st.label}</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            #{c.id.slice(0, 8)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{c.preview || "—"}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          // ── Passo 2: preview lado a lado + confirmar ──────────────────────────
          <>
            <DialogHeader className="p-4 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setTarget(null)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle className="text-base">Deseja mesmo mesclar essas conversas?</DialogTitle>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 p-4 pt-3">
              {/* Destino (fica) */}
              <div className="border border-primary/40 rounded-xl overflow-hidden flex flex-col h-[46vh]">
                <div className="px-3 py-2 border-b border-border bg-primary/5 shrink-0">
                  <Badge className="bg-primary/15 text-primary text-[10px]">Conversa principal (fica)</Badge>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    #{target.id.slice(0, 8)} · {target.subject || "Conversa"}
                  </p>
                </div>
                <MiniThread conversationId={target.id} />
              </div>

              {/* Origem (absorvida) */}
              <div className="border border-amber-400/40 rounded-xl overflow-hidden flex flex-col h-[46vh]">
                <div className="px-3 py-2 border-b border-border bg-amber-400/5 shrink-0">
                  <Badge className="bg-amber-100 text-amber-700 text-[10px]">Esta conversa (será absorvida)</Badge>
                  <p className="text-[11px] text-muted-foreground mt-1">#{sourceId.slice(0, 8)}</p>
                </div>
                <MiniThread conversationId={sourceId} />
              </div>
            </div>

            <div className="px-4 pb-2">
              <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                As mensagens desta conversa vão para a principal, um resumo por IA é gerado, e esta
                conversa é encerrada como mesclada. <strong>A ação é definitiva.</strong>
              </p>
            </div>

            <DialogFooter className="p-4 pt-2 border-t border-border">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={merging}>Cancelar</Button>
              <Button onClick={handleMerge} disabled={merging} className="gap-1.5">
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                {merging ? "Mesclando…" : "Confirmar mesclagem"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
