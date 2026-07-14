// Gera o user_hash (HMAC-SHA256) do widget para um e-mail — útil para debug do
// embed no cloudfy.space e para testar o gateway manualmente.
//
// Uso:
//   node scripts/widget-hash.mjs cliente@exemplo.com
//   (o segredo vem de .widget-identity-secret.local ou de $WIDGET_IDENTITY_SECRET)

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const email = process.argv[2];
if (!email) {
  console.error("Uso: node scripts/widget-hash.mjs <email>");
  process.exit(1);
}

let secret = process.env.WIDGET_IDENTITY_SECRET;
if (!secret) {
  try {
    secret = readFileSync(new URL("../.widget-identity-secret.local", import.meta.url), "utf8").trim();
  } catch {
    console.error("Segredo ausente: defina WIDGET_IDENTITY_SECRET ou crie .widget-identity-secret.local");
    process.exit(1);
  }
}

const normalized = email.trim().toLowerCase();
const hash = createHmac("sha256", secret).update(normalized).digest("hex");

console.log(JSON.stringify({ email: normalized, hash }, null, 2));
