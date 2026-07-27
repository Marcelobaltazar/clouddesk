/**
 * migrate-kb-images.mjs
 *
 * Migra as imagens/GIFs dos artigos da Base de Conhecimento que hoje apontam
 * para o CDN do Intercom (downloads.intercomcdn.com — URLs assinadas que podem
 * expirar) para o nosso Supabase Storage (bucket desk-kb-images). Reescreve as
 * URLs no markdown de cada artigo.
 *
 * Idempotente: URLs já migradas (que apontam para o nosso Storage) são ignoradas.
 * Não destrutivo por padrão em modo dry-run.
 *
 * Uso:
 *   # piloto: processa só 1 artigo e MOSTRA o antes/depois (não grava sem --write)
 *   node scripts/migrate-kb-images.mjs --limit=1
 *   # piloto de verdade (grava 1 artigo):
 *   node scripts/migrate-kb-images.mjs --limit=1 --write
 *   # tudo:
 *   node scripts/migrate-kb-images.mjs --all --write
 *
 * Ambiente (mesmo padrão dos outros scripts):
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── env (aceita .env como os outros scripts) ───────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* sem .env — usa o ambiente */ }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "desk-kb-images";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  console.error("Ex.: SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-kb-images.mjs --limit=1");
  process.exit(1);
}

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const ALL = args.includes("--all");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = ALL ? Infinity : limitArg ? parseInt(limitArg.split("=")[1], 10) : 1;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Só migra URLs do Intercom. Já-migradas (nosso storage) são puladas.
const INTERCOM_RE = /https?:\/\/downloads\.intercomcdn\.com\/[^\s)"']+/g;

const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};

async function migrateOneUrl(url, articleId, seen) {
  if (seen.has(url)) return seen.get(url); // dedup dentro do artigo

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`    ⚠️  ${res.status} ao baixar — mantém URL original`);
    return null;
  }
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ext = EXT_BY_MIME[contentType] || "png";
  const buf = new Uint8Array(await res.arrayBuffer());

  // caminho estável e único por conteúdo (hash do buffer)
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(hashBuf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${articleId}/${hash}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (upErr) {
    console.warn(`    ⚠️  upload falhou: ${upErr.message} — mantém URL original`);
    return null;
  }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const newUrl = pub?.publicUrl ?? null;
  if (newUrl) seen.set(url, newUrl);
  console.log(`    ✓ ${(buf.byteLength / 1024).toFixed(0)}KB ${ext} → ${path}`);
  return newUrl;
}

async function main() {
  console.log(`\nMigração de imagens KB (${WRITE ? "GRAVANDO" : "DRY-RUN — use --write para gravar"})`);
  console.log(`Limite: ${LIMIT === Infinity ? "todos" : LIMIT} artigo(s)\n`);

  const { data: articles, error } = await supabase
    .from("desk_knowledge_base")
    .select("id, title, content")
    .ilike("content", "%downloads.intercomcdn.com%")
    .order("created_at", { ascending: true });

  if (error) { console.error("Erro ao ler artigos:", error.message); process.exit(1); }

  const toProcess = articles.slice(0, LIMIT);
  console.log(`Artigos com imagens do Intercom: ${articles.length} (processando ${toProcess.length})\n`);

  let totalImgs = 0, totalMigrated = 0, articlesChanged = 0;

  for (const art of toProcess) {
    const urls = [...new Set(art.content.match(INTERCOM_RE) || [])];
    if (urls.length === 0) continue;
    console.log(`📄 ${art.title}  (#${art.id.slice(0, 8)}) — ${urls.length} imagem(ns)`);
    totalImgs += urls.length;

    let newContent = art.content;
    const seen = new Map();
    for (const url of urls) {
      const newUrl = await migrateOneUrl(url, art.id, seen);
      if (newUrl) {
        newContent = newContent.split(url).join(newUrl);
        totalMigrated++;
      }
    }

    if (newContent !== art.content) {
      articlesChanged++;
      if (WRITE) {
        const { error: updErr } = await supabase
          .from("desk_knowledge_base")
          .update({ content: newContent, updated_at: new Date().toISOString() })
          .eq("id", art.id);
        if (updErr) console.error(`    ✗ gravar falhou: ${updErr.message}`);
        else console.log(`    💾 artigo atualizado`);
      } else {
        console.log(`    (dry-run: NÃO gravou — reescreveria ${urls.length} URL(s))`);
      }
    }
    console.log("");
  }

  console.log("─".repeat(50));
  console.log(`Imagens encontradas: ${totalImgs} | migradas: ${totalMigrated} | artigos alterados: ${articlesChanged}`);
  if (!WRITE) console.log("\nDRY-RUN: nada foi gravado. Rode com --write para aplicar.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
