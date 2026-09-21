/**
 * useOutbound.ts — Runtime dos Disparos no widget.
 *
 * Responsabilidades:
 *   • carregar os disparos elegíveis do cliente (gateway) na carga da página,
 *     ao voltar o foco e quando o painel publica algo (broadcast Realtime);
 *   • saber em que página o cliente está (o público por URL é avaliado aqui,
 *     porque o app do host navega sem recarregar);
 *   • registrar o que o cliente fez (viu/clicou/fechou/…), refletindo na hora
 *     no estado local e mandando para o servidor em segundo plano;
 *   • escolher o que aparece em cada lugar (popup, banner, feed, tour).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { widgetApi } from "@/lib/widget-api";
import {
  matchesUrlPattern,
  isBanner,
  isNews,
  isNotice,
  isTour,
  type CampaignEvent,
  type BannerContent,
  type NewsContent,
  type NoticeContent,
  type TourContent,
  type WidgetCampaign,
} from "@/lib/outbound";
import { useWidgetStore } from "../useWidgetStore";

// ─── Página atual ─────────────────────────────────────────────────────────────
// O app do host pode ser SPA: pushState/replaceState não disparam evento
// nenhum. Envolvemos os dois UMA vez e anunciamos num evento próprio.

const LOCATION_EVENT = "clouddesk:locationchange";
let historyPatched = false;

function patchHistory() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(LOCATION_EVENT));
      return result;
    };
  }
}

function subscribeLocation(onChange: () => void): () => void {
  patchHistory();
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener(LOCATION_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(LOCATION_EVENT, onChange);
  };
}

function getHref(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}

/** URL atual da página do host, atualizada a cada navegação (inclusive SPA). */
export function useCurrentHref(): string {
  return useSyncExternalStore(subscribeLocation, getHref, () => "");
}

// ─── Carga ────────────────────────────────────────────────────────────────────

/** Tópico de broadcast em que o painel avisa "publiquei/pausei um disparo". */
export const OUTBOUND_LIVE_TOPIC = "outbound-live";

export function useLoadCampaigns(enabled: boolean) {
  const setCampaigns = useWidgetStore((s) => s.setCampaigns);

  const reload = useCallback(async () => {
    try {
      const { campaigns } = await widgetApi.campaigns();
      setCampaigns(campaigns);
    } catch (err) {
      console.warn("[CloudDesk] falha ao carregar disparos:", err);
    }
  }, [setCampaigns]);

  useEffect(() => {
    if (!enabled) return;
    void reload();

    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Publicou no painel → todo widget aberto recarrega na hora. Best-effort:
    // o foco da aba cobre quem perdeu o evento.
    const channel = supabase
      .channel(OUTBOUND_LIVE_TOPIC)
      .on("broadcast", { event: "campaigns_changed" }, () => void reload())
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [enabled, reload]);

  return reload;
}

// ─── Eventos ──────────────────────────────────────────────────────────────────

/**
 * Registra o que o cliente fez. Atualiza o estado local primeiro (a UI some/
 * muda na hora) e manda para o servidor sem bloquear; se a rede falhar, o
 * próximo carregamento traz o estado real.
 */
export function trackCampaign(
  campaignId: string,
  event: CampaignEvent,
  extra: { step?: number; reaction?: string | null } = {},
) {
  const store = useWidgetStore.getState();
  switch (event) {
    case "seen":     store.applyCampaignReceipt(campaignId, { seen: true }); break;
    case "click":    store.applyCampaignReceipt(campaignId, { seen: true, clicked: true }); break;
    case "dismiss":  store.applyCampaignReceipt(campaignId, { seen: true, dismissed: true }); break;
    case "complete": store.applyCampaignReceipt(campaignId, { seen: true, completed: true, step_reached: extra.step ?? null }); break;
    case "step":     store.applyCampaignReceipt(campaignId, { seen: true, step_reached: extra.step ?? null }); break;
    case "react":    store.applyCampaignReceipt(campaignId, { seen: true, reaction: extra.reaction ?? null }); break;
  }
  void widgetApi.campaignEvent(campaignId, event, extra).catch((err) => {
    console.warn("[CloudDesk] evento de disparo não registrado:", err);
  });
}

// ─── Seleção do que aparece onde ──────────────────────────────────────────────

export type NoticeCampaign = WidgetCampaign & { type: "notice"; content: NoticeContent };
export type NewsCampaign = WidgetCampaign & { type: "news"; content: NewsContent };
export type BannerCampaign = WidgetCampaign & { type: "banner"; content: BannerContent };
export type TourCampaign = WidgetCampaign & { type: "tour"; content: TourContent };

function onPage(c: WidgetCampaign, href: string): boolean {
  return matchesUrlPattern(c.url_pattern, href);
}

function byPriority(a: WidgetCampaign, b: WidgetCampaign): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return (b.published_at ?? "").localeCompare(a.published_at ?? "");
}

