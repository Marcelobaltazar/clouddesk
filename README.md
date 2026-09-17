# CloudDesk

Plataforma interna de suporte ao cliente da **Cloudfy**. Reúne três partes:

- **Painel do operador** — inbox, CRM, base de conhecimento e analytics
- **Chat widget** — bolha embarcada na área logada dos clientes Cloudfy
- **Motor de IA** — agente que responde clientes com contexto real da conta

A **Central de Ajuda** pública fica em `/ajuda` e é servida pelo mesmo app,
sem autenticação.

> As convenções do projeto (schema, pipeline da IA, design system, regras de
> código) estão em [`CLAUDE.md`](./CLAUDE.md) — é a fonte de verdade.

## Stack

Vite · React 18 · TypeScript · Tailwind CSS · shadcn/ui · Zustand ·
React Router · Supabase (Auth, Postgres + pgvector, Realtime, Storage,
Edge Functions) · Recharts

## Rodando localmente

Requisito: Node.js 18+ e npm.

```sh
npm install
cp .env.example .env    # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev             # http://localhost:8080
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção do painel (`dist/`) |
| `npm run build:widget` | Build do widget embarcável e cópia para `public/widget.js` |
| `npm run preview` | Serve o build de produção localmente |
| `npm test` | Testes (Vitest) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |

## Supabase

```sh
npx supabase db push --linked                 # aplica as migrations
npx supabase functions serve                  # Edge Functions locais
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

## Deploy

`deploy-producao.ps1` aplica migrations, publica os secrets e faz o deploy das
Edge Functions, além de gerar os builds do painel e do widget. O painel em si é
publicado em `clouddesk-omega.vercel.app`.

## Variáveis de ambiente

Nunca commite `.env` / `.env.local`.

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxx
```

Chaves de serviço (Stripe, provedores de LLM, Resend) vivem apenas nos secrets
do Supabase, usados pelas Edge Functions — nunca no frontend.
