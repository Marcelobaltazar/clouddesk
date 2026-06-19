import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Eligibility ──────────────────────────────────────────────────────────────
// Todos os planos da Cloudfy agora usam o widget do CloudDesk. A separação por
// plano (Starter / Advanced / Ultra / Max) acontece dentro do painel, via as
// views da inbox — não mais aqui. Por isso a regra é simples: qualquer usuário
// logado (com email) é elegível. O Airtable foi removido.
//
// O contrato ({ eligible: boolean }) é mantido para que o widget-embed continue
// funcionando sem mudanças e este ponto continue existindo caso seja preciso
// bloquear alguém no futuro.

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  let email: string | null = null;
  try {
    const body = (await req.json()) as { email?: string };
    if (body.email && typeof body.email === "string") {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    // body inválido → trata como sem email
  }

  // Sem email → não há usuário logado → não renderiza.
  if (!email) {
    return Response.json({ eligible: false }, { headers: CORS });
  }

  // Qualquer usuário logado é elegível.
  return Response.json({ eligible: true }, { headers: CORS });
});
