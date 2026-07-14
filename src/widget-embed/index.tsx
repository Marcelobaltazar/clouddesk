import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWidget, type EmbedUser } from "@/components/widget/ChatWidget";
import { ChatBubbleButton } from "@/components/widget/ChatBubbleButton";
import { useWidgetStore } from "@/components/widget/useWidgetStore";
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

  return (
    <>
      <ChatBubbleButton />
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
