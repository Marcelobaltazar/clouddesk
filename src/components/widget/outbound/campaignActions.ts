/**
 * campaignActions.ts — O que acontece quando o cliente clica no botão de um
 * disparo. Compartilhado pelo popup (widget fechado), pelo card na lista e
 * pelo banner, para os três se comportarem igual.
 */

import type { NoticeContent, BannerContent } from "@/lib/outbound";
import { useWidgetStore } from "../useWidgetStore";
import { trackCampaign, clearTourProgress } from "./useOutbound";

function openExternal(url: string | null | undefined) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Começa um tour guiado: fecha o widget (o tour roda sobre a página) e zera o progresso. */
export function startTour(campaignId: string) {
  const store = useWidgetStore.getState();
  clearTourProgress(campaignId, false);
  store.setOpen(false);
  store.setActiveTour({ campaignId, stepIndex: 0 });
}

export function runNoticeCta(campaignId: string, content: NoticeContent) {
  trackCampaign(campaignId, "click");
  const store = useWidgetStore.getState();
  switch (content.cta_action ?? "link") {
    case "open_chat":
      store.setView("list");
      store.setOpen(true);
      break;
    case "start_tour":
      if (content.cta_tour_id) startTour(content.cta_tour_id);
      break;
    default:
      openExternal(content.cta_url);
  }
}

export function runBannerCta(campaignId: string, content: BannerContent) {
  trackCampaign(campaignId, "click");
  openExternal(content.cta_url);
}
