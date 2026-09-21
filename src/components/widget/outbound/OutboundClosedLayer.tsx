import { useEffect, useRef } from "react";
import { useWidgetStore } from "../useWidgetStore";
import { NoticeCard } from "./NoticeCard";
import { BannerStrip } from "./BannerStrip";
import { runBannerCta, runNoticeCta } from "./campaignActions";
import { selectBanner, selectPopupNotice, trackCampaign, useCurrentHref } from "./useOutbound";

/**
 * O que os Disparos mostram com o widget FECHADO — que é como ele fica quase o
 * tempo todo. Sem isto, avisos e banners só alcançariam quem abre o chat.
 *
 * No máximo UMA coisa flutuando por vez, nesta ordem:
 *   1. aviso de resposta da equipe (ChatWidgetNotice) — suporte vence marketing;
 *   2. popup de aviso (notice com display=popup);
 *   3. pílula do banner (banner com show_when_closed).
 * Um tour em andamento esconde tudo isto: a atenção está na página.
 */
export function OutboundClosedLayer() {
  const isOpen = useWidgetStore((s) => s.isOpen);
  const messageNotice = useWidgetStore((s) => s.notice);
  const activeTour = useWidgetStore((s) => s.activeTour);
  const campaigns = useWidgetStore((s) => s.campaigns);
  const href = useCurrentHref();

  const popup = selectPopupNotice(campaigns, href);
  const banner = selectBanner(campaigns, href);
  const showPopup = !isOpen && !messageNotice && !activeTour && !!popup;
  const showPill = !isOpen && !messageNotice && !activeTour && !popup && !!banner?.content.show_when_closed;

  // "Viu" = apareceu na tela. Uma vez por disparo por carga de página.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const shown = showPopup ? popup : showPill ? banner : null;
    if (!shown || seen.current.has(shown.id)) return;
    seen.current.add(shown.id);
    if (!shown.receipt?.seen) trackCampaign(shown.id, "seen");
  }, [showPopup, showPill, popup, banner]);

  if (showPopup && popup) {
    return (
      <div className="fixed bottom-24 right-6 z-[9997] w-[340px] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-2 fade-in-0 duration-300">
        <NoticeCard
          content={popup.content}
          sender={popup.sender}
          variant="popup"
          isTest={popup.is_test}
          onCta={() => runNoticeCta(popup.id, popup.content)}
          onDismiss={() => trackCampaign(popup.id, "dismiss")}
        />
      </div>
    );
  }

  if (showPill && banner) {
    return (
      <div className="fixed bottom-24 right-6 z-[9997] w-[320px] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-2 fade-in-0 duration-300">
        <BannerStrip
          content={banner.content}
          variant="pill"
          isTest={banner.is_test}
          onCta={() => runBannerCta(banner.id, banner.content)}
          onDismiss={() => trackCampaign(banner.id, "dismiss")}
        />
      </div>
    );
  }

  return null;
}
