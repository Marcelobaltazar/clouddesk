// All imports MUST be at the top of the file — no imports after function definitions.
import { useState, useEffect } from "react";
import { ClientInfoPanel } from "./ClientInfoPanel";
import { useInboxStore } from "@/stores/useInboxStore";
import { useConversationStore } from "@/stores/useConversationStore";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, Clock, Zap, Plus, X, UserCircle, ChevronDown, Circle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { broadcastConvUpdated } from "@/lib/conv-broadcast";
import type { Conversation } from "@/stores/useInboxStore";

// ─── Agent types ──────────────────────────────────────────────────────────────

interface DeskAgent {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  status: string;
}

// ─── Tag types ────────────────────────────────────────────────────────────────

interface DeskTag {
  id: string;
  name: string;
  color: string;
}

// ─── Tab config ───────────────────────────────────────────────────────────────

type Tab = "client" | "conversation";

const TABS: { value: Tab; label: string }[] = [
  { value: "client",       label: "Cliente"  },
  { value: "conversation", label: "Conversa" },
];

// ─── Container ────────────────────────────────────────────────────────────────

export function ConversationDetails() {
  const activeConversationId = useInboxStore((s) => s.activeConversationId);
  const [activeTab, setActiveTab] = useState<Tab>("client");

  if (!activeConversationId) return null;

  return (
    <aside className="w-[300px] panel h-full flex flex-col shrink-0 overflow-hidden">

      {/* Tab bar */}
      <div className="flex gap-4 px-4 border-b border-border shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              "py-3 text-sm font-semibold transition-colors relative",
              activeTab === tab.value
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.value && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeTab === "client" ? (
          <ClientInfoPanel />
        ) : (
          <ConversationTab />
        )}
      </ScrollArea>
    </aside>
  );
}

// ─── Conversation tab ─────────────────────────────────────────────────────────

