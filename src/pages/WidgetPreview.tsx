import { useEffect, useRef, useState } from "react";
import { ChatBubbleButton } from "@/components/widget/ChatBubbleButton";
import { ChatWidget } from "@/components/widget/ChatWidget";
import { useWidgetStore } from "@/components/widget/useWidgetStore";
import { DEFAULT_SETTINGS } from "@/components/widget/types";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ContactInfo } from "@/lib/contact-info";

const DEFAULT_EMAIL = "nexamarketingdigital@gmail.com";

const mockSettings = {
  ...DEFAULT_SETTINGS,
  greeting: "Como podemos ajudar?",
  widget_name: "CloudDesk",
  quick_actions: ["Problema técnico", "Dúvida sobre plano", "Minha infraestrutura"],
};

export default function WidgetPreview() {
  const { setAccount, setConversation, setMessages } = useWidgetStore();

  const [emailInput, setEmailInput]   = useState(DEFAULT_EMAIL);
  const [activeEmail, setActiveEmail] = useState(DEFAULT_EMAIL);
  const [clientName, setClientName]   = useState("Caio Maciel Martens");
  const [stripeId, setStripeId]       = useState("cus_U22qgKOnfsRl5E");
  const [status, setStatus]           = useState<"idle" | "loading" | "ok" | "notfound" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Apply a new email: fetch from get-contact-info and update widget account
  const applyEmail = async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setStatus("loading");
    setActiveEmail(trimmed);

    // Reset widget state so new conversation starts fresh
    setConversation(null);
    setMessages([]);

    try {
      const { data, error } = await supabase.functions.invoke<ContactInfo>(
        "get-contact-info",
        { body: { email: trimmed } },
      );

      if (error) throw error;

      const name       = data?.customer?.name       || trimmed;
      const customerId = data?.customer?.customer_id || "";

      setClientName(name);
      setStripeId(customerId);

      // WidgetAccount needs id + user_id (Supabase UUIDs, not returned by get-contact-info).
      // For preview we derive a stable fake UUID from the email so the widget
      // behaves consistently across re-applies of the same email.
      const fakeUuid = emailToFakeUuid(trimmed);

      setAccount({
        id:                fakeUuid,
        user_id:           fakeUuid,
        name,
        email:             trimmed,
        phone:             null,
        stripe_customer_id: customerId || null,
      });

      setStatus(data?.customer ? "ok" : "notfound");
    } catch {
      setStatus("error");
      // Keep widget account updated with whatever we know
      const fakeUuid = emailToFakeUuid(trimmed);
      setAccount({
        id: fakeUuid, user_id: fakeUuid,
        name: trimmed, email: trimmed,
        phone: null, stripe_customer_id: null,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") applyEmail(emailInput);
  };

  // Apply default on mount
  useEffect(() => {
    applyEmail(DEFAULT_EMAIL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusBadge = {
    idle:     null,
    loading:  <span className="text-[11px] text-muted-foreground animate-pulse">Buscando...</span>,
    ok:       <span className="text-[11px] text-emerald-500">✓ Cliente encontrado</span>,
    notfound: <span className="text-[11px] text-amber-500">⚠ Não encontrado no CRM — widget usa email como nome</span>,
    error:    <span className="text-[11px] text-rose-500">✗ Erro ao buscar — verifique o email</span>,
  }[status];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto py-16 px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Preview do Widget — CloudDesk</h1>
          <p className="text-sm text-muted-foreground">
            Esta página simula o site da Cloudfy onde o cliente está logado. O widget aparece no canto inferior direito.
          </p>
        </div>

        <div className="grid gap-4">
          {/* ── Client area ── */}
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Área logada do cliente</h2>

            {/* Email switcher */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email do cliente (teste)
              </label>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="email@exemplo.com"
                  className="h-9 text-sm font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  size="sm"
                  className="h-9 px-4 shrink-0"
                  onClick={() => applyEmail(emailInput)}
                  disabled={status === "loading"}
                >
                  Aplicar
                </Button>
              </div>
              <div className="h-4">{statusBadge}</div>
            </div>

            {/* Client info */}
            <p className="text-sm text-muted-foreground">
              O cliente autenticado é{" "}
              <strong className="text-foreground">{clientName}</strong>{" "}
              (<span className="font-mono text-xs">{activeEmail}</span>).
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-muted p-3">
                <span className="text-muted-foreground">Stripe ID</span>
                <p className="font-mono text-foreground text-xs mt-1 truncate">
                  {stripeId || "—"}
                </p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <span className="text-muted-foreground">Status</span>
                <p className="text-foreground mt-1">
                  {status === "ok" ? "Autenticado ✓" : status === "loading" ? "Carregando..." : "Simulado"}
                </p>
              </div>
            </div>
          </div>

          {/* ── Instructions ── */}
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">Comportamento esperado</h2>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>Clique no ícone 💬 no canto inferior direito para abrir o widget</li>
              <li>O widget usa o nome e email do cliente aplicado acima</li>
              <li>Trocar o email reseta a conversa — nova mensagem cria nova thread</li>
              <li>Quick actions iniciam uma conversa imediatamente</li>
              <li>A IA responde automaticamente via Edge Function</li>
              <li>Botão "Falar com humano" escala para operador na inbox</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Widget overlay */}
      <ChatWidget settings={mockSettings} />
      <ChatBubbleButton />
    </div>
  );
}

// Derives a stable fake UUID v4-shaped string from an email.
// Used only in preview — not persisted, not sent to production auth.
function emailToFakeUuid(email: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0").repeat(4);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
