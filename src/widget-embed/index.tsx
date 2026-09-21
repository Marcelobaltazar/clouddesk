import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWidget, type EmbedUser } from "@/components/widget/ChatWidget";
import { ChatBubbleButton } from "@/components/widget/ChatBubbleButton";
import { ChatWidgetNotice } from "@/components/widget/ChatWidgetNotice";
import { useWidgetStore } from "@/components/widget/useWidgetStore";
import { useWidgetLiveUpdates } from "@/components/widget/useWidgetLiveUpdates";
import { OutboundClosedLayer } from "@/components/widget/outbound/OutboundClosedLayer";
import { TourRunner } from "@/components/widget/outbound/TourRunner";
import { useLoadCampaigns } from "@/components/widget/outbound/useOutbound";
import { DEFAULT_SETTINGS } from "@/components/widget/types";
import { configureWidgetApi, widgetApi } from "@/lib/widget-api";
// CSS do widget como STRING (?inline): o Vite não emite/injeta CSS no build de
// biblioteca (IIFE). Injetamos manualmente no bootstrap para o widget ter estilo
// no site host (que não tem o CSS do app). Ver widget.css.
import widgetCss from "./widget.css?inline";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CloudfyUser {
  id: string;
  email: string;
  name: string;
  /**
   * Identidade verificada (obrigatória em produção):
   *   hash = HMAC_SHA256(WIDGET_IDENTITY_SECRET, lowercase(email)) em hex,
   * calculado SERVER-SIDE pelo backend do cloudfy.space (nunca no navegador).
   * Sem um hash válido o backend recusa todas as ações do widget.
   */
  hash?: string;
}

declare global {
  interface Window {
    CloudfyUser?: CloudfyUser;
    CloudDeskWidget?: { destroy: () => void };
  }
}

// ── Widget root component (bubble + panel) ────────────────────────────────────

function EmbedRoot({ embedUser }: { embedUser: EmbedUser }) {
  const isOpen = useWidgetStore((s) => s.isOpen);
  const conversationsLoaded = useWidgetStore((s) => s.conversationsLoaded);
  const setConversations = useWidgetStore((s) => s.setConversations);
  const setPendingOpenId = useWidgetStore((s) => s.setPendingOpenId);
  const setOpen = useWidgetStore((s) => s.setOpen);

  // Carrega a lista de chamados MESMO COM O WIDGET FECHADO: é ela que alimenta
  // o badge de não lidas na bolha e diz ao realtime quais conversas assinar.
  // Sem isto, o cliente só descobriria a resposta do operador ao abrir o widget
  // por conta própria — exatamente o problema que esta tela resolve.
  React.useEffect(() => {
    if (conversationsLoaded) return;
    let cancelled = false;
    widgetApi
      .conversations()
      .then(({ conversations }) => {
        if (!cancelled) setConversations(conversations);
      })
      .catch((err) => {
        console.warn("[CloudDesk] falha ao carregar chamados:", err);
        // Erro ≠ lista vazia: sem isto o widget abriria dizendo "nenhum chamado
        // ainda" para um cliente que tem chamados em aberto.
        if (!cancelled) useWidgetStore.getState().setConversationsError(true);
      });
    return () => { cancelled = true; };
  }, [conversationsLoaded, setConversations]);

  useWidgetLiveUpdates(true);

  // Disparos (avisos, novidades, banners, tours): carregados na carga da
  // página porque o popup e o tour aparecem com o widget FECHADO.
  useLoadCampaigns(true);

  // Clique no aviso flutuante: abre o widget já no chamado que respondeu.
  const handleNoticeOpen = (conversationId: string) => {
    setPendingOpenId(conversationId);
    setOpen(true);
  };

  return (
    <>
      <ChatBubbleButton />
      <ChatWidgetNotice onOpen={handleNoticeOpen} />
      <OutboundClosedLayer />
      <TourRunner />
      {isOpen && (
        <ChatWidget settings={DEFAULT_SETTINGS} embedUser={embedUser} />
      )}
    </>
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const raw = window.CloudfyUser;
  if (!raw?.id || !raw?.email) return; // not logged in

  const embedUser: EmbedUser = {
    id:    raw.id,
    email: raw.email,
    name:  raw.name ?? raw.email,
    hash:  raw.hash,
  };

  // Gate de identidade/elegibilidade: uma chamada leve ao gateway. Se a
  // identidade não verificar (hash ausente/errado), o widget NÃO renderiza —
  // sem erros na página do host.
  configureWidgetApi({
    email: embedUser.email,
    name: embedUser.name,
    userHash: embedUser.hash,
    accountUserId: embedUser.id,
  });

  try {
    const { eligible } = await widgetApi.hello();
    if (!eligible) return;
  } catch (err) {
    console.warn("[CloudDesk] verificação de identidade falhou — widget não renderiza:", err);
    return;
  }

  // Injeta o CSS do widget uma única vez. Sem isto o widget renderiza sem estilo
  // (o site host não tem o CSS do app). Guard por id evita duplicar em re-init.
  if (!document.getElementById("clouddesk-widget-style")) {
    const style = document.createElement("style");
    style.id = "clouddesk-widget-style";
    style.textContent = widgetCss;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.id = "clouddesk-widget-root";
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <EmbedRoot embedUser={embedUser} />
    </React.StrictMode>
  );

  // Expose destroy handle for emergency cleanup
  window.CloudDeskWidget = {
    destroy: () => {
      root.unmount();
      container.remove();
      delete window.CloudDeskWidget;
    },
  };
})();
