// ─── Endereço da Central de Ajuda (único) ─────────────────────────────────────
//
// A Central de Ajuda vive no próprio app do CloudDesk, na Vercel. Existe UM
// endereço, e ele fica no código — não em secret. Em 25/09/2026 o secret
// HELP_CENTER_URL ainda apontava para o domínio antigo
// (clouddesk.apps.cloudfy.cloud) e sobrescrevia o valor certo do código: 975
// respostas da IA saíram com link morto, mesmo depois de o código ter sido
// corrigido (b8f7fc1). Um secret esquecido não tem como fazer isso de novo.
//
// Domínios que já foram a Central e não existem mais:
//   • clouddesk.apps.cloudfy.cloud/...          → mesmo caminho no domínio novo
//   • ajuda.cloudfy.cloud/pt-BR/articles/<id>-… → /ajuda/<id>-… (o id do Intercom
//                                                  é o source_id do artigo importado)
//   • ajuda.cloudfy.cloud/...                   → /ajuda (página inicial)
// Os artigos importados do Intercom ainda trazem esses links no texto, e a IA
// pode repassá-los — rewriteLegacyHelpLinks corrige antes de o cliente ver.
//
// Módulo PURO (sem Deno/Supabase).

export const HELP_CENTER_URL = 'https://clouddesk-omega.vercel.app';

const OLD_APP_RE = /https?:\/\/clouddesk\.apps\.cloudfy\.cloud(\/[^\s)\]>"'`]*)?/gi;
const INTERCOM_ARTICLE_RE = /https?:\/\/ajuda\.cloudfy\.cloud\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?articles\/(\d+)(-[a-z0-9-]*)?/gi;
const INTERCOM_ANY_RE = /https?:\/\/ajuda\.cloudfy\.cloud(?:\/[^\s)\]>"'`]*)?/gi;

/** ids de artigos do Intercom citados no texto (para saber quais existem). */
export function legacyIntercomIds(text: string): string[] {
  return [...new Set([...String(text ?? '').matchAll(INTERCOM_ARTICLE_RE)].map((m) => m[1]))];
}

export function hasLegacyHelpLink(text: string): boolean {
  const s = String(text ?? '');
  return /clouddesk\.apps\.cloudfy\.cloud|ajuda\.cloudfy\.cloud/i.test(s);
}

/**
 * Troca todo link de Central antiga pelo endereço atual.
 * `publishedSourceIds`: source_ids de artigos publicados — link do Intercom
 * para artigo que não existe mais vai para a página inicial, não para um 404.
 */
export function rewriteLegacyHelpLinks(text: string, publishedSourceIds: Set<string>): string {
  return String(text ?? '')
    .replace(OLD_APP_RE, (_m, path: string | undefined) => `${HELP_CENTER_URL}${path ?? '/ajuda'}`)
    .replace(INTERCOM_ARTICLE_RE, (_m, id: string, slug: string | undefined) =>
      publishedSourceIds.has(id) ? `${HELP_CENTER_URL}/ajuda/${id}${slug ?? ''}` : `${HELP_CENTER_URL}/ajuda`)
    .replace(INTERCOM_ANY_RE, `${HELP_CENTER_URL}/ajuda`);
}