function ConversationTab() {
  const { activeConversationId, conversations } = useInboxStore();
  const messages = useConversationStore((s) => s.messages);
  const conversation = conversations.find((c) => c.id === activeConversationId);

  if (!conversation) return null;

  const contactMessages = messages.filter((m) => m.sender_type === "contact").length;
  const agentMessages   = messages.filter((m) => m.sender_type === "agent").length;
  const botMessages     = messages.filter((m) => m.sender_type === "bot" || m.ai_generated).length;

  return (
    <div className="p-4 space-y-5">

      {/* Assignee */}
      <AssigneeSection conversation={conversation} />

      <Separator />

      {/* Status & priority */}
      <Section title="Status">
        <div className="flex gap-1.5 flex-wrap">
          <StatusBadge conversation={conversation} />
          <PriorityBadge priority={conversation.priority} />
          {conversation.ai_active && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 text-primary border-primary/30">
              <Bot className="h-2.5 w-2.5" /> IA ativa
            </Badge>
          )}
        </div>
      </Section>

      <Separator />

      {/* Timeline */}
      <Section title="Linha do tempo">
        <div className="space-y-1.5 text-xs">
          <TimelineRow
            icon={Clock}
            label="Criada"
            value={format(new Date(conversation.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          />
          {conversation.first_response_at && (
            <TimelineRow
              icon={Zap}
              label="1ª resposta"
              value={format(new Date(conversation.first_response_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            />
          )}
          {conversation.resolved_at && (
            <TimelineRow
              icon={Clock}
              label="Resolvida"
              value={format(new Date(conversation.resolved_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            />
          )}
          {conversation.sla_deadline && (
            <TimelineRow
              icon={Clock}
              label="Prazo SLA"
              value={formatDistanceToNow(new Date(conversation.sla_deadline), {
                addSuffix: true,
                locale: ptBR,
              })}
              highlight={new Date(conversation.sla_deadline) < new Date()}
            />
          )}
        </div>
      </Section>

      <Separator />

      {/* Message stats */}
      <Section title="Mensagens">
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Cliente" value={contactMessages} />
          <StatCard label="Equipe"  value={agentMessages}   />
          <StatCard label="IA"      value={botMessages}     />
        </div>
      </Section>

      <Separator />

      <Separator />

      {/* Tags */}
      <TagsSection conversationId={conversation.id} />

      <Separator />

      {/* Conversation ID */}
      <Section title="Identificador">
        <p className="text-[10px] font-mono text-muted-foreground break-all">
          {conversation.id}
        </p>
      </Section>
    </div>
  );
}

// ─── AssigneeSection ──────────────────────────────────────────────────────────

const statusDot: Record<string, string> = {
  online:  "text-emerald-500",
  away:    "text-amber-500",
  offline: "text-gray-500",
};

function AssigneeSection({ conversation }: { conversation: { id: string; assigned_agent_id: string | null } }) {
  const [agents, setAgents] = useState<DeskAgent[]>([]);
  const { upsertConversation } = useInboxStore();

  useEffect(() => {
    supabase
      .from("desk_agents")
      .select("id, name, email, avatar_url, status")
      .order("name")
      .then(({ data }) => { if (data) setAgents(data as DeskAgent[]); });
  }, []);

  const assigned = agents.find((a) => a.id === conversation.assigned_agent_id) ?? null;

  async function assign(agentId: string | null) {
    const { error } = await supabase
      .from("desk_conversations")
      .update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() })
      .eq("id", conversation.id);

    if (error) { toast.error("Erro ao atribuir conversa"); return; }

    upsertConversation({ id: conversation.id, assigned_agent_id: agentId } as Record<string, unknown>);
    // Widget mostra "✅ Atendente conectado" quando alguém assume
    if (agentId) void broadcastConvUpdated(conversation.id, { assigned_agent_id: agentId });

    const msg = agentId
      ? `Conversa atribuída para ${agents.find((a) => a.id === agentId)?.name ?? "agente"}`
      : "Atribuição removida";

    await supabase.from("desk_messages").insert({
      conversation_id: conversation.id,
      sender_type: "system",
      content: msg,
    });

    toast.success(msg);
  }

  const initials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Section title="Atribuído a">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 w-full rounded-md hover:bg-surface px-1.5 py-1 transition-colors text-left">
            {assigned ? (
              <>
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                    {initials(assigned.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-card-foreground truncate flex-1">{assigned.name}</span>
              </>
            ) : (
              <>
                <UserCircle className="h-6 w-6 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground flex-1">Não atribuído</span>
              </>
            )}
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => assign(null)} className="gap-2 text-muted-foreground">
            <UserCircle className="h-4 w-4" />
            <span className="text-xs">Não atribuído</span>
          </DropdownMenuItem>
          {agents.map((agent) => (
            <DropdownMenuItem key={agent.id} onClick={() => assign(agent.id)} className="gap-2">
              <div className="relative shrink-0">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[9px] bg-primary/20 text-primary">
                    {initials(agent.name)}
                  </AvatarFallback>
                </Avatar>
                <Circle
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 fill-current",
                    statusDot[agent.status] ?? statusDot.offline
                  )}
                />
              </div>
              <span className="text-xs truncate">{agent.name}</span>
              {agent.id === conversation.assigned_agent_id && (
                <span className="ml-auto text-[9px] text-primary">atual</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Section>
  );
}

// ─── TagsSection ──────────────────────────────────────────────────────────────

function TagsSection({ conversationId }: { conversationId: string }) {
  const [appliedTags, setAppliedTags] = useState<DeskTag[]>([]);
  const [allTags, setAllTags] = useState<DeskTag[]>([]);

  useEffect(() => {
    loadApplied();
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function loadApplied() {
    const { data, error } = await supabase
      .from("desk_conversation_tags")
      .select("tag_id, desk_tags(id, name, color)")
      .eq("conversation_id", conversationId);

    if (error) return;

    const tags: DeskTag[] = (data ?? [])
      .map((row) => {
        const t = row.desk_tags as { id: string; name: string; color: string } | null;
        return t ? { id: t.id, name: t.name, color: t.color } : null;
      })
      .filter((t): t is DeskTag => t !== null);

    setAppliedTags(tags);
  }

  async function loadAll() {
    const { data, error } = await supabase
      .from("desk_tags")
      .select("id, name, color")
      .order("name");

    if (error) return;
    setAllTags((data ?? []) as DeskTag[]);
  }

  async function addTag(tag: DeskTag) {
    if (appliedTags.some((t) => t.id === tag.id)) return;

    const { error } = await supabase
      .from("desk_conversation_tags")
      .insert({ conversation_id: conversationId, tag_id: tag.id });

    if (error) {
      toast.error("Erro ao adicionar tag");
      return;
    }
    setAppliedTags((prev) => [...prev, tag]);
  }

  async function removeTag(tagId: string) {
    const { error } = await supabase
      .from("desk_conversation_tags")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("tag_id", tagId);

    if (error) {
      toast.error("Erro ao remover tag");
      return;
    }
    setAppliedTags((prev) => prev.filter((t) => t.id !== tagId));
  }

  const availableTags = allTags.filter((t) => !appliedTags.some((a) => a.id === t.id));

  return (
    <Section title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {appliedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border"
            style={{ borderColor: tag.color, color: tag.color, backgroundColor: `${tag.color}15` }}
          >
            {tag.name}
            <button
              onClick={() => removeTag(tag.id)}
              className="hover:opacity-70 transition-opacity"
              aria-label={`Remover tag ${tag.name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        {availableTags.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground border border-dashed border-muted-foreground/40 px-1.5 py-0.5 rounded-full hover:border-primary hover:text-primary transition-colors"
                aria-label="Adicionar tag"
              >
                <Plus className="h-2.5 w-2.5" />
                Tag
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {availableTags.map((tag) => (
                <DropdownMenuItem
                  key={tag.id}
                  onClick={() => addTag(tag)}
                  className="gap-2"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-xs">{tag.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {appliedTags.length === 0 && availableTags.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma tag criada. Crie em Configurações.
          </p>
        )}
      </div>
    </Section>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </div>
  );
}

function TimelineRow({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex flex-col">
        <span className="text-muted-foreground text-[10px]">{label}</span>
        <span className={cn("text-xs", highlight ? "text-amber-500 font-medium" : "text-card-foreground")}>
          {value}
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-surface border border-border py-2 px-1">
      <span className="text-base font-bold text-card-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground mt-0.5">{label}</span>
    </div>
  );
}

const statusConfig: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberta",    cls: "border-emerald-500/40 text-emerald-500" },
  pending:  { label: "Pendente",  cls: "border-amber-500/40 text-amber-500"     },
  snoozed:  { label: "Adiada",    cls: "border-blue-500/40 text-blue-400"       },
  resolved: { label: "Resolvida", cls: "border-muted text-muted-foreground"     },
};

function StatusBadge({ conversation }: { conversation: Conversation }) {
  const cfg = statusConfig[conversation.status] ?? statusConfig.open;
  return (
    <Badge variant="outline" className={cn("text-[10px] h-5", cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}

const priorityConfig: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgente", cls: "bg-priority-urgent text-primary-foreground border-transparent" },
  high:   { label: "Alta",    cls: "bg-priority-high text-primary-foreground border-transparent"   },
  medium: { label: "Média",   cls: "bg-priority-medium text-primary-foreground border-transparent" },
  low:    { label: "Baixa",   cls: "bg-priority-low text-primary-foreground border-transparent"    },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? priorityConfig.medium;
  return (
    <Badge variant="outline" className={cn("text-[10px] h-5", cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}
