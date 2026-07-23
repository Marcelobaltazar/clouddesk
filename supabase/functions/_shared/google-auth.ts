// ─── Google Service Account → access token (Gmail API) ─────────────────────────
//
// Autentica com uma Service Account que tem Domain-Wide Delegation, impersonando
// o usuário do Workspace (support@cloudfy.host). NÃO usa OAuth interativo nem
// senha — o admin autorizou os escopos uma vez no admin console.
//
// Fluxo: monta um JWT assinado (RS256) com a private key da SA + a claim `sub`
// (o usuário impersonado) → troca por um access token no endpoint OAuth2 do
// Google. O token é cacheado em memória até ~1 min antes de expirar.
//
// Secrets necessários: GMAIL_SA_CLIENT_EMAIL, GMAIL_SA_PRIVATE_KEY.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ── base64url helpers ──────────────────────────────────────────────────────────

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Converte a private key PEM (PKCS#8) em CryptoKey para RS256.
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ── Token cache ────────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, CachedToken>();

/**
 * Retorna um access token do Gmail impersonando `subject` (default: o usuário
 * da caixa de suporte). `scopes` default cobre leitura+envio.
 */
export async function getGmailAccessToken(
  subject?: string,
  scopes: string[] = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ],
): Promise<string> {
  const clientEmail = Deno.env.get('GMAIL_SA_CLIENT_EMAIL');
  const rawKey = Deno.env.get('GMAIL_SA_PRIVATE_KEY');
  const sub = subject ?? Deno.env.get('GMAIL_INBOX_USER');
  if (!clientEmail || !rawKey || !sub) {
    throw new Error('Gmail SA secrets ausentes (GMAIL_SA_CLIENT_EMAIL / GMAIL_SA_PRIVATE_KEY / GMAIL_INBOX_USER)');
  }

  const cacheKey = `${sub}|${scopes.join(',')}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  // Alguns ambientes gravam a key com \n literais — normaliza.
  const privateKeyPem = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    sub,                       // impersona o usuário do Workspace
    scope: scopes.join(' '),
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token error ${res.status}: ${err}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
