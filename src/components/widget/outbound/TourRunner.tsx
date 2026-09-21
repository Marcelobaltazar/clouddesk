import { useCallback, useEffect, useRef } from "react";
import { useWidgetStore } from "../useWidgetStore";
import { TourOverlay } from "./TourOverlay";
import {
  clearTourProgress,
  findResumableTour,
  findTour,
  saveTourProgress,
  selectAutoStartTour,
  trackCampaign,
  useCurrentHref,
} from "./useOutbound";

/** Espera após a carga para o tour começar sozinho — a tela precisa assentar
 *  e o cliente precisa ter visto onde está antes de ser guiado. */
const AUTO_START_DELAY_MS = 1500;

/**
 * Dono do tour em andamento. Montado sempre (o tour roda com o widget fechado):
 *   • retoma um tour interrompido por navegação (progresso no localStorage);
 *   • inicia sozinho o tour configurado para a página atual (auto_start);
 *   • traduz os eventos do overlay em progresso salvo + receipts no servidor.
 */
export function TourRunner() {
  const campaigns = useWidgetStore((s) => s.campaigns);
  const campaignsLoaded = useWidgetStore((s) => s.campaignsLoaded);
  const activeTour = useWidgetStore((s) => s.activeTour);
  const setActiveTour = useWidgetStore((s) => s.setActiveTour);
  const href = useCurrentHref();

  // Cada tour só tenta começar sozinho uma vez por carga de página — sem isto,
  // pular o tour e voltar para a página o faria reaparecer na hora.
  const autoTried = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!campaignsLoaded || activeTour) return;

    const resumable = findResumableTour(campaigns);
    if (resumable) {
      setActiveTour({ campaignId: resumable.tour.id, stepIndex: resumable.step });
      return;
    }

    const candidate = selectAutoStartTour(campaigns, href);
    if (!candidate || autoTried.current.has(candidate.id)) return;
    autoTried.current.add(candidate.id);

    const timer = setTimeout(() => {
      // Nada mudou nesse meio-tempo? (cliente pode ter aberto o widget, etc.)
      if (useWidgetStore.getState().activeTour) return;
      setActiveTour({ campaignId: candidate.id, stepIndex: 0 });
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [campaignsLoaded, campaigns, activeTour, href, setActiveTour]);

  // Cada passo alcançado: salva localmente (para retomar) e conta no servidor.
  useEffect(() => {
    if (!activeTour) return;
    saveTourProgress(activeTour.campaignId, activeTour.stepIndex);
    trackCampaign(activeTour.campaignId, "step", { step: activeTour.stepIndex });
  }, [activeTour]);

  const tour = activeTour ? findTour(campaigns, activeTour.campaignId) : null;

  const handleStepChange = useCallback(
    (index: number) => {
      if (!activeTour) return;
      setActiveTour({ campaignId: activeTour.campaignId, stepIndex: Math.max(0, index) });
    },
    [activeTour, setActiveTour],
  );

  const handleComplete = useCallback(() => {
    if (!activeTour || !tour) return;
    clearTourProgress(activeTour.campaignId, true);
    trackCampaign(activeTour.campaignId, "complete", { step: Math.max(0, tour.content.steps.length - 1) });
    setActiveTour(null);
  }, [activeTour, tour, setActiveTour]);

  const handleSkip = useCallback(() => {
    if (!activeTour) return;
    clearTourProgress(activeTour.campaignId, true);
    trackCampaign(activeTour.campaignId, "dismiss");
    setActiveTour(null);
  }, [activeTour, setActiveTour]);

  const handleNavigate = useCallback(
    (pattern: string) => {
      if (!activeTour) return;
      // O progresso já está salvo pelo efeito acima; a página vai recarregar.
      // Padrão com curinga vira o prefixo antes dele ("/app/infra/*" → "/app/infra/").
      const target = pattern.split("*")[0] || "/";
      try {
        window.location.assign(new URL(target, window.location.href).toString());
      } catch {
        window.location.assign(target);
      }
    },
    [activeTour],
  );

  // Tour sumiu da lista (despublicado no meio) → encerra sem contar como concluído.
  useEffect(() => {
    if (activeTour && campaignsLoaded && !tour) {
      clearTourProgress(activeTour.campaignId, false);
      setActiveTour(null);
    }
  }, [activeTour, campaignsLoaded, tour, setActiveTour]);

  if (!activeTour || !tour) return null;

  return (
    <TourOverlay
      tour={tour}
      stepIndex={activeTour.stepIndex}
      onStepChange={handleStepChange}
      onComplete={handleComplete}
      onSkip={handleSkip}
      onNavigate={handleNavigate}
    />
  );
}
