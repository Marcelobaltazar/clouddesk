import React from "react";
import ReactDOM from "react-dom/client";
import { ChatWidget, type EmbedUser } from "@/components/widget/ChatWidget";
import { ChatBubbleButton } from "@/components/widget/ChatBubbleButton";
import { useWidgetStore } from "@/components/widget/useWidgetStore";
import { DEFAULT_SETTINGS } from "@/components/widget/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CloudfyUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  interface Window {
    CloudfyUser?: CloudfyUser;
    CloudDeskWidget?: { destroy: () => void };
  }
}

// ── Eligibility check via Edge Function ───────────────────────────────────────

const EDGE_FN_URL =
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-widget-eligibility`;

async function checkEligibility(email: string): Promise<boolean> {
  try {
    const res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      console.warn(`[CloudDesk] check-widget-eligibility HTTP ${res.status} — widget não renderiza`);
      return false;
    }
    const json = (await res.json()) as { eligible: boolean };
    return json.eligible === true;
  } catch (err) {
    console.warn("[CloudDesk] check-widget-eligibility falhou — widget não renderiza:", err);
    return false;
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

  const eligible = await checkEligibility(raw.email);
  if (!eligible) return; // Intercom handles this user

  const embedUser: EmbedUser = {
    id:    raw.id,
    email: raw.email,
    name:  raw.name ?? raw.email,
  };

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
