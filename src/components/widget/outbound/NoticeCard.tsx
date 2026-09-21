import { X, ArrowRight, MessageCircle, Compass } from "lucide-react";
import type { NoticeContent, CampaignSender } from "@/lib/outbound";
import { WidgetMarkdown } from "../WidgetMarkdown";
import { SenderAvatar, DEFAULT_SENDER_NAME } from "./SenderAvatar";
import { PreviewTag } from "./PreviewTag";

interface Props {
  content: NoticeContent;
  sender: CampaignSender | null;
  /** popup — flutuando sobre a página; card — dentro da lista do widget. */
  variant: "popup" | "card";
  isTest?: boolean;
  onCta?: () => void;
  onDismiss?: () => void;
}

/**
 * Aviso — o "Post" do Intercom: um recado curto assinado por alguém da equipe.
 * Puro (props → JSX): o mesmo componente desenha o popup na página do cliente,
 * o card dentro do widget e a prévia do editor no painel.
 */
export function NoticeCard({ content, sender, variant, isTest, onCta, onDismiss }: Props) {
  const senderName = sender?.name || DEFAULT_SENDER_NAME;
  const hasCta = !!content.cta_label?.trim();
  const action = content.cta_action ?? "link";
  const CtaIcon = action === "open_chat" ? MessageCircle : action === "start_tour" ? Compass : ArrowRight;

  return (
    <div
      className={
        variant === "popup"
          ? "relative rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
          : "relative rounded-xl border border-primary/25 bg-primary/5 overflow-hidden"
      }
      role="status"
    >
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="absolute top-2 right-2 z-10 h-6 w-6 rounded-md text-muted-foreground hover:bg-accent/20 hover:text-foreground flex items-center justify-center transition-colors"
          aria-label="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {content.image_url && (
        <img
          src={content.image_url}
          alt=""
          className="w-full max-h-40 object-cover"
          loading="lazy"
        />
      )}

      <div className="p-3.5 pr-8">
        <div className="flex items-center gap-2 mb-2">
          <SenderAvatar sender={sender} size={26} />
          <div className="min-w-0 leading-tight">
            <p className="text-[11px] font-semibold text-foreground truncate">{senderName}</p>
            <p className="text-[10px] text-muted-foreground">Cloudfy</p>
          </div>
          {isTest && <PreviewTag />}
        </div>

        {content.title && (
          <h4 className="text-sm font-semibold text-foreground leading-snug mb-1">{content.title}</h4>
        )}
        {content.body && (
          <div className="text-foreground/90">
            <WidgetMarkdown content={content.body} />
          </div>
        )}

        {hasCta && (
          <button
            type="button"
            onClick={onCta}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150"
          >
            {content.cta_label}
            <CtaIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
