import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Search,
  Users,
  Mail,
  TrendingUp,
  MessageSquare,
  Copy,
  AlertCircle,
  Activity,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type ContactInfo, planLabel } from "@/lib/contact-info";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationRecord {
  id: string;
  status: string;
  subject: string | null;
  created_at: string;
  resolved_at: string | null;
  channel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));
}

const statusColors: Record<string, string> = {
  ativo:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  active:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  inativo:   "bg-rose-500/15 text-rose-400 border-rose-500/30",
  inactive:  "bg-rose-500/15 text-rose-400 border-rose-500/30",
  pendente:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  pending:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function statusBadgeCls(status: string | null): string {
  if (!status) return "bg-muted text-muted-foreground border-border";
  return statusColors[status.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Contacts() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactInfo | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 3) {
      setResults([]);
      setHasSearched(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchContact(query.trim());
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function searchContact(term: string) {
    setIsSearching(true);
    setError(null);
    setHasSearched(true);

    // Resolve uma lista de e-mails candidatos. Se o termo já é um e-mail completo,
    // usa direto; senão, busca por substring (ilike) em email/nome na tabela account.
    let emails: string[] = [];
    const isFullEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(term);

    if (isFullEmail) {
      emails = [term];
    } else {
      const { data: accounts, error: accErr } = await supabase
        .from("account")
        .select("email")
        .or(`email.ilike.%${term}%,name.ilike.%${term}%`)
        .not("email", "is", null)
        .limit(12);

      if (accErr) {
        setIsSearching(false);
        setError("Erro ao buscar contatos. Tente novamente.");
        setResults([]);
        return;
      }
      emails = [...new Set((accounts ?? []).map((a) => a.email as string).filter(Boolean))];
    }

    if (emails.length === 0) {
      setIsSearching(false);
      setResults([]);
      return;
    }

    // Busca a ficha completa de cada candidato (em paralelo, com teto de 12).
    const infos = await Promise.all(
      emails.slice(0, 12).map(async (email) => {
        const { data, error: fnError } = await supabase.functions.invoke("get-contact-info", {
          body: { email },
        });
        if (fnError) return null;
        const info = data as ContactInfo | null;
        const hasData =
          !!info?.customer ||
          (info?.subscriptions?.length ?? 0) > 0 ||
          (info?.infras?.length ?? 0) > 0;
        return info && hasData ? info : null;
      })
    );

    setIsSearching(false);
    setResults(infos.filter((i): i is ContactInfo => i !== null));
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5" /> Contatos
        </h1>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou e-mail (mín. 3 caracteres)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-9"
            autoFocus
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {/* Loading */}
        {isSearching && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        )}

        {/* Error */}
        {!isSearching && error && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-rose-500 opacity-60" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Empty state — not yet searched */}
        {!isSearching && !error && !hasSearched && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Search className="h-10 w-10 opacity-20" />
            <p className="text-sm">Digite um nome ou e-mail para buscar no CRM</p>
            <p className="text-xs opacity-60">Mínimo de 3 caracteres</p>
          </div>
        )}

        {/* No results */}
        {!isSearching && !error && hasSearched && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-20" />
            <p className="text-sm">Nenhum contato encontrado</p>
          </div>
        )}

        {/* Results */}
        {!isSearching && results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((info) => (
              <ContactCard
                key={info.customer?.customer_id ?? info.customer?.email ?? "result"}
                info={info}
                onClick={() => setSelected(info)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <ContactDrawer
        info={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ─── Contact card ─────────────────────────────────────────────────────────────

function ContactCard({
  info,
  onClick,
}: {
  info: ContactInfo;
  onClick: () => void;
}) {
  const { customer } = info;
  const subscription = info.subscriptions[0] ?? null;
  const plan = planLabel(subscription);

  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card p-4 space-y-3 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-colors"
    >
      {/* Name + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-card-foreground leading-tight">
            {customer?.name ?? "—"}
          </p>
          {customer?.referral && (
            <p className="text-[11px] text-muted-foreground mt-0.5">via {customer.referral}</p>
          )}
        </div>
        {subscription?.status && (
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0 h-4 shrink-0 border", statusBadgeCls(subscription.status))}
          >
            {subscription.status}
          </Badge>
        )}
      </div>

      {/* Email */}
      {customer?.email && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{customer.email}</span>
        </div>
      )}

      {/* Plan + MRR */}
      <div className="flex items-center justify-between text-xs">
        {plan ? (
          <span className="text-indigo-400 font-medium">{plan}</span>
        ) : (
          <span className="text-muted-foreground">Sem plano</span>
        )}
        {subscription?.mrr != null && subscription.mrr > 0 && (
          <span className="text-emerald-400 font-semibold">
            {formatCurrency(subscription.mrr)}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Contact drawer ───────────────────────────────────────────────────────────

function ContactDrawer({
  info,
  onClose,
}: {
  info: ContactInfo | null;
  onClose: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [isLoadingConvs, setIsLoadingConvs] = useState(false);

  const email = info?.customer?.email ?? null;

  useEffect(() => {
    if (!email) {
      setConversations([]);
      return;
    }

    // Look up the account_user_id for this email, then load conversations
    setIsLoadingConvs(true);
    supabase
      .from("account")
      .select("user_id")
      .eq("email", email)
      .maybeSingle()
      .then(({ data: acc }) => {
        if (!acc?.user_id) {
          setConversations([]);
          setIsLoadingConvs(false);
          return;
        }
        return supabase
          .from("desk_conversations")
          .select("id, status, subject, created_at, resolved_at, channel")
          .eq("account_user_id", acc.user_id)
          .order("created_at", { ascending: false })
          .limit(20)
          .then(({ data }) => {
            setConversations((data as ConversationRecord[]) ?? []);
            setIsLoadingConvs(false);
          });
      })
      // Builders do supabase-js são PromiseLike (sem .catch) — usa o onRejected do then
      .then(undefined, () => setIsLoadingConvs(false));
  }, [email]);

  if (!info) return null;

  const { customer } = info;
  const subscription = info.subscriptions[0] ?? null;
  const infra = info.infras[0] ?? null;

  return (
    <Sheet open={!!info} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto bg-card border-border">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base">{customer?.name ?? customer?.email ?? "Contato"}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {/* Identity */}
          <Section icon={Users} title="Dados do contato">
            <InfoRow label="Nome" value={customer?.name} />
            <InfoRow label="E-mail" value={customer?.email} copyable />
            <InfoRow label="Referral" value={customer?.referral} />
            {customer?.customer_id && (
              <InfoRow label="Stripe ID" value={customer.customer_id} mono copyable />
            )}
          </Section>

          <Separator />

          {/* Plan / commercial */}
          <Section icon={TrendingUp} title="Plano & financeiro">
            <InfoRow label="Plano" value={planLabel(subscription)} />
            <InfoRow label="Status" value={subscription?.status} />
            <InfoRow
              label="MRR"
              value={subscription?.mrr != null && subscription.mrr > 0 ? formatCurrency(subscription.mrr) : null}
              highlight
            />
            <InfoRow label="Promocode" value={subscription?.promocode} />
            {subscription?.subscription_id && (
              <InfoRow label="Subscription ID" value={subscription.subscription_id} mono copyable />
            )}
          </Section>

          {/* Infra usage */}
          {infra && (
            <>
              <Separator />
              <Section icon={Activity} title="Infraestrutura">
                <InfoRow label="Status" value={infra.status} />
                <InfoRow label="Purchase code" value={infra.purchase_code} mono />
                <InfoRow label="Requests (24h)" value={infra.requests_24h.toLocaleString("pt-BR")} />
                <InfoRow label="Requests (7d)" value={infra.requests_7d.toLocaleString("pt-BR")} />
                <InfoRow label="Requests (30d)" value={infra.requests_30d.toLocaleString("pt-BR")} />
              </Section>
            </>
          )}

          <Separator />

          {/* Conversations */}
          <Section icon={MessageSquare} title={`Conversas (${conversations.length})`}>
            {isLoadingConvs ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma conversa encontrada</p>
            ) : (
              <div className="space-y-2">
                {conversations.map((conv) => (
                  <ConversationRow key={conv.id} conv={conv} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Drawer sub-components ────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {title}
      </h4>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  copyable = false,
  highlight = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copyable?: boolean;
  highlight?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 group">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={cn(
            "text-xs truncate",
            mono ? "font-mono text-[10px]" : "",
            highlight ? "text-emerald-400 font-semibold" : "text-card-foreground",
          )}
        >
          {value}
        </span>
        {copyable && (
          <button
            onClick={() => copyToClipboard(value, label)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted shrink-0"
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

const convStatusLabels: Record<string, string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
  snoozed: "Adiada",
};

const convStatusCls: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  resolved: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  snoozed: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
};

function ConversationRow({ conv }: { conv: ConversationRecord }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-card-foreground truncate">
          {conv.subject ?? "Sem assunto"}
        </p>
        <Badge
          variant="outline"
          className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", convStatusCls[conv.status] ?? "")}
        >
          {convStatusLabels[conv.status] ?? conv.status}
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {formatDistanceToNow(new Date(conv.created_at), { addSuffix: true, locale: ptBR })}
        {conv.resolved_at && (
          <> · Resolvida {format(new Date(conv.resolved_at), "dd/MM/yyyy", { locale: ptBR })}</>
        )}
      </p>
    </div>
  );
}
