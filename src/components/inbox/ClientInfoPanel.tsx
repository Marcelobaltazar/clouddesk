import { useEffect, useState } from "react";
import { useConversationStore, type ClientPurchase, type PurchaseStatus } from "@/stores/useConversationStore";
import { useInboxStore } from "@/stores/useInboxStore";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  User,
  Mail,
  Phone,
  CreditCard,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Copy,
  Building2,
  Server,
  MessageSquare,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type ContactInfo,
  type ContactSubscription,
  type ContactInfra,
  type BillingInfo,
  type BillingSubscription,
  type BillingInvoice,
  type BillingCharge,
  planLabel,
  deploymentStatusStyle,
} from "@/lib/contact-info";
import { formatDateTimeBR } from "@/lib/dates";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a deterministic HSL color from a string (for avatar background) */
function nameToHsl(name: string | null): string {
  const str = name ?? "?";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function initials(name: string | null, email: string | null): string {
  if (name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join("");
  }
  return (email?.[0] ?? "?").toUpperCase();
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = currency?.toUpperCase() ?? "USD";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

// ─── Purchase status config ───────────────────────────────────────────────────

const purchaseStatusConfig: Record<
  PurchaseStatus,
  { label: string; icon: typeof CheckCircle2; cls: string; dotCls: string }
> = {
  PAID: {
    label: "Pago",
    icon: CheckCircle2,
    cls: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    dotCls: "bg-emerald-500",
  },
  PENDING: {
    label: "Pendente",
    icon: Clock,
    cls: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    dotCls: "bg-amber-500",
  },
  CANCELLED: {
    label: "Cancelado",
    icon: XCircle,
    cls: "text-rose-500 bg-rose-500/10 border-rose-500/20",
    dotCls: "bg-rose-500",
  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function ClientInfoPanel() {
  const activeConversationId = useInboxStore((s) => s.activeConversationId);
  const conversations = useInboxStore((s) => s.conversations);
  const conversation = conversations.find((c) => c.id === activeConversationId);

  const { clientProfile, isLoadingProfile, loadClientProfile, clearClientProfile, setCrmInfo } =
    useConversationStore();

  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);

  // Load profile whenever the conversation changes
  useEffect(() => {
    console.log("[ClientInfoPanel] conversa ativa:", conversation?.id, "account_user_id:", conversation?.account_user_id);
    if (conversation?.account_user_id) {
      loadClientProfile(conversation.account_user_id);
    } else {
      console.warn("[ClientInfoPanel] account_user_id está null/undefined — não vai carregar perfil");
      clearClientProfile();
      setContactInfo(null);
    }
  }, [conversation?.account_user_id, loadClientProfile, clearClientProfile]);

  // Email do cliente: prioriza o salvo na própria conversa (funciona até para
  // visitantes sem linha em `account`), com fallback para o email do perfil.
  const contactEmail = conversation?.user_email ?? clientProfile?.account?.email ?? null;

  // Busca dados do CRM (Supabase de produção) assim que temos o email
  useEffect(() => {
    const email = contactEmail;
    if (!email) return;

    setContactInfo(null);
    supabase.functions
      .invoke("get-contact-info", { body: { email } })
      .then(({ data }) => {
        const info = data as ContactInfo | null;
        const hasBilling =
          (info?.billing?.subscriptions?.length ?? 0) > 0 ||
          (info?.billing?.invoices?.length ?? 0) > 0 ||
          (info?.billing?.charges?.length ?? 0) > 0;
        const hasData =
          !!info?.customer ||
          (info?.subscriptions?.length ?? 0) > 0 ||
          (info?.infras?.length ?? 0) > 0 ||
          hasBilling;
        if (info && hasData) {
          setContactInfo(info);
          // Primeira assinatura define o plano usado no match de SLA
          const primarySub = info.subscriptions[0] ?? null;
          setCrmInfo({
            product:  primarySub?.product ?? null,
            interval: primarySub?.interval ?? null,
            status:   primarySub?.status ?? null,
            mrr:      primarySub?.mrr ?? null,
            referral: info.customer?.referral ?? null,
          });
        } else {
          setContactInfo(null);
          setCrmInfo(null);
        }
      })
      .catch((err) => {
        console.warn("[ClientInfoPanel] get-contact-info falhou:", err);
      });
  }, [contactEmail]);

  if (!conversation) return null;

  if (isLoadingProfile) return <ClientInfoSkeleton />;

  // ── Visitante sem linha em `account` ────────────────────────────────────────
  // Mesmo sem registro local, podemos ter o email salvo na conversa e dados de
  // CRM (assinaturas/infra) vindos do get-contact-info. Mostramos tudo que houver
  // em vez da mensagem seca de "não identificado".
  if (!clientProfile) {
    return (
      <UnknownContactPanel
        conversation={conversation}
        email={contactEmail}
        contactInfo={contactInfo}
      />
    );
  }

  const { account, purchases } = clientProfile;
  const avatarColor = nameToHsl(account.name);
  const abbr = initials(account.name, account.email);
  const memberSince = account.created_at
    ? format(new Date(account.created_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
    : null;

  // Any active deployment issue?
  const deploymentIssues = purchases.filter(
    (p) => p.pending_deployment && p.status === "PAID"
  );

  return (
    <div className="space-y-0">
      {/* ── Deployment warning banner ── */}

      {deploymentIssues.length > 0 && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-600">Deploy pendente</p>
            {deploymentIssues[0].deployment_failure_reason ? (
              <p className="text-[10px] text-amber-700/80 mt-0.5 leading-relaxed">
                {deploymentIssues[0].deployment_failure_reason}
              </p>
            ) : (
              <p className="text-[10px] text-amber-700/80 mt-0.5">
                Infraestrutura aguardando provisionamento
              </p>
            )}
            {(deploymentIssues[0].deployment_retry_count ?? 0) > 0 && (
              <p className="text-[10px] text-amber-700/60 flex items-center gap-1 mt-1">
                <RefreshCw className="h-2.5 w-2.5" />
                {deploymentIssues[0].deployment_retry_count} tentativa(s)
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Avatar + identity ── */}
      <div className="p-4 flex flex-col items-center text-center gap-1.5">
        <div
          className="h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-lg select-none"
          style={{ backgroundColor: avatarColor }}
        >
          {abbr}
        </div>

        <h3 className="text-sm font-semibold text-card-foreground leading-tight">
          {account.name ?? "Visitante"}
        </h3>

        {memberSince && (
          <p className="text-[10px] text-muted-foreground">
            Cliente desde {memberSince}
          </p>
        )}
      </div>

      {/* ── Contact details ── */}
      <div className="px-4 space-y-2 pb-3">
        {account.email && (
          <ContactRow
            icon={Mail}
            label={account.email}
            onCopy={() => copyToClipboard(account.email!, "E-mail")}
          />
        )}
        {account.phone && (
          <ContactRow
            icon={Phone}
            label={account.phone}
            onCopy={() => copyToClipboard(account.phone!, "Telefone")}
          />
        )}
        {account.stripe_customer_id && (
          <ContactRow
            icon={CreditCard}
            label={account.stripe_customer_id}
            mono
            onCopy={() => copyToClipboard(account.stripe_customer_id!, "Stripe ID")}
          />
        )}
      </div>

      <Separator />

      {/* ── Purchases ── */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionHeader icon={Package} title="Compras / Planos" count={purchases.length} />

        {purchases.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">Nenhuma compra encontrada</p>
        ) : (
          <div className="space-y-2">
            {purchases.map((purchase) => (
              <PurchaseCard key={purchase.id} purchase={purchase} />
            ))}
          </div>
        )}
      </div>

      {/* ── Assinaturas + Infraestruturas (CRM Cloudfy via get-contact-info) ── */}
      {contactInfo && (contactInfo.subscriptions.length > 0 || contactInfo.infras.length > 0) && (
        <>
          <Separator />
          <GroupedResources contactInfo={contactInfo} onCopyDomain={(d) => copyToClipboard(d, "Domínio")} />
        </>
      )}

      {/* Cobrança (Chargefy) — só para clientes já migrados */}
      {contactInfo?.billing && (
        <>
          <Separator />
          <BillingSection billing={contactInfo.billing} />
        </>
      )}

      <Separator />

      {/* ── Histórico de conversas do cliente ── */}
      <ConversationHistory
        accountUserId={conversation.account_user_id}
        currentConversationId={conversation.id}
      />

      <Separator />

      {/* ── Conversation metadata ── */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionHeader title="Conversa" />
        <MetaGrid conversation={conversation} />
      </div>
    </div>
  );
}

// ─── Histórico de conversas do cliente ──────────────────────────────────────────
// Lista as outras conversas do mesmo cliente (account_user_id), permitindo ao
// operador abrir qualquer uma com um clique. Responde à pergunta "como vejo o
// histórico do cliente" — antes só a IA tinha acesso a isso (CLAUDE.md §7.3).

interface PastConversation {
  id: string;
  status: string;
  subject: string | null;
  created_at: string;
  resolved_at: string | null;
}

const histStatusLabel: Record<string, string> = {
  open: "Aberta",
  pending: "Pendente",
  snoozed: "Adiada",
  resolved: "Resolvida",
};

function ConversationHistory({
  accountUserId,
  currentConversationId,
}: {
  accountUserId: string | null;
  currentConversationId: string;
}) {
  const setActiveConversationId = useInboxStore((s) => s.setActiveConversationId);
  const [items, setItems] = useState<PastConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Conversas do widget não têm account_user_id (cliente não vive no Supabase
    // do CloudDesk). Sem este guard, .eq("account_user_id", null) retornava 400
    // "invalid input syntax for type uuid: null" e poluía o console. Sem vínculo
    // de account não há histórico "por cliente" para listar aqui.
    if (!accountUserId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("desk_conversations")
      .select("id, status, subject, created_at, resolved_at")
      .eq("account_user_id", accountUserId)
      .neq("id", currentConversationId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn("[ClientInfoPanel] histórico falhou:", error.message);
        setItems((data ?? []) as PastConversation[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accountUserId, currentConversationId]);

  return (
    <div className="px-4 py-3 space-y-2.5">
      <SectionHeader icon={MessageSquare} title="Conversas anteriores" count={items.length} />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma conversa anterior deste cliente.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveConversationId(c.id)}
              className="w-full text-left rounded-md border border-border bg-card px-2.5 py-2 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-card-foreground truncate">
                  {c.subject || "Conversa"}
                </span>
                <span
                  className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded-full shrink-0",
                    c.status === "resolved"
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {histStatusLabel[c.status] ?? c.status}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatDateTimeBR(c.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactRow({
  icon: Icon,
  label,
  mono = false,
  onCopy,
}: {
  icon: typeof Mail;
  label: string;
  mono?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2 group">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span
        className={cn(
          "text-xs text-card-foreground truncate flex-1",
          mono && "font-mono text-[10px]"
        )}
      >
        {label}
      </span>
      <button
        onClick={onCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        title="Copiar"
      >
        <Copy className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon?: typeof Package;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {title}
      </h4>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

function PurchaseCard({ purchase }: { purchase: ClientPurchase }) {
  const status = purchaseStatusConfig[purchase.status] ?? purchaseStatusConfig.PENDING;
  const StatusIcon = status.icon;

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 space-y-1.5">
      {/* Product name + status */}
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-xs font-medium text-card-foreground leading-tight">
          {purchase.product_name ?? "Produto desconhecido"}
        </p>
        <Badge
          variant="outline"
          className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", status.cls)}
        >
          <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
          {status.label}
        </Badge>
      </div>

      {/* Amount + code */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-medium text-card-foreground">
          {formatCurrency(purchase.amount, purchase.currency)}
        </span>
        {purchase.purchase_code && (
          <span className="font-mono opacity-60">{purchase.purchase_code}</span>
        )}
      </div>

      {/* Pending deployment warning */}
      {purchase.pending_deployment && (
        <div className="flex items-center gap-1 text-[10px] text-amber-500">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          <span>Deploy pendente</span>
          {(purchase.deployment_retry_count ?? 0) > 0 && (
            <span className="opacity-70">· {purchase.deployment_retry_count} tentativa(s)</span>
          )}
        </div>
      )}

      {/* Subscription ID */}
      {purchase.stripe_subscription_id && (
        <p className="text-[10px] font-mono text-muted-foreground opacity-60 truncate">
          {purchase.stripe_subscription_id}
        </p>
      )}
    </div>
  );
}

function MetaGrid({
  conversation,
}: {
  conversation: ReturnType<typeof useInboxStore.getState>["conversations"][number];
}) {
  const priorityLabels: Record<string, string> = {
    urgent: "Urgente",
    high:   "Alta",
    medium: "Média",
    low:    "Baixa",
  };

  const statusLabels: Record<string, string> = {
    open:     "Aberta",
    pending:  "Pendente",
    snoozed:  "Adiada",
    resolved: "Resolvida",
  };

  const channelLabels: Record<string, string> = {
    chat:  "Chat",
    email: "E-mail",
  };

  return (
    <div className="space-y-1.5 text-xs">
      <MetaRow label="Canal" value={channelLabels[conversation.channel] ?? conversation.channel} />
      <MetaRow label="Status" value={statusLabels[conversation.status] ?? conversation.status} />
      <MetaRow label="Prioridade" value={priorityLabels[conversation.priority] ?? conversation.priority} />
      <MetaRow
        label="Criada"
        value={formatDateTimeBR(conversation.created_at)}
      />
      {conversation.sla_deadline && (
        <MetaRow
          label="SLA"
          value={formatDistanceToNow(new Date(conversation.sla_deadline), {
            addSuffix: true,
            locale: ptBR,
          })}
          highlight={new Date(conversation.sla_deadline) < new Date()}
        />
      )}
      {conversation.ai_active && (
        <MetaRow label="IA" value="Ativa" highlight />
      )}
    </div>
  );
}

/** Data curta pt-BR: "15/02/2026" (vazio → "—") */
function formatDateShortBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── GroupedResources ──────────────────────────────────────────────────────────
// Agrupa Assinaturas e Infraestruturas em um único bloco compacto e organizado,
// cada um com seu cabeçalho e contador. Mantém os dois grupos visualmente unidos
// (mesma seção, sem separador grosso entre eles) conforme a referência do print.

function GroupedResources({
  contactInfo,
  onCopyDomain,
}: {
  contactInfo: ContactInfo;
  onCopyDomain: (domain: string) => void;
}) {
  return (
    <div className="px-4 py-3 space-y-4">
      {contactInfo.subscriptions.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader icon={Building2} title="Assinaturas" count={contactInfo.subscriptions.length} />
          <div className="space-y-1.5">
            {contactInfo.subscriptions.map((sub, i) => (
              <SubscriptionCard key={sub.subscription_id || i} sub={sub} />
            ))}
          </div>
        </div>
      )}

      {contactInfo.infras.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader icon={Server} title="Infraestruturas" count={contactInfo.infras.length} />
          <div className="space-y-1.5">
            {contactInfo.infras.map((infra, i) => (
              <InfraCard
                key={infra.infra_id || i}
                infra={infra}
                onCopyDomain={() => infra.default_domain && onCopyDomain(infra.default_domain)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cobrança (Chargefy) ──────────────────────────────────────────────────────

const billingStatusStyle: Record<string, { label: string; cls: string; dotCls: string }> = {
  active:     { label: "Ativa",     cls: "border-emerald-500/30 text-emerald-500", dotCls: "bg-emerald-500" },
  trialing:   { label: "Teste",     cls: "border-sky-500/30 text-sky-500",         dotCls: "bg-sky-500"     },
  past_due:   { label: "Atrasada",  cls: "border-amber-500/30 text-amber-500",     dotCls: "bg-amber-500"   },
  unpaid:     { label: "Não paga",  cls: "border-rose-500/30 text-rose-500",       dotCls: "bg-rose-500"    },
  paused:     { label: "Pausada",   cls: "border-muted text-muted-foreground",     dotCls: "bg-muted-foreground" },
  canceled:   { label: "Cancelada", cls: "border-muted text-muted-foreground",     dotCls: "bg-muted-foreground" },
  incomplete: { label: "Pendente",  cls: "border-amber-500/30 text-amber-500",     dotCls: "bg-amber-500"   },
};

const invoiceStatusStyle: Record<string, { label: string; cls: string }> = {
  paid:          { label: "Paga",       cls: "border-emerald-500/30 text-emerald-500" },
  open:          { label: "Em aberto",  cls: "border-amber-500/30 text-amber-500"     },
  draft:         { label: "Rascunho",   cls: "border-muted text-muted-foreground"     },
  uncollectible: { label: "Incobrável", cls: "border-rose-500/30 text-rose-500"       },
  void:          { label: "Cancelada",  cls: "border-muted text-muted-foreground"     },
};

const intervalLabel: Record<string, string> = {
  month: "/mês", year: "/ano", week: "/sem", day: "/dia",
};

const methodLabel: Record<string, string> = {
  credit_card: "Cartão", pix: "PIX", boleto: "Boleto",
};

/** Link externo + botão de copiar — para 2ª via e comprovantes. */
function LinkAction({ url, label }: { url: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80"
      >
        {label}
      </a>
      <button
        type="button"
        onClick={() => copyToClipboard(url, label)}
        title={`Copiar link — ${label}`}
        className="opacity-50 hover:opacity-100 transition-opacity"
      >
        <Copy className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function BillingSubCard({ sub }: { sub: BillingSubscription }) {
  const st = billingStatusStyle[sub.status] ?? {
    label: sub.status || "—", cls: "border-muted text-muted-foreground", dotCls: "bg-muted-foreground",
  };
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-card-foreground truncate">{sub.product_name}</p>
        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", st.cls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full mr-1", st.dotCls)} />
          {st.label}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="font-medium text-card-foreground">
          {formatCurrency(sub.amount, sub.currency)}{intervalLabel[sub.interval] ?? ""}
        </span>
        {sub.quantity > 1 && <><span className="opacity-40">·</span><span>{sub.quantity}x</span></>}
        {sub.next_billing_at && (
          <><span className="opacity-40">·</span><span>Renova {formatDateShortBR(sub.next_billing_at)}</span></>
        )}
      </div>
      {sub.trial_end && (
        <p className="text-[10px] text-sky-500">Teste até {formatDateShortBR(sub.trial_end)}</p>
      )}
      {sub.cancel_at_period_end && (
        <p className="text-[10px] text-amber-500">
          Cancelamento agendado — acesso até {formatDateShortBR(sub.cancel_at ?? sub.current_period_end)}
        </p>
      )}
      {sub.has_pending_update && (
        <p className="text-[10px] text-amber-500">Alteração de plano agendada</p>
      )}
    </div>
  );
}

function BillingInvoiceCard({ inv }: { inv: BillingInvoice }) {
  const st = invoiceStatusStyle[inv.status] ?? { label: inv.status || "—", cls: "border-muted text-muted-foreground" };
  const overdue = inv.amount_due > 0 && !!inv.due_date && new Date(inv.due_date) < new Date();
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-card-foreground font-mono truncate">{inv.number}</span>
        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", st.cls)}>
          {st.label}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="font-medium text-card-foreground">{formatCurrency(inv.amount_total, inv.currency)}</span>
        {inv.amount_due > 0 && (
          <><span className="opacity-40">·</span>
          <span className={overdue ? "text-rose-500 font-medium" : "text-amber-500"}>
            {overdue ? "Vencida" : "Em aberto"} {formatCurrency(inv.amount_due, inv.currency)}
          </span></>
        )}
        {inv.due_date && <><span className="opacity-40">·</span><span>Venc. {formatDateShortBR(inv.due_date)}</span></>}
        {inv.paid_at && <><span className="opacity-40">·</span><span>Paga {formatDateShortBR(inv.paid_at)}</span></>}
      </div>
      {(inv.interest_amount > 0 || inv.late_fee_amount > 0 || inv.credit_applied > 0) && (
        <div className="flex flex-wrap gap-x-1.5 text-[10px] text-muted-foreground">
          {inv.interest_amount > 0 && <span>Juros {formatCurrency(inv.interest_amount, inv.currency)}</span>}
          {inv.late_fee_amount > 0 && <span>Multa {formatCurrency(inv.late_fee_amount, inv.currency)}</span>}
          {inv.credit_applied > 0 && <span>Crédito {formatCurrency(inv.credit_applied, inv.currency)}</span>}
        </div>
      )}
      {(inv.hosted_url || inv.pdf_url) && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {inv.hosted_url && <LinkAction url={inv.hosted_url} label="2ª via" />}
          {inv.pdf_url && <LinkAction url={inv.pdf_url} label="PDF" />}
        </div>
      )}
    </div>
  );
}

function BillingChargeCard({ chg }: { chg: BillingCharge }) {
  const ok = chg.paid;
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-card-foreground">
          {formatCurrency(chg.amount, chg.currency)}
        </span>
        <Badge
          variant="outline"
          className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border",
            ok ? "border-emerald-500/30 text-emerald-500" : "border-rose-500/30 text-rose-500")}
        >
          {ok ? "Aprovado" : chg.status === "canceled" ? "Cancelado" : "Recusado"}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>{formatDateShortBR(chg.created_at)}</span>
        <span className="opacity-40">·</span>
        <span>{methodLabel[chg.method] ?? chg.method ?? "—"}</span>
        {chg.card_brand && chg.card_last4 && (
          <><span className="opacity-40">·</span><span className="capitalize">{chg.card_brand} ••{chg.card_last4}</span></>
        )}
        {chg.installments && chg.installments > 1 && (
          <><span className="opacity-40">·</span><span>{chg.installments}x</span></>
        )}
      </div>
      {chg.error_message && (
        <p className="text-[10px] text-rose-500 [overflow-wrap:anywhere]">{chg.error_message}</p>
      )}
      {chg.receipt_url && <LinkAction url={chg.receipt_url} label="Comprovante" />}
    </div>
  );
}

function BillingSection({ billing }: { billing: BillingInfo }) {
  const hasAny =
    billing.subscriptions.length > 0 || billing.invoices.length > 0 || billing.charges.length > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      {billing.subscriptions.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader icon={CreditCard} title="Cobrança" count={billing.subscriptions.length} />
          <div className="space-y-1.5">
            {billing.subscriptions.map((s, i) => <BillingSubCard key={i} sub={s} />)}
          </div>
        </div>
      )}

      {billing.invoices.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader icon={Package} title="Faturas" count={billing.invoices.length} />
          <div className="space-y-1.5">
            {billing.invoices.map((inv, i) => <BillingInvoiceCard key={inv.number || i} inv={inv} />)}
          </div>
        </div>
      )}

      {billing.charges.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader icon={CheckCircle2} title="Pagamentos" count={billing.charges.length} />
          <div className="space-y-1.5">
            {billing.charges.map((c, i) => <BillingChargeCard key={i} chg={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function SubscriptionCard({ sub }: { sub: ContactSubscription }) {
  const style = deploymentStatusStyle(sub.infra_status);
  const plan = planLabel(sub) ?? sub.product ?? "Assinatura";

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-card-foreground leading-tight truncate">{plan}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
          <span>Desde {formatDateShortBR(sub.created_at)}</span>
          {sub.mrr > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-medium text-card-foreground">{formatCurrency(sub.mrr, "BRL")}</span>
            </>
          )}
        </div>
      </div>
      <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", style.cls)}>
        <span className={cn("h-1.5 w-1.5 rounded-full mr-1", style.dotCls)} />
        {style.label}
      </Badge>
    </div>
  );
}

function InfraCard({ infra, onCopyDomain }: { infra: ContactInfra; onCopyDomain: () => void }) {
  const style = deploymentStatusStyle(infra.status);
  const name = infra.default_domain || infra.purchase_code || "Infraestrutura";

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 flex items-center justify-between gap-2 group">
      <div className="flex items-center gap-1.5 min-w-0">
        <Server className="h-3 w-3 text-muted-foreground shrink-0" />
        <p className="text-xs font-medium text-card-foreground truncate">{name}</p>
        {infra.default_domain && (
          <button
            onClick={onCopyDomain}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted shrink-0"
            title="Copiar domínio"
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
      <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 border", style.cls)}>
        <span className={cn("h-1.5 w-1.5 rounded-full mr-1", style.dotCls)} />
        {style.label}
      </Badge>
    </div>
  );
}

// ─── Correção 3: painel para visitante sem conta cadastrada ───────────────────

function UnknownContactPanel({
  conversation,
  email,
  contactInfo,
}: {
  conversation: ReturnType<typeof useInboxStore.getState>["conversations"][number];
  email: string | null;
  contactInfo: ContactInfo | null;
}) {
  const name =
    contactInfo?.customer?.name || conversation.contact?.name || conversation.subject || "Visitante";
  const avatarColor = nameToHsl(name);
  const abbr = initials(name, email);
  const identified = !!contactInfo?.customer || (contactInfo?.subscriptions?.length ?? 0) > 0;

  return (
    <div className="space-y-0">
      {/* Avatar + identidade */}
      <div className="p-4 flex flex-col items-center text-center gap-1.5">
        <div
          className="h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-lg select-none"
          style={{ backgroundColor: avatarColor }}
        >
          {abbr}
        </div>
        <h3 className="text-sm font-semibold text-card-foreground leading-tight">{name}</h3>
        {!identified && (
          <p className="text-[10px] text-muted-foreground italic">Cliente não identificado no sistema</p>
        )}
      </div>

      {/* Email (quando salvo na conversa) */}
      {email && (
        <div className="px-4 pb-3">
          <ContactRow icon={Mail} label={email} onCopy={() => copyToClipboard(email, "E-mail")} />
        </div>
      )}

      {/* Assinaturas + Infraestruturas do CRM */}
      {contactInfo && (contactInfo.subscriptions.length > 0 || contactInfo.infras.length > 0) && (
        <>
          <Separator />
          <GroupedResources contactInfo={contactInfo} onCopyDomain={(d) => copyToClipboard(d, "Domínio")} />
        </>
      )}

      {/* Cobrança (Chargefy) — só para clientes já migrados */}
      {contactInfo?.billing && (
        <>
          <Separator />
          <BillingSection billing={contactInfo.billing} />
        </>
      )}

      <Separator />

      {/* Histórico de conversas do cliente */}
      <ConversationHistory
        accountUserId={conversation.account_user_id}
        currentConversationId={conversation.id}
      />

      <Separator />

      {/* Metadados da conversa */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionHeader icon={MessageSquare} title="Conversa" />
        <div className="space-y-1.5 text-xs">
          <MetaRow label="Canal" value={conversation.channel === "email" ? "E-mail" : "Chat"} />
          <MetaRow label="Iniciado em" value={formatDateTimeBR(conversation.created_at)} />
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          "text-right truncate",
          highlight ? "text-amber-500 font-medium" : "text-card-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ClientInfoSkeleton() {
  return (
    <div className="p-4 space-y-4">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Separator />
      {/* Contact rows */}
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
      <Separator />
      {/* Purchases */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
