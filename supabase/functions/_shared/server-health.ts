// ─── Saúde do servidor de uma infraestrutura (uso INTERNO) ────────────────────
// Cada infra roda numa stack dentro de um servidor com Portainer, vários
// clientes por servidor. Quando o Portainer não responde, o servidor caiu e a
// correção é o reinício pelo formulário interno da equipe. Quando ele responde,
// o servidor está bem e o problema é da stack daquele cliente — nada de
// reiniciar o servidor (derrubaria os outros clientes).
//
// SIGILO: nome do servidor, URL do Portainer e afins NUNCA saem do servidor
// para o cliente — nem para o widget, nem para o texto da IA. Por isso este
// módulo é separado de contact-info.ts: o bootstrap do widget devolve o
// ContactInfo inteiro ao navegador do cliente.
//
// Banco de produção da Cloudfy: SÓ leitura e SÓ colunas explícitas — as tabelas
// servers/infrastructure guardam api_key, ip e credenciais que o CloudDesk
// nunca pode ler.

import type { ServiceClient } from './supabase.ts';

export interface InfraServer {
  infraId: string;
  serverId: number;
  /** server-portainer-live-{N} — é o que vai no formulário de reinício. */
  serverName: string;
  /** https://portainer{N}.cloudfy.live */
  portainerUrl: string;
}

const PORTAINER_URL_RE = /^https:\/\/portainer\d+\.cloudfy\.live$/;
const SERVER_NAME_RE = /^server-portainer-live-\d+$/;

/** Só testamos/reiniciamos o que tem exatamente o formato conhecido — um
 *  valor estranho no banco não vira requisição para qualquer lugar. */
export function isValidPortainerUrl(url: unknown): url is string {
  return typeof url === 'string' && PORTAINER_URL_RE.test(url.replace(/\/+$/, ''));
}

export function isValidServerName(name: unknown): name is string {
  return typeof name === 'string' && SERVER_NAME_RE.test(name);
}

interface InfraServerRow {
  id: string;
  server: { id: number; name: string | null; url: string | null } | null;
}

/** Servidor de cada infra (via infrastructure.server_id → servers). */
export async function fetchInfraServers(prod: ServiceClient, infraIds: string[]): Promise<InfraServer[]> {
  const ids = [...new Set(infraIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await prod
    .from('infrastructure')
    .select('id, server:servers!infrastructure_server_id_fkey(id, name, url)')
    .in('id', ids);
  if (error) {
    console.warn('[server-health] leitura do servidor falhou:', error.message);
    return [];
  }
  const out: InfraServer[] = [];
  for (const row of (data ?? []) as unknown as InfraServerRow[]) {
    const s = row.server;
    if (!s || !isValidServerName(s.name) || !isValidPortainerUrl(s.url)) continue;
    out.push({ infraId: row.id, serverId: s.id, serverName: s.name, portainerUrl: s.url.replace(/\/+$/, '') });
  }
  return out;
}

/** Portainers de OUTROS servidores ativos, para separar "servidor caiu" de
 *  "a nossa conexão de teste falhou". */
export async function pickControlServers(prod: ServiceClient, excludeIds: number[], n = 2): Promise<string[]> {
  const { data, error } = await prod
    .from('servers')
    .select('id, url')
    .eq('status', 'ACTIVE')
    .eq('type', 'portainer')
    .order('id', { ascending: false })
    .limit(12);
  if (error) {
    console.warn('[server-health] leitura dos servidores de controle falhou:', error.message);
    return [];
  }
  const urls = ((data ?? []) as Array<{ id: number; url: string | null }>)
    .filter((s) => !excludeIds.includes(s.id) && isValidPortainerUrl(s.url))
    .map((s) => (s.url as string).replace(/\/+$/, ''));
  // Embaralha para não testar sempre os mesmos.
  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  return urls.slice(0, n);
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** /api/status do Portainer é público e leve (200 em < 1 s quando está no ar). */
export async function portainerResponds(url: string, timeoutMs = 4_000, fetcher: Fetcher = fetch): Promise<boolean> {
  if (!isValidPortainerUrl(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${url}/api/status`, { method: 'GET', signal: controller.signal });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerVerdict {
  /** true só quando TODAS as tentativas falharam. */
  serverDown: boolean;
  /** Algum servidor de controle respondeu — a nossa conexão está ok. */
  controlOk: boolean;
  attempts: boolean[];
  controls: boolean[];
}

export interface CheckOptions {
  tries?: number;
  gapMs?: number;
  timeoutMs?: number;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * "O servidor caiu?" — só diz que sim com evidência: N tentativas seguidas sem
 * resposta E pelo menos um servidor de controle respondendo. Para na primeira
 * tentativa que responder (servidor no ar).
 */
export async function checkServer(url: string, controlUrls: string[], opts: CheckOptions = {}): Promise<ServerVerdict> {
  const tries = opts.tries ?? 3;
  const gapMs = opts.gapMs ?? 2_000;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const fetcher = opts.fetcher ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const controlsPromise = Promise.all(controlUrls.map((u) => portainerResponds(u, timeoutMs, fetcher)));
  const attempts: boolean[] = [];
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(gapMs);
    const ok = await portainerResponds(url, timeoutMs, fetcher);
    attempts.push(ok);
    if (ok) break;
  }
  const controls = await controlsPromise;
  return {
    serverDown: attempts.length === tries && attempts.every((ok) => !ok),
    controlOk: controls.some(Boolean),
    attempts,
    controls,
  };
}

export interface RestartResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

/**
 * Pede o reinício pelo formulário interno da equipe (n8n Form Trigger, campo
 * único "Server Name" = field-0). A URL fica no secret SERVER_RESTART_FORM_URL
 * — sem ele, nada é enviado.
 */
export async function sendServerRestart(serverName: string, fetcher: Fetcher = fetch): Promise<RestartResult> {
  const formUrl = Deno.env.get('SERVER_RESTART_FORM_URL');
  if (!formUrl) return { ok: false, status: null, error: 'SERVER_RESTART_FORM_URL não configurado' };
  if (!isValidServerName(serverName)) return { ok: false, status: null, error: `nome de servidor inválido: ${serverName}` };

  const form = new FormData();
  form.set('field-0', serverName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetcher(formUrl, { method: 'POST', body: form, signal: controller.signal });
    await res.body?.cancel();
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
