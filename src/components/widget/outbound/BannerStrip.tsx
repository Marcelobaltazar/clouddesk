import { X, ExternalLink } from "lucide-react";
import type { BannerContent, BannerStyle } from "@/lib/outbound";

interface Props {
  content: BannerContent;
  isTest?: boolean;
  onCta?: () => void;
  onDismiss?: () => void;
  /** pill — versão compacta flutuando acima da bolha com o widget fechado. */
  variant?: "strip" | "pill";
}

const STYLES: Record<BannerStyle, string> = {
  info:    "bg-sky-500/12 text-sky-800 border-sky-500/30 [&_.cd-cta]:text-sky-800",
  success: "bg-emerald-500/12 text-emerald-800 border-emerald-500/30 [&_.cd-cta]:text-emerald-800",
  warning: "bg-amber-500/15 text-amber-800 border-amber-500/35 [&_.cd-cta]:text-amber-800",
  promo:   "bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 text-violet-800 border-violet-500/30 [&_.cd-cta]:text-violet-800",
  danger:  "bg-rose-500/12 text-rose-800 border-rose-500/30 [&_.cd-cta]:text-rose-800",
};

/**
 * Banner — faixa fixada no topo do widget. Puro: serve ao widget, à pílula
 * flutuante e à prévia do editor.
 */
export function BannerStrip({ content, isTest, onCta, onDismiss, variant = "strip" }: Props) {
  const hasCta = !!content.cta_label?.trim() && !!content.cta_url;
  const tone = STYLES[content.style] ?? STYLES.info;

  return (
    <div
      role="status"
      className={`flex items-start gap-2 border text-[12px] leading-snug ${tone} ${
        variant === "pill"
          ? "rounded-2xl px-3 py-2 shadow-lg bg-card"
          : "border-x-0 border-t-0 px-3.5 py-2"
      }`}
    >
      {content.emoji && (
        <span className="shrink-0 text-[14px] leading-[1.3]" aria-hidden="true">{content.emoji}</span>
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium [overflow-wrap:anywhere]">{content.text}</span>
        {hasCta && (
          <>
            {" "}
            <button
              type="button"
              onClick={onCta}
              className="cd-cta inline-flex items-center gap-0.5 font-semibold underline decoration-1 underline-offset-2 opacity-90 hover:opacity-100"
            >
              {content.cta_label}
              <ExternalLink className="h-3 w-3" />
            </button>
          </>
        )}
        {isTest && (
          <span className="ml-1.5 rounded-full border border-current px-1.5 text-[9px] font-semibold uppercase tracking-wide opacity-60">
            Prévia
          </span>
        )}
      </div>
      {content.dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 -mr-1 -mt-0.5 h-6 w-6 rounded-md opacity-60 hover:opacity-100 hover:bg-black/5 flex items-center justify-center transition-all"
          aria-label="Fechar banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
