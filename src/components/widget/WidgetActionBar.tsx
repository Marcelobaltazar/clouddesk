import { useState } from "react";
import { KeyRound, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ContactInfra } from "@/lib/contact-info";

interface Props {
  infras: ContactInfra[];
}

type SendState = "idle" | "loading" | "done" | "error" | "no_infra";

interface ResendResult {
  success?: boolean;
  error?: string;
}

const NO_INFRA_MESSAGE =
  "Não encontramos uma infraestrutura ativa na sua conta. Descreva o problema no chat que a nossa equipe verifica o status do seu provisionamento.";

export function WidgetActionBar({ infras }: Props) {
  const [state, setState] = useState<SendState>("idle");
  const [picking, setPicking] = useState(false);

  const usable = infras.filter((i) => i.infra_id);

  const resend = async (infraId: string) => {
    setPicking(false);
    setState("loading");
    try {
      const { data, error } = await supabase.functions.invoke<ResendResult>(
        "desk-resend-credentials",
        { body: { infra_id: infraId } },
      );
      if (error || !data?.success) {
        console.error("[Widget] resend-credentials falhou:", error?.message ?? data?.error);
        setState("error");
        return;
      }
      setState("done");
    } catch (err) {
      console.error("[Widget] resend-credentials erro:", err);
      setState("error");
    }
  };

  const handleClick = () => {
    if (state === "loading" || state === "done") return;
    if (usable.length === 0) {
      // No provisioned infra — guide the client to support instead of failing silently
      setState("no_infra");
    } else if (usable.length === 1) {
      resend(usable[0].infra_id);
    } else {
      // Multiple infras — let the client pick which one
      setPicking((p) => !p);
    }
  };

  const label =
    state === "done"    ? "Credenciais enviadas!" :
    state === "loading" ? "Enviando..." :
    state === "error"   ? "Falhou — tentar de novo" :
    "Reenviar minhas credenciais";

  return (
    <div className="px-3 pt-2 border-t border-border bg-card">
      {/* No-infra notice */}
      {state === "no_infra" && (
        <p className="mb-2 text-[11px] text-amber-500 px-1">{NO_INFRA_MESSAGE}</p>
      )}

      {/* Infra picker (only when multiple) */}
      {picking && usable.length > 1 && (
        <div className="mb-2 space-y-1">
          <p className="text-[11px] text-muted-foreground px-1">Para qual infraestrutura?</p>
          {usable.map((infra) => (
            <button
              key={infra.infra_id}
              onClick={() => resend(infra.infra_id)}
              className="w-full text-left rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              {infra.purchase_code || infra.infra_id}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={state === "loading" || state === "done"}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-70 disabled:cursor-default transition-colors"
      >
        {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" />
          : state === "done"  ? <Check className="h-4 w-4" />
          : state === "error" ? <X className="h-4 w-4" />
          : <KeyRound className="h-4 w-4" />}
        {label}
      </button>
    </div>
  );
}