/** Avisos ainda não fechados/clicados nesta página, mais importantes primeiro. */
export function selectNotices(campaigns: WidgetCampaign[], href: string): NoticeCampaign[] {
  return campaigns
    .filter((c): c is NoticeCampaign => isNotice(c))
    .filter((c) => !c.receipt?.dismissed && !c.receipt?.clicked && onPage(c, href))
    .sort(byPriority);
}

/** O popup flutuante (widget fechado): só avisos do tipo popup, um por vez. */
export function selectPopupNotice(campaigns: WidgetCampaign[], href: string): NoticeCampaign | null {
  return selectNotices(campaigns, href).find((c) => c.content.display === "popup") ?? null;
}

/** O único banner exibido no momento (maior prioridade, mais recente). */
export function selectBanner(campaigns: WidgetCampaign[], href: string): BannerCampaign | null {
  return (
    campaigns
      .filter((c): c is BannerCampaign => isBanner(c))
      .filter((c) => !c.receipt?.dismissed && onPage(c, href))
      .sort(byPriority)[0] ?? null
  );
}

/** Feed de novidades: todas (o histórico é o objetivo), mais recentes primeiro. */
export function selectNews(campaigns: WidgetCampaign[]): NewsCampaign[] {
  return campaigns
    .filter((c): c is NewsCampaign => isNews(c))
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

/** Tours que aparecem no feed com "Iniciar tour". */
export function selectListedTours(campaigns: WidgetCampaign[]): TourCampaign[] {
  return campaigns
    .filter((c): c is TourCampaign => isTour(c))
    .filter((c) => c.content.list_in_news && c.content.steps.length > 0)
    .sort(byPriority);
}

export function findTour(campaigns: WidgetCampaign[], id: string): TourCampaign | null {
  const c = campaigns.find((x) => x.id === id);
  return c && isTour(c) ? (c as TourCampaign) : null;
}

/** Novidades que o cliente ainda não viu — badge da aba e ponto na bolha. */
export function countUnreadNews(campaigns: WidgetCampaign[]): number {
  return selectNews(campaigns).filter((c) => !c.receipt?.seen).length;
}

/** Tour que deve começar sozinho nesta página, se houver. */
export function selectAutoStartTour(campaigns: WidgetCampaign[], href: string): TourCampaign | null {
  return (
    campaigns
      .filter((c): c is TourCampaign => isTour(c))
      .filter((c) => c.content.auto_start && c.content.steps.length > 0)
      .filter((c) => !c.receipt?.completed && !c.receipt?.dismissed)
      .filter((c) => !tourLocallyDone(c.id))
      .filter((c) => onPage(c, href) && matchesUrlPattern(c.content.start_url, href))
      .sort(byPriority)[0] ?? null
  );
}

// ─── Progresso local do tour ──────────────────────────────────────────────────
// O tour atravessa navegações (a página recarrega, o widget sobe de novo), então
// o passo atual vive no localStorage. "done" evita reabrir no mesmo navegador
// antes de o receipt do servidor voltar.

const TOUR_KEY = (id: string) => `clouddesk-tour:${id}`;
const TOUR_DONE_KEY = (id: string) => `clouddesk-tour-done:${id}`;

export function saveTourProgress(id: string, step: number) {
  try { localStorage.setItem(TOUR_KEY(id), String(step)); } catch { /* indisponível */ }
}

export function readTourProgress(id: string): number | null {
  try {
    const raw = localStorage.getItem(TOUR_KEY(id));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function clearTourProgress(id: string, markDone: boolean) {
  try {
    localStorage.removeItem(TOUR_KEY(id));
    if (markDone) localStorage.setItem(TOUR_DONE_KEY(id), "1");
  } catch { /* indisponível */ }
}

export function tourLocallyDone(id: string): boolean {
  try { return localStorage.getItem(TOUR_DONE_KEY(id)) === "1"; } catch { return false; }
}

/** Tour interrompido por uma navegação, para retomar de onde parou. */
export function findResumableTour(campaigns: WidgetCampaign[]): { tour: TourCampaign; step: number } | null {
  for (const c of campaigns) {
    if (!isTour(c)) continue;
    const step = readTourProgress(c.id);
    if (step === null) continue;
    if (c.receipt?.completed || c.receipt?.dismissed) {
      clearTourProgress(c.id, false);
      continue;
    }
    if (step < c.content.steps.length) return { tour: c as TourCampaign, step };
    clearTourProgress(c.id, false);
  }
  return null;
}
