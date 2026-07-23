// ─── Gmail API — leitura, parse MIME e envio (Google puro) ─────────────────────
//
// Usa o access token da service account (google-auth.ts). O usuário impersonado
// é support@cloudfy.host (GMAIL_INBOX_USER); as respostas saem como
// support@cloudfy.email (GMAIL_SEND_AS, alias de envio da mesma conta).

import { getGmailAccessToken } from './google-auth.ts';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface ParsedEmail {
  gmailMessageId: string;   // id da mensagem no Gmail
  gmailThreadId: string;    // id da thread no Gmail
  rfcMessageId: string;     // header Message-ID (para In-Reply-To/References)
  inReplyTo: string | null; // header In-Reply-To
  references: string | null;// header References
  from: string;             // "Nome <email>"
  fromEmail: string;        // só o e-mail, lowercase
  fromName: string;
  to: string;
  subject: string;
  date: string;             // ISO
  textBody: string;         // corpo em texto puro (para o LLM)
  htmlBody: string | null;  // corpo HTML (para renderizar no painel)
  snippet: string;
}

interface GmailHeader { name: string; value: string; }
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function extractEmail(from: string): { email: string; name: string } {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: from.trim().toLowerCase() };
}

// Percorre a árvore MIME coletando o primeiro text/plain e text/html.
function collectBodies(part: GmailPart | undefined, acc: { text: string; html: string }): void {
  if (!part) return;
  const mime = part.mimeType ?? '';
  if (mime === 'text/plain' && part.body?.data && !acc.text) {
    acc.text = b64urlDecode(part.body.data);
  } else if (mime === 'text/html' && part.body?.data && !acc.html) {
    acc.html = b64urlDecode(part.body.data);
  }
  for (const p of part.parts ?? []) collectBodies(p, acc);
}

// Remove tags HTML para um fallback de texto quando só há HTML.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Remove a parte "citada" (histórico) de um corpo de e-mail, mantendo só o que o
// cliente escreveu agora. Heurística: corta na primeira linha de citação comum.
export function stripQuotedReply(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    // "Em ... escreveu:", "On ... wrote:", linhas começando com ">"
    if (/^\s*(em|on)\s.+(escreveu|wrote):\s*$/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line)) break; // separador do Outlook
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    out.push(line);
  }
  // remove linhas de citação ">" residuais no fim
  return out.join('\n').replace(/\n\s*>.*$/gs, '').trim() || text.trim();
}

// ── Leitura ──────────────────────────────────────────────────────────────────

/**
 * Lista os IDs das mensagens novas (não lidas, na Inbox). `q` permite refinar.
 * Padrão: apenas mensagens recebidas e não lidas.
 */
export async function listNewMessageIds(maxResults = 20): Promise<string[]> {
  const token = await getGmailAccessToken();
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('q', 'is:unread in:inbox -category:promotions -category:social');
  url.searchParams.set('maxResults', String(maxResults));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail list error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { messages?: Array<{ id: string }> };
  return (data.messages ?? []).map((m) => m.id);
}

export async function getMessage(id: string): Promise<ParsedEmail> {
  const token = await getGmailAccessToken();
  const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail get error ${res.status}: ${await res.text()}`);
  const msg = await res.json() as GmailMessage;

  const headers = msg.payload?.headers;
  const from = headerValue(headers, 'From');
  const { email: fromEmail, name: fromName } = extractEmail(from);

  const bodies = { text: '', html: '' };
  collectBodies(msg.payload, bodies);
  const htmlBody = bodies.html || null;
  const textBody = bodies.text || (htmlBody ? htmlToText(htmlBody) : (msg.snippet ?? ''));

  const internal = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    rfcMessageId: headerValue(headers, 'Message-ID'),
    inReplyTo: headerValue(headers, 'In-Reply-To') || null,
    references: headerValue(headers, 'References') || null,
    from,
    fromEmail,
    fromName,
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject'),
    date: internal.toISOString(),
    textBody,
    htmlBody,
    snippet: msg.snippet ?? '',
  };
}

export async function markAsRead(id: string): Promise<void> {
  const token = await getGmailAccessToken();
  await fetch(`${GMAIL_API}/messages/${id}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

// ── Envio ──────────────────────────────────────────────────────────────────────

export interface SendEmailParams {
  to: string;
  subject: string;
  /** corpo em texto puro (obrigatório) */
  text: string;
  /** corpo HTML (opcional; se ausente, gera do texto) */
  html?: string;
  /** threadId do Gmail para manter a conversa agrupada */
  threadId?: string;
  /** Message-ID ao qual respondemos (para In-Reply-To/References) */
  inReplyTo?: string | null;
  references?: string | null;
  /** nome exibido no remetente (ex.: "Marc — Cloudfy") */
  fromName?: string;
}

function encodeSubjectRFC2047(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject; // ASCII puro
  const bytes = new TextEncoder().encode(subject);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function buildMime(params: SendEmailParams, from: string): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const html = params.html ?? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${params.text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;

  const headers = [
    `From: ${from}`,
    `To: ${params.to}`,
    `Subject: ${encodeSubjectRFC2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references || params.inReplyTo) {
    headers.push(`References: ${[params.references, params.inReplyTo].filter(Boolean).join(' ')}`);
  }

  const mime = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return mime;
}

function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Envia um e-mail saindo como GMAIL_SEND_AS (support@cloudfy.email). */
export async function sendEmail(params: SendEmailParams): Promise<{ id: string; threadId: string }> {
  const token = await getGmailAccessToken();
  const sendAs = Deno.env.get('GMAIL_SEND_AS') ?? Deno.env.get('GMAIL_INBOX_USER') ?? '';
  const fromName = params.fromName ?? 'Suporte Cloudfy';
  const from = `${fromName} <${sendAs}>`;

  const raw = base64urlEncode(buildMime(params, from));
  const body: Record<string, unknown> = { raw };
  if (params.threadId) body.threadId = params.threadId;

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail send error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}
