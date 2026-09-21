# CLAUDE.md — CloudDesk (Cloudfy Internal Support Platform)

> Este arquivo é a fonte de verdade do projeto. Claude Code deve ler este arquivo
> antes de qualquer tarefa e seguir todas as convenções aqui definidas.

---

## 1. VISÃO GERAL

CloudDesk é uma plataforma de suporte ao cliente para uso interno da **Cloudfy**, uma startup SaaS brasileira de infraestrutura que atende ~3.000 clientes. O sistema é composto por 3 partes:

1. **Painel do Operador** — Dashboard web para equipe de suporte (inbox, CRM, analytics)
2. **Chat Widget** — Bubble embeddable na área logada dos clientes Cloudfy
3. **Motor de IA** — Agente inteligente multi-LLM que responde clientes automaticamente

O CloudDesk **NÃO é um sistema isolado**. Ele se conecta ao Supabase de produção da Cloudfy, consumindo dados existentes de clientes (`account`) e pagamentos (`purchases`), e adiciona suas próprias tabelas com prefixo `desk_`.

---

## 2. STACK TECNOLÓGICA

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Frontend | React + TypeScript | 18.x |
| Build | Vite | 5.x |
| UI | Tailwind CSS + shadcn/ui | 3.x / latest |
| Estado global | Zustand | 4.x |
| Roteamento | React Router | v6 |
| Backend | Supabase (Auth, DB, Realtime, Storage, Edge Functions) | v2 |
| Banco de dados | PostgreSQL (via Supabase) + pgvector | 15+ |
| Realtime | Supabase Realtime (Postgres Changes + Presence) | — |
| Charts | Recharts | 2.x |
| Icons | Lucide React | latest |

### Bibliotecas NÃO permitidas
- Material UI, Chakra UI, Ant Design (usar APENAS shadcn/ui)
- Firebase (usar APENAS Supabase)
- Axios (usar fetch nativo ou supabase-js client)
- Redux, MobX (usar APENAS Zustand)

---

## 3. ESTRUTURA DE DIRETÓRIOS

```
cloudfy-connect/
├── CLAUDE.md                          # ← Este arquivo (fonte de verdade)
├── src/
│   ├── App.tsx                        # Router principal
│   ├── main.tsx                       # Entry point
│   ├── lib/
│   │   ├── supabase.ts               # Cliente Supabase (singleton)
│   │   ├── stripe.ts                 # Helpers para chamar Edge Function do Stripe
│   │   └── utils.ts                  # Utilidades gerais (cn, formatDate, etc.)
│   ├── stores/
│   │   ├── useAuthStore.ts           # Auth do operador (Zustand)
│   │   ├── useInboxStore.ts          # Estado da inbox (conversas, filtros)
│   │   ├── useConversationStore.ts   # Conversa ativa + mensagens
│   │   └── useWidgetStore.ts         # Estado do widget (já existe)
│   ├── hooks/
│   │   ├── useRealtimeMessages.ts    # Subscribe em desk_messages
│   │   ├── useRealtimeInbox.ts       # Subscribe em desk_conversations
│   │   ├── useTypingIndicator.ts     # Presence API para typing
│   │   ├── useNotifications.ts       # Desktop notifications + som
│   │   └── useKeyboardShortcuts.ts   # Atalhos globais
│   ├── pages/
│   │   ├── Login.tsx                 # Auth de operadores
│   │   ├── Dashboard.tsx             # Layout principal (3 colunas)
│   │   ├── Contacts.tsx              # CRM (leitura da tabela account)
│   │   ├── KnowledgeBase.tsx         # CRUD de artigos
│   │   ├── Reports.tsx               # Analytics e métricas
│   │   ├── Settings.tsx              # Configurações gerais
│   │   ├── SettingsAI.tsx            # Config multi-LLM + persona
│   │   ├── SettingsAIMetrics.tsx     # Analytics da IA (tokens, custos, performance)
│   │   ├── SettingsRouting.tsx       # Regras de escalonamento inteligente
│   │   ├── SettingsFAQ.tsx           # FAQ dinâmico (auto + manual)
│   │   ├── SettingsWidget.tsx        # Config do widget
│   │   ├── SettingsTeam.tsx          # Gestão de operadores
│   │   ├── SettingsMacros.tsx        # CRUD de macros
│   │   ├── SettingsTags.tsx          # CRUD de tags
│   │   ├── SettingsSLA.tsx           # Config de SLA
│   │   └── WidgetPreview.tsx         # Preview do widget (já existe)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # Sidebar de navegação
│   │   │   ├── InboxLayout.tsx       # Layout 3 colunas da inbox
│   │   │   └── ProtectedRoute.tsx    # Guard de auth
│   │   ├── inbox/
│   │   │   ├── ConversationList.tsx  # Coluna 1: lista de conversas
│   │   │   ├── ConversationItem.tsx  # Item individual na lista
│   │   │   ├── ConversationThread.tsx # Coluna 2: thread de mensagens
│   │   │   ├── MessageBubble.tsx     # Bolha de mensagem (contact/agent/bot/system/note)
│   │   │   ├── MessageComposer.tsx   # Editor de composição
│   │   │   ├── MacroSelector.tsx     # Dropdown de macros (ativado por /)
│   │   │   ├── ConversationDetails.tsx # Coluna 3: painel de detalhes
│   │   │   ├── ClientInfoPanel.tsx   # Dados do cliente (account + purchases)
│   │   │   ├── StripePanel.tsx       # Dados do Stripe (via Edge Function)
│   │   │   ├── TagManager.tsx        # Gerenciar tags da conversa
│   │   │   └── ActivityTimeline.tsx  # Log de atividades
│   │   ├── widget/                   # ← Componentes do chat widget (já existem parcialmente)
│   │   │   ├── ChatBubbleButton.tsx
│   │   │   ├── ChatWidget.tsx
│   │   │   ├── ChatWidgetHeader.tsx
│   │   │   ├── ChatWidgetThread.tsx
│   │   │   ├── ChatWidgetComposer.tsx
│   │   │   ├── ChatWidgetWelcome.tsx
│   │   │   ├── CSATFeedback.tsx
│   │   │   ├── types.ts
│   │   │   └── useWidgetStore.ts
│   │   ├── contacts/
│   │   │   ├── ContactsTable.tsx     # Tabela de clientes
│   │   │   ├── ContactProfile.tsx    # Drawer/página de perfil
│   │   │   └── ContactFilters.tsx    # Filtros avançados
│   │   ├── knowledge/
│   │   │   ├── ArticleList.tsx
│   │   │   ├── ArticleEditor.tsx     # Markdown editor + preview
│   │   │   └── SnippetList.tsx
│   │   ├── reports/
│   │   │   ├── MetricsCards.tsx      # Cards de visão geral
│   │   │   ├── ConversationChart.tsx # Gráficos de volume
│   │   │   └── TeamPerformance.tsx   # Tabela de performance
│   │   └── settings/
│   │       ├── AIConfigCard.tsx      # Card de provider LLM
│   │       ├── AIPersonaEditor.tsx   # Editor de persona (nome, tom, regras)
│   │       ├── AIMetricsDashboard.tsx # Métricas da IA (tokens, custos, taxa)
│   │       ├── RoutingRuleEditor.tsx # CRUD de regras de escalonamento
│   │       ├── RoutingRulePreview.tsx # Campo de teste de routing rules
│   │       ├── FAQList.tsx           # Lista de FAQs (auto + manual)
│   │       ├── WidgetPreviewLive.tsx # Preview ao vivo
│   │       └── SLAConfig.tsx         # Config de SLA por prioridade
│   ├── types/
│   │   ├── database.ts              # Types gerados do Supabase (tabelas desk_*)
│   │   ├── account.ts               # Types da tabela account (existente)
│   │   ├── purchases.ts             # Types da tabela purchases (existente)
│   │   └── stripe.ts                # Types do response da Edge Function Stripe
│   └── constants/
│       ├── keyboard-shortcuts.ts
│       └── sla-defaults.ts
├── supabase/
│   ├── migrations/
│   │   └── 001_desk_tables.sql      # Schema das tabelas desk_*
│   └── functions/
│       ├── desk-ai-respond/         # Motor de IA multi-LLM (pipeline completo)
│       │   └── index.ts
│       ├── desk-ai-evaluate-routing/ # Preview de routing rules (teste)
│       │   └── index.ts
│       ├── desk-stripe-customer/    # Consulta Stripe API
│       │   └── index.ts
│       ├── desk-generate-embedding/ # Gera embedding para KB/snippets/FAQ
│       │   └── index.ts
│       └── desk-inbound-email/      # Webhook de email (fase 4)
│           └── index.ts
└── public/
    └── notification-sound.mp3       # Som de notificação
```

---

## 4. BANCO DE DADOS

### 4.1 Tabelas EXISTENTES (NÃO MODIFICAR — apenas ler)

Estas tabelas já existem no Supabase de produção da Cloudfy. O CloudDesk CONSOME estes dados via SELECT/JOIN. Nunca fazer INSERT, UPDATE ou DELETE nestas tabelas.

```sql
-- TABELA: account (dados do cliente)
-- Chave de ligação universal: account.user_id → auth.users(id)
account (
  id              UUID PK,
  user_id         UUID FK → auth.users(id),  -- ← CHAVE PRINCIPAL DE LIGAÇÃO
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  stripe_customer_id TEXT,                    -- ← ID do cliente no Stripe
  has_password    BOOLEAN,
  has_purchase    BOOLEAN,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)

-- TABELA: purchases (compras e assinaturas)
purchases (
  id                        UUID PK,
  client_name               TEXT,
  client_email              TEXT,
  client_phone              TEXT,
  external_purchase_id      TEXT,
  purchase_code             TEXT,
  product_id                INT FK → products(id),
  purchase_date             TIMESTAMPTZ,
  current_datetime          TIMESTAMPTZ,
  created_at                TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ,
  status                    TEXT,      -- 'PAID', 'PENDING', 'CANCELLED'
  pending_deployment        BOOLEAN,
  deployment_attempted_at   TIMESTAMPTZ,
  deployment_retry_count    INT,
  deployment_failure_reason TEXT,
  stripe_invoice_id         TEXT,
  amount                    NUMERIC,
  currency                  TEXT,      -- 'USD', 'BRL'
  stripe_subscription_id    TEXT,
  linked_infrastructure_id  UUID FK → infrastructure(id),
  virtual_number_data       JSONB
)

-- TABELA: products (catálogo de produtos)
-- TABELA: infrastructure (infraestruturas dos clientes)
-- TABELA: users (auth.users — gerenciado pelo Supabase Auth)
```

**Como vincular cliente a uma conversa:**
```
desk_conversations.account_user_id
  → account.user_id
    → account.email → purchases.client_email (para pegar compras)
    → account.stripe_customer_id (para chamar Stripe API)
```

### 4.2 Tabelas NOVAS do CloudDesk (prefixo desk_)

```sql
-- Operadores do suporte
CREATE TABLE desk_agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        UUID REFERENCES auth.users(id),  -- login do operador
  email               TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  avatar_url          TEXT,
  role                TEXT CHECK (role IN ('admin', 'operator', 'viewer')) DEFAULT 'operator',
  status              TEXT CHECK (status IN ('online', 'away', 'offline')) DEFAULT 'offline',
  max_concurrent_chats INT DEFAULT 10,
  notification_sound  BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Conversas de suporte
CREATE TABLE desk_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id   UUID NOT NULL,          -- FK lógica → account.user_id (NÃO FK física para não acoplar)
  assigned_agent_id UUID REFERENCES desk_agents(id),
  channel           TEXT CHECK (channel IN ('chat', 'email')) DEFAULT 'chat',
  status            TEXT CHECK (status IN ('open', 'pending', 'snoozed', 'resolved')) DEFAULT 'open',
  priority          TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  subject           TEXT,
  sla_deadline      TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  snoozed_until     TIMESTAMPTZ,
  ai_active         BOOLEAN DEFAULT true,   -- Se IA está respondendo nesta conversa
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Mensagens
CREATE TABLE desk_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES desk_conversations(id) ON DELETE CASCADE NOT NULL,
  sender_type     TEXT CHECK (sender_type IN ('contact', 'agent', 'bot', 'system')) NOT NULL,
  sender_id       UUID,           -- account.user_id (contact) | desk_agents.id (agent) | NULL (bot/system)
  content         TEXT NOT NULL,
  content_type    TEXT CHECK (content_type IN ('text', 'html', 'image', 'file', 'note')) DEFAULT 'text',
  attachments     JSONB DEFAULT '[]',
  is_private_note BOOLEAN DEFAULT false,
  ai_generated    BOOLEAN DEFAULT false,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Tags
CREATE TABLE desk_tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6366f1'
);

CREATE TABLE desk_conversation_tags (
  conversation_id UUID REFERENCES desk_conversations(id) ON DELETE CASCADE,
  tag_id          UUID REFERENCES desk_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, tag_id)
);

-- Macros (respostas rápidas)
CREATE TABLE desk_macros (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  shortcut    TEXT,                        -- ex: "/saudacao"
  category    TEXT,
  variables   JSONB DEFAULT '[]',
  created_by  UUID REFERENCES desk_agents(id),
  is_shared   BOOLEAN DEFAULT true,
  usage_count INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Base de conhecimento
CREATE TABLE desk_knowledge_base (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  category     TEXT,
  tags         TEXT[] DEFAULT '{}',
  is_published BOOLEAN DEFAULT false,
  embedding    VECTOR(1536),
  created_by   UUID REFERENCES desk_agents(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Snippets (respostas curtas para IA)
CREATE TABLE desk_snippets (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title     TEXT NOT NULL,
  content   TEXT NOT NULL,
  category  TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Configuração de IA (multi-LLM)
CREATE TABLE desk_ai_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             TEXT CHECK (provider IN ('openai', 'anthropic', 'google', 'groq', 'custom')) NOT NULL,
  model                TEXT NOT NULL,
  api_key              TEXT NOT NULL,             -- Encriptada via Supabase Vault em produção
  is_active            BOOLEAN DEFAULT false,     -- APENAS 1 ativo por vez
  system_prompt        TEXT,
  temperature          FLOAT DEFAULT 0.7,
  max_tokens           INT DEFAULT 1024,
  confidence_threshold FLOAT DEFAULT 0.7,         -- Abaixo disso → escala pra humano
  fallback_provider_id UUID REFERENCES desk_ai_config(id),
  settings             JSONB DEFAULT '{}',        -- Para custom: { "endpoint": "https://..." }
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- CSAT
CREATE TABLE desk_csat (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES desk_conversations(id),
  account_user_id UUID NOT NULL,
  rating          INT CHECK (rating IN (1, 2, 3)) NOT NULL,  -- 1=😞 2=😐 3=😊
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Notas sobre contatos
CREATE TABLE desk_contact_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id UUID NOT NULL,
  agent_id        UUID REFERENCES desk_agents(id),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Log de atividades
CREATE TABLE desk_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES desk_conversations(id),
  agent_id        UUID REFERENCES desk_agents(id),
  action          TEXT NOT NULL,
  details         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Disparos (Avisos, Novidades, Banners, Tours) — ver seção 8 "Disparos (Outbound)"
-- desk_campaigns / desk_campaign_receipts / view desk_campaign_stats
-- (migration 20260921000000_outbound_campaigns.sql)

-- Índices
CREATE INDEX idx_desk_conv_status ON desk_conversations(status);
CREATE INDEX idx_desk_conv_assigned ON desk_conversations(assigned_agent_id);
CREATE INDEX idx_desk_conv_user ON desk_conversations(account_user_id);
CREATE INDEX idx_desk_conv_updated ON desk_conversations(updated_at DESC);
CREATE INDEX idx_desk_msg_conv ON desk_messages(conversation_id, created_at);
CREATE INDEX idx_desk_msg_created ON desk_messages(created_at DESC);
CREATE INDEX idx_desk_kb_embedding ON desk_knowledge_base USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_desk_snippets_embedding ON desk_snippets USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_desk_activity_conv ON desk_activity_log(conversation_id, created_at DESC);
```

---

## 5. AUTENTICAÇÃO

### Operadores (painel)
- Supabase Auth com email/senha
- Após login, verificar se email existe em `desk_agents`
- Se não existe → acesso negado ("Você não é um operador registrado")
- Admin cria operadores via tela Settings > Equipe
- Campo `desk_agents.auth_user_id` vincula ao `auth.users.id` do operador

### Clientes (widget)
- Já autenticados no app Cloudfy via Supabase Auth
- Widget detecta sessão ativa: `supabase.auth.getSession()`
- Usa `session.user.id` para buscar `account WHERE user_id = session.user.id`
- Se não há sessão → widget NÃO renderiza

**REGRA CRÍTICA:** Operadores e clientes compartilham o mesmo Supabase Auth mas têm papéis completamente distintos. RLS policies devem garantir que clientes só acessam suas próprias conversas e operadores acessam todas.

---

## 6. SUPABASE REALTIME

### Mensagens em tempo real
```typescript
// Padrão para subscribar em mensagens de uma conversa
const channel = supabase
  .channel(`conv-messages:${conversationId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'desk_messages',
    filter: `conversation_id=eq.${conversationId}`
  }, (payload) => {
    // Adicionar ao thread via Zustand store
    useConversationStore.getState().addMessage(payload.new);
  })
  .subscribe();

// CLEANUP: sempre remover subscription ao desmontar
return () => { supabase.removeChannel(channel); };
```

### Inbox em tempo real
```typescript
// Subscribar em todas as mudanças de conversas (para atualizar lista)
const channel = supabase
  .channel('inbox-changes')
  .on('postgres_changes', {
    event: '*',  // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'desk_conversations'
  }, (payload) => {
    useInboxStore.getState().handleConversationChange(payload);
  })
  .subscribe();
```

### Typing indicator (Presence)
```typescript
const presenceChannel = supabase.channel(`typing:${conversationId}`);

// Track com debounce de 2 segundos
const startTyping = () => {
  presenceChannel.track({ user_id, user_name, typing: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    presenceChannel.track({ user_id, user_name, typing: false });
  }, 2000);
};
```

---

## 7. MOTOR DE IA (Multi-LLM) — SEÇÃO CRÍTICA

A IA é o coração do CloudDesk. Ela NÃO é um chatbot genérico — é um agente especializado
que tem acesso profundo aos dados da Cloudfy e responde com conhecimento real sobre o cliente,
sua infraestrutura, seus pagamentos e o histórico completo de interações.

### 7.1 Persona da IA

A IA tem uma identidade configurável via tela Settings > IA > Persona. Os campos são:

```sql
-- Adicionar à tabela desk_ai_config:
ALTER TABLE desk_ai_config ADD COLUMN persona JSONB DEFAULT '{
  "name": "Luna",
  "role": "Assistente de suporte da Cloudfy",
  "tone": "Profissional, amigável e direta. Usa linguagem acessível para usuários não-técnicos. Evita jargão quando possível. Sempre em português do Brasil.",
  "rules": [
    "Sempre cumprimentar pelo nome do cliente",
    "Nunca inventar informações — se não sabe, escalar para humano",
    "Quando o problema envolve infraestrutura, sempre verificar o status antes de responder",
    "Para problemas de pagamento/billing, SEMPRE escalar para humano",
    "Usar emojis com moderação (máximo 1 por mensagem)",
    "Respostas curtas e objetivas (máximo 3 parágrafos)",
    "Se o cliente está irritado, reconhecer a frustração antes de ajudar",
    "Ao final de cada resposta, perguntar se resolveu ou se precisa de mais ajuda"
  ],
  "greeting": "Olá, {{client_name}}! Sou a Luna, assistente virtual da Cloudfy. Como posso te ajudar hoje?",
  "escalation_message": "Entendi! Vou te conectar com um de nossos especialistas agora. Um momento, por favor 🙏",
  "farewell": "Fico feliz em ter ajudado! Se precisar de algo mais, é só chamar. Até mais! 😊"
}';
```

O system_prompt enviado ao LLM é construído dinamicamente:
```
[PERSONA]
Seu nome é {persona.name}. Você é {persona.role}.
Tom de comunicação: {persona.tone}
Regras: {persona.rules (cada uma em bullet)}

[CONTEXTO DO CLIENTE]
{dados do pipeline de contexto — seção 7.3}

[INSTRUÇÕES]
{system_prompt customizado pelo admin}

[CONVERSA]
{histórico de mensagens}
```

### 7.2 Tabelas adicionais para IA avançada

```sql
-- FAQ dinâmico (perguntas mais frequentes — auto-gerado)
CREATE TABLE desk_faq (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question        TEXT NOT NULL,              -- Pergunta normalizada
  answer          TEXT NOT NULL,              -- Resposta padrão
  category        TEXT,
  hit_count       INT DEFAULT 1,             -- Quantas vezes foi perguntado
  last_asked_at   TIMESTAMPTZ DEFAULT now(),
  source          TEXT CHECK (source IN ('auto', 'manual')) DEFAULT 'auto',
  embedding       VECTOR(1536),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Regras de escalonamento inteligente por tema
CREATE TABLE desk_routing_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,              -- Ex: "Billing", "Infraestrutura", "Cancelamento"
  description     TEXT,
  keywords        TEXT[] NOT NULL,            -- Palavras-chave que ativam a regra
  category        TEXT NOT NULL,              -- Categoria do tema
  action          TEXT CHECK (action IN (
    'escalate_to_human',                     -- Escalar imediatamente
    'escalate_to_agent',                     -- Escalar para agente específico
    'escalate_to_team',                      -- Escalar para equipe/time
    'ai_respond_then_escalate',              -- IA responde mas já agenda escalação
    'ai_respond'                             -- IA responde normalmente
  )) DEFAULT 'ai_respond',
  target_agent_id UUID REFERENCES desk_agents(id),  -- Agente alvo (se action = escalate_to_agent)
  target_team     TEXT,                      -- Time alvo (se action = escalate_to_team)
  priority_override TEXT CHECK (priority_override IN ('low', 'medium', 'high', 'urgent')),
  is_active       BOOLEAN DEFAULT true,
  order_priority  INT DEFAULT 0,             -- Ordem de avaliação (menor = primeiro)
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Log de interações da IA (para analytics e melhoria contínua)
CREATE TABLE desk_ai_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES desk_conversations(id),
  message_id      UUID REFERENCES desk_messages(id),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_tokens   INT,
  completion_tokens INT,
  total_tokens    INT,
  latency_ms      INT,                       -- Tempo de resposta do LLM
  confidence      FLOAT,                     -- Score de confiança estimado
  context_sources JSONB DEFAULT '{}',        -- Quais fontes foram usadas { kb: [...ids], snippets: [...ids], faq: [...ids] }
  was_escalated   BOOLEAN DEFAULT false,
  agent_feedback  TEXT CHECK (agent_feedback IN ('good', 'bad', 'edited')),  -- Feedback do operador
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Índices para as novas tabelas
CREATE INDEX idx_desk_faq_embedding ON desk_faq USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_desk_faq_hits ON desk_faq(hit_count DESC);
CREATE INDEX idx_desk_routing_active ON desk_routing_rules(is_active, order_priority);
CREATE INDEX idx_desk_ai_interactions_conv ON desk_ai_interactions(conversation_id);
```

### 7.3 Pipeline de Contexto (COMPLETO)

Quando uma mensagem do cliente chega, a Edge Function `desk-ai-respond` monta o contexto
em 7 etapas ANTES de chamar o LLM. Cada etapa é uma consulta ao banco:

```
PIPELINE DE CONTEXTO DA IA — ORDEM DE EXECUÇÃO:

┌─────────────────────────────────────────────────────────────┐
│ STEP 1: VERIFICAÇÕES                                        │
│ ✓ desk_conversations.ai_active = true?                      │
│ ✓ desk_ai_config WHERE is_active = true? (provider existe?) │
│ ✓ Se falhou → ignorar, humano responde                      │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: ESCALONAMENTO INTELIGENTE                           │
│ Antes de responder, verificar desk_routing_rules:           │
│ - Analisar keywords da mensagem vs routing_rules.keywords   │
│ - Se match com action = 'escalate_to_human':                │
│   → NÃO responder, mudar status='pending', ai_active=false │
│   → Atribuir ao target_agent ou target_team se definido     │
│   → Enviar mensagem de sistema: persona.escalation_message  │
│   → Aplicar priority_override se definido                   │
│ - Se match com action = 'escalate_to_agent':                │
│   → Atribuir ao agente específico, escalar                  │
│ - Se match com action = 'ai_respond_then_escalate':         │
│   → IA responde mas marca conversa como 'pending'           │
│ - Se nenhum match ou action = 'ai_respond':                 │
│   → Continuar pipeline normal                               │
│                                                             │
│ REGRAS PRÉ-CONFIGURADAS SUGERIDAS:                          │
│ ┌──────────────────┬────────────────────┬──────────────────┐│
│ │ Tema             │ Keywords           │ Ação             ││
│ ├──────────────────┼────────────────────┼──────────────────┤│
│ │ Billing/Pagamento│ fatura, cobranç,   │ escalate_to_team ││
│ │                  │ pagamento, cartão, │ team: financeiro  ││
│ │                  │ reembolso, estorno │ priority: high   ││
│ ├──────────────────┼────────────────────┼──────────────────┤│
│ │ Cancelamento     │ cancelar, cancela, │ escalate_to_human││
│ │                  │ desistir, encerrar │ priority: urgent ││
│ ├──────────────────┼────────────────────┼──────────────────┤│
│ │ Infra crítica    │ fora do ar, caiu,  │ escalate_to_team ││
│ │                  │ offline, erro 500, │ team: suporte    ││
│ │                  │ não funciona, down │ priority: urgent ││
│ ├──────────────────┼────────────────────┼──────────────────┤│
│ │ Upgrade/Plano    │ upgrade, mudar     │ ai_respond_then_ ││
│ │                  │ plano, migrar      │ escalate         ││
│ └──────────────────┴────────────────────┴──────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: DADOS DO CLIENTE (tabelas existentes)               │
│                                                             │
│ Query 1 — account:                                          │
│   SELECT name, email, phone, stripe_customer_id,            │
│          has_purchase, created_at                            │
│   FROM account WHERE user_id = :account_user_id             │
│                                                             │
│ Query 2 — purchases + products:                             │
│   SELECT p.status, p.purchase_code, p.purchase_date,        │
│          p.amount, p.currency, p.stripe_subscription_id,    │
│          p.pending_deployment, p.deployment_failure_reason,  │
│          pr.name as product_name                            │
│   FROM purchases p                                          │
│   LEFT JOIN products pr ON p.product_id = pr.id             │
│   WHERE p.client_email = :account_email                     │
│   ORDER BY p.created_at DESC LIMIT 5                        │
│                                                             │
│ Resultado formatado no contexto:                            │
│ "Cliente: João Silva (joao@email.com)                       │
│  Cliente desde: 15/03/2025                                  │
│  Produto: Cloud Advanced (R$ 83,19/mês) — Status: PAID     │
│  Código: grouplivingpiranha"                                │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: STATUS DA INFRAESTRUTURA (tempo real)               │
│                                                             │
│ Query — infrastructure via purchases:                       │
│   SELECT i.*                                                │
│   FROM infrastructure i                                     │
│   JOIN purchases p ON p.linked_infrastructure_id = i.id     │
│   WHERE p.client_email = :account_email                     │
│   AND p.linked_infrastructure_id IS NOT NULL                │
│                                                             │
│ Dados adicionais de deployment:                             │
│   - pending_deployment: true/false                          │
│   - deployment_retry_count: número de tentativas            │
│   - deployment_failure_reason: motivo da falha (se houver)  │
│                                                             │
│ Resultado formatado:                                        │
│ "Infraestrutura do cliente:                                 │
│  - Status do deploy: Ativo (ou Pendente / Falhou)           │
│  - Tentativas de deploy: 0                                  │
│  - Serviços: N8N, Evolution API, Redis, Postgres (etc)"     │
│                                                             │
│ IMPORTANTE: Se a infra está com problema (pending=true ou   │
│ failure_reason preenchido), a IA deve PRIORIZAR esse        │
│ contexto e oferecer ajuda proativa sobre a infraestrutura.  │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: HISTÓRICO COMPLETO DO CLIENTE                       │
│                                                             │
│ Query — conversas anteriores resolvidas:                    │
│   SELECT c.id, c.subject, c.status, c.created_at,          │
│          c.resolved_at,                                     │
│          (SELECT content FROM desk_messages                 │
│           WHERE conversation_id = c.id                      │
│           AND sender_type = 'contact'                       │
│           ORDER BY created_at ASC LIMIT 1                   │
│          ) as first_message                                 │
│   FROM desk_conversations c                                 │
│   WHERE c.account_user_id = :account_user_id                │
│   AND c.id != :current_conversation_id                      │
│   ORDER BY c.created_at DESC LIMIT 10                       │
│                                                             │
│ Resultado formatado:                                        │
│ "Histórico do cliente (últimas 10 conversas):               │
│  1. [Resolvida 20/02] 'Meu N8N não está abrindo' → Resol.  │
│  2. [Resolvida 15/02] 'Como alterar senha do Chatwoot'      │
│  3. [Resolvida 10/01] 'Erro ao conectar Evolution API'      │
│  ..."                                                       │
│                                                             │
│ IMPORTANTE: Isso permite à IA identificar problemas         │
│ recorrentes. Se o cliente já perguntou 3x sobre N8N, a IA   │
│ deve sugerir escalonamento para investigação mais profunda.  │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: BUSCA SEMÂNTICA (Central de Ajuda + Snippets + FAQ) │
│                                                             │
│ 6a. Converter mensagem do cliente em embedding:             │
│     embedding = await generateEmbedding(message.content)    │
│                                                             │
│ 6b. Buscar na Base de Conhecimento (top 5):                 │
│   SELECT id, title, content, category                       │
│   FROM desk_knowledge_base                                  │
│   WHERE is_published = true                                 │
│   ORDER BY embedding <=> :query_embedding                   │
│   LIMIT 5                                                   │
│                                                             │
│ 6c. Buscar nos Snippets (top 3):                            │
│   SELECT id, title, content                                 │
│   FROM desk_snippets                                        │
│   ORDER BY embedding <=> :query_embedding                   │
│   LIMIT 3                                                   │
│                                                             │
│ 6d. Buscar no FAQ dinâmico (top 3):                         │
│   SELECT id, question, answer                               │
│   FROM desk_faq                                             │
│   ORDER BY embedding <=> :query_embedding                   │
│   LIMIT 3                                                   │
│                                                             │
│ Resultado formatado:                                        │
│ "[BASE DE CONHECIMENTO]                                     │
│  Artigo: 'Como resetar senha do Chatwoot'                   │
│  Conteúdo: Para resetar a senha, acesse...                  │
│  ---                                                        │
│  Artigo: 'Configurando Evolution API'                       │
│  Conteúdo: ...                                              │
│                                                             │
│  [SNIPPETS]                                                 │
│  - Reset de senha: Acesse Configurações > Conta > ...       │
│                                                             │
│  [PERGUNTAS FREQUENTES]                                     │
│  - 'Como resetar minha senha?' → ..."                       │
│                                                             │
│ 6e. Atualizar FAQ hit_count:                                │
│   Se a pergunta é similar a um FAQ existente (similarity >  │
│   0.92), incrementar hit_count e last_asked_at.             │
│   Se não existe FAQ similar, criar novo registro            │
│   automaticamente com source='auto'.                        │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: CONVERSA ATUAL (últimas 20 mensagens)               │
│                                                             │
│   SELECT sender_type, content, ai_generated, created_at     │
│   FROM desk_messages                                        │
│   WHERE conversation_id = :conversation_id                  │
│   AND is_private_note = false                               │
│   ORDER BY created_at DESC LIMIT 20                         │
│                                                             │
│ Formatado como array de messages para o LLM:                │
│ [                                                           │
│   { role: "user", content: "Meu N8N não abre..." },         │
│   { role: "assistant", content: "Olá João! Vou..." },       │
│   { role: "user", content: "Já tentei reiniciar" }          │
│ ]                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: MONTAR PROMPT + CHAMAR LLM                          │
│                                                             │
│ System prompt montado dinamicamente:                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [IDENTIDADE]                                            │ │
│ │ Seu nome é Luna. Você é Assistente de suporte da        │ │
│ │ Cloudfy, uma empresa SaaS de infraestrutura.            │ │
│ │ Tom: Profissional, amigável e direta...                 │ │
│ │ Regras: (lista de persona.rules)                        │ │
│ │                                                         │ │
│ │ [DADOS DO CLIENTE]                                      │ │
│ │ Nome: João Silva | Email: joao@email.com                │ │
│ │ Produto: Cloud Advanced | Status: PAID | Desde: 15/03   │ │
│ │                                                         │ │
│ │ [INFRAESTRUTURA]                                        │ │
│ │ Deploy: Ativo | Serviços: N8N, Evolution API, Redis     │ │
│ │                                                         │ │
│ │ [HISTÓRICO - últimas 10 conversas]                      │ │
│ │ 1. [Resolvida] Meu N8N não está abrindo                │ │
│ │ 2. [Resolvida] Como alterar senha do Chatwoot           │ │
│ │                                                         │ │
│ │ [BASE DE CONHECIMENTO RELEVANTE]                        │ │
│ │ (artigos, snippets e FAQs encontrados no Step 6)        │ │
│ │                                                         │ │
│ │ [INSTRUÇÕES ADICIONAIS DO ADMIN]                        │ │
│ │ (system_prompt customizado pelo admin na config)        │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Chamar LLM ativo com messages da conversa:                  │
│ (código por provider abaixo)                                │
│                                                             │
│ Pós-resposta:                                               │
│ - INSERT em desk_messages (sender_type='bot', ai=true)      │
│ - INSERT em desk_ai_interactions (tokens, latência, fontes) │
│ - Se resposta contém frases de incerteza ("não tenho        │
│   certeza", "não consigo", "melhor falar com") →            │
│   confidence = 0.3 → escalar se < threshold                 │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Chamada por provider

```typescript
// OpenAI / Groq (API compatível com OpenAI)
fetch('https://api.openai.com/v1/chat/completions', {
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...conversationMessages],
    temperature,
    max_tokens
  })
});

// Anthropic
fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    system: systemPrompt,
    messages: conversationMessages,
    temperature,
    max_tokens
  })
});

// Google AI (Gemini)
fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: conversationMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    })),
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  })
});

// Groq (mesma interface do OpenAI)
fetch('https://api.groq.com/openai/v1/chat/completions', {
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...conversationMessages],
    temperature,
    max_tokens
  })
});

// Custom endpoint (qualquer API compatível com OpenAI)
fetch(config.settings.endpoint, {
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...conversationMessages],
    temperature,
    max_tokens
  })
});
```

### 7.5 FAQ Dinâmico (auto-aprendizado)

O sistema aprende automaticamente as perguntas mais frequentes:

```
1. Toda mensagem do cliente passa pela busca semântica no desk_faq
2. Se similarity > 0.92 com FAQ existente:
   → hit_count++ e last_asked_at = now()
   → Usa a resposta do FAQ como contexto PRIORITÁRIO para o LLM
3. Se similarity < 0.92 e nenhum FAQ match:
   → Após IA responder com sucesso (sem escalação):
   → Cria novo FAQ com source='auto':
     question = mensagem normalizada do cliente
     answer = resposta da IA
     embedding = embedding da pergunta
4. Tela de FAQ (Settings > FAQ):
   - Lista ordenada por hit_count (mais perguntados primeiro)
   - Admin pode: editar resposta, mudar source para 'manual', deletar
   - FAQs manuais têm prioridade sobre auto-gerados na busca
   - Filtro: auto vs manual, por categoria
```

### 7.6 Escalonamento Inteligente por Tema

As routing rules são avaliadas ANTES da IA responder (Step 2 do pipeline):

```
Avaliação: verificar TODAS as regras ativas ordenadas por order_priority.
Para cada regra: checar se QUALQUER keyword está contida na mensagem (case-insensitive).
Primeira regra que faz match → executar ação.

Ações possíveis:
┌──────────────────────────┬────────────────────────────────────────────┐
│ Ação                     │ Comportamento                              │
├──────────────────────────┼────────────────────────────────────────────┤
│ escalate_to_human        │ IA NÃO responde. Status→pending.           │
│                          │ ai_active→false. Notifica todos operadores.│
│                          │ Envia persona.escalation_message ao cliente│
├──────────────────────────┼────────────────────────────────────────────┤
│ escalate_to_agent        │ Igual acima mas atribui a agente específico│
│                          │ assigned_agent_id = target_agent_id        │
├──────────────────────────┼────────────────────────────────────────────┤
│ escalate_to_team         │ Igual acima mas atribui ao time.           │
│                          │ Busca operador online no time com menos    │
│                          │ chats ativos. Se nenhum online → pending.  │
├──────────────────────────┼────────────────────────────────────────────┤
│ ai_respond_then_escalate │ IA responde normalmente MAS muda status    │
│                          │ para 'pending' para humano revisar depois. │
├──────────────────────────┼────────────────────────────────────────────┤
│ ai_respond               │ IA responde normalmente (padrão).          │
└──────────────────────────┴────────────────────────────────────────────┘

Tela de Routing Rules (Settings > Escalonamento):
- CRUD de regras com: nome, keywords (tag input), ação, agente/time alvo, prioridade
- Drag & drop para reordenar (order_priority)
- Toggle ativo/inativo por regra
- Preview: campo de teste onde admin digita mensagem e vê qual regra ativaria
```

### 7.7 Handoff IA ↔ Humano

```
IA → Humano (escalonamento):
- Routing rule com action de escalação → imediato
- Confiança abaixo do threshold → automático
- Cliente clica "Falar com humano" no widget → imediato
- Operador envia primeira mensagem → ai_active = false automaticamente

Em todos os casos:
  desk_conversations.ai_active = false
  desk_conversations.status = 'pending'
  Mensagem de sistema: "Conversa transferida para atendimento humano"
  Notificação para operadores (desktop + som + toast)

Humano → IA (reativação):
- Operador clica "Reativar IA" na conversa → ai_active = true
- Mensagem de sistema: "IA reativada nesta conversa"
- Próxima mensagem do cliente será respondida pela IA novamente

Modo híbrido (ai_respond_then_escalate):
- IA responde mas conversa fica em 'pending'
- Operador vê badge "Revisar resposta da IA"
- Pode editar, complementar ou apenas confirmar
```

### 7.8 Analytics da IA (tela Settings > IA > Métricas)

Dados vindos da tabela `desk_ai_interactions`:

- Taxa de resolução pela IA (conversas resolvidas sem humano / total)
- Tempo médio de resposta da IA (latency_ms médio)
- Tokens consumidos (total e por provider) — para controle de custos
- Taxa de escalação (was_escalated = true / total)
- Top 5 perguntas mais frequentes (desk_faq ORDER BY hit_count DESC)
- Feedback dos operadores (% good vs bad vs edited)
- Custo estimado por conversa (tokens × preço por token do provider)
- Gráfico: volume de interações IA ao longo do tempo

---

## 8. CHAT WIDGET

### Arquitetura
- Componentes React compilados em bundle JS standalone
- Inserido via `<script>` na área logada do app Cloudfy
- Usa Shadow DOM para isolamento total de CSS
- Detecta sessão Supabase existente do cliente (mesmo projeto Supabase)

### Configuração via window
```typescript
window.CloudDeskSettings = {
  supabase_url: "https://xxxx.supabase.co",
  supabase_anon_key: "eyJxxxx",
  position: "bottom-right",        // "bottom-right" | "bottom-left"
  color: "#6366f1",                 // Cor accent do widget
  greeting: "Olá! Como podemos ajudar?",
  widget_name: "CloudDesk",
  quick_actions: ["Problema técnico", "Dúvida sobre plano", "Minha infraestrutura"],
  allowed_origins: ["https://app.cloudfy.com", "https://*.cloudfy.com"]
};
```

### Fluxo do widget
```
1. Script carrega → lê window.CloudDeskSettings
2. supabase.auth.getSession() → tem sessão? Se não → não renderiza
3. Busca account WHERE user_id = session.user.id
4. Busca desk_conversations WHERE account_user_id = user_id AND status != 'resolved' (conversa aberta?)
5. Se tem conversa aberta → mostra thread existente
6. Se não tem → mostra tela de boas-vindas com quick_actions
7. Subscribe em Realtime para receber mensagens em tempo real
8. Ao resolver → mostra CSAT (😞😐😊)
```

### Disparos (Outbound) — Avisos, Novidades, Banners e Tours guiados

Comunicação proativa dentro do bubble, gerenciada em **Configurações › Disparos**
(equivalente ao "Saídas" do Intercom: Post, News item, Banner, Tour). Nada de código
para publicar.

**Modelo** (`supabase/migrations/20260921000000_outbound_campaigns.sql`):

| Tabela / view | Papel |
|---|---|
| `desk_campaigns` | Um registro por disparo. `type` ∈ notice/news/banner/tour; `content` e `audience` em JSONB (contrato em `src/lib/outbound.ts`, espelho Deno em `_shared/campaigns.ts`). `status` ∈ draft/active/paused/archived — "Agendado"/"Encerrado" são **derivados** de `starts_at`/`ends_at`, não estados próprios. |
| `desk_campaign_receipts` | Uma linha por (disparo, e-mail): viu/clicou/fechou/concluiu, `step_reached` do tour, `reaction`. Fonte tanto do "não mostrar de novo" quanto das métricas (**pessoas únicas**, não impressões). Só o gateway escreve, via `desk_campaign_track()` (service role). |
| `desk_campaign_stats` | View `security_invoker` agregando receipts para a lista do painel. |

**Público** (`audience`): `segment` (all/with_plan/without_plan/plans), `plans[]`, `infra`
(any/active/blocked/none), `new_customer_days`, `url_pattern` e `test_emails`. Plano e
infra são avaliados **server-side** com o mesmo `detectPlanTag` da IA; `url_pattern` é
avaliado **no widget** (o app do host navega sem recarregar — `useCurrentHref`).
`test_emails` veem o disparo mesmo em rascunho, com etiqueta "Prévia" — é o "enviar
teste para mim". A estimativa "≈ N clientes" do editor vem da Edge Function
`desk-campaigns-admin` (varre o Supabase de produção da Cloudfy, cache 5 min) e usa a
**mesma** `matchesAudience` do gateway.

**Widget** (`src/components/widget/outbound/`):
- Ações novas do gateway `desk-widget-api`: `campaigns` (elegíveis + estado do cliente)
  e `campaign_event` (seen/click/dismiss/complete/step/react). Carregados na carga da
  página (`useLoadCampaigns` no `EmbedRoot`) porque popup e tour rodam com o widget
  **fechado**; recarrega ao voltar o foco e no broadcast `outbound-live` que o painel
  publica ao publicar/pausar (`notifyCampaignsChanged`).
- Com o widget fechado aparece **no máximo uma coisa** (`OutboundClosedLayer`): aviso de
  resposta da equipe > popup de aviso > pílula de banner. Tour em andamento esconde tudo.
- Aberto: banner sob o header (só nas telas de raiz), avisos como cards no topo da lista,
  aba **Novidades** (feed + reações + tours "Iniciar/Rever"). A barra de abas só existe
  quando há algo em Novidades — sem disparos o widget fica como sempre foi.
- Tour (`TourOverlay` + `TourRunner`): spotlight por máscara SVG **sem capturar
  cliques** (é assim que "avançar por clique" funciona), card posicionado por
  `positionCard`, espera o elemento até 6 s (MutationObserver), aceita seletor CSS ou o
  valor de `data-tour="..."`. Progresso em `localStorage` (`clouddesk-tour:{id}`) para
  retomar após navegação; `clouddesk-tour-done:{id}` evita reabrir antes do receipt
  voltar. Auto-start: uma tentativa por carga de página, 1,5 s após a carga.
- Os cards são **os mesmos componentes** no widget e na prévia do editor
  (`CampaignPreview`, com `data-theme="light"` para mostrar a paleta que o cliente vê).

---

## 9. EDGE FUNCTIONS

### desk-stripe-customer
```
Input:  { stripe_customer_id: string }
Auth:   Apenas operadores (verificar JWT)
Secret: STRIPE_SECRET_KEY (restricted, read-only)
Calls:  GET /v1/customers/:id
        GET /v1/subscriptions?customer=:id&limit=5
        GET /v1/charges?customer=:id&limit=3
Output: { customer, subscriptions[], recent_charges[] }
Cache:  5 min em memória
```

### desk-ai-respond (FUNÇÃO MAIS COMPLEXA — ver seção 7 para pipeline completo)
```
Input:  { conversation_id: string, message_id: string }
Auth:   Service role (chamada interna)
Secret: Nenhum (usa api_key da desk_ai_config)
Flow:   
  1. Verifica ai_active e provider ativo
  2. Avalia routing rules (escalonamento por tema)
  3. Busca dados do cliente (account + purchases)
  4. Busca status da infraestrutura
  5. Busca histórico de conversas anteriores
  6. Busca semântica (knowledge_base + snippets + FAQ)
  7. Busca últimas 20 mensagens da conversa atual
  8. Monta system_prompt com persona + contexto completo
  9. Chama LLM ativo (OpenAI/Anthropic/Google/Groq/Custom)
  10. Salva resposta + log em desk_ai_interactions
  11. Atualiza FAQ dinâmico se aplicável
Output: Insere desk_messages + desk_ai_interactions
```

### desk-ai-evaluate-routing
```
Input:  { message: string }
Auth:   Apenas operadores
Flow:   Avalia routing rules contra mensagem de teste
Output: { matched_rule: {...} | null, action: string }
Uso:    Preview de regras na tela Settings > Escalonamento
```

### desk-campaigns-admin
```
Input:  { action: 'audience_estimate', audience: CampaignAudience }
Auth:   Apenas operadores
Flow:   Varre account + infrastructure do Supabase de produção (read-only, paginado,
        cache 5 min) e aplica matchesAudience — mesma lógica do gateway
Output: { matched, total, by_plan }
Uso:    "≈ N clientes vão ver" no editor de Disparos
```

### desk-generate-embedding
```
Input:  { text: string, table: 'knowledge_base' | 'snippets', record_id: string }
Auth:   Apenas operadores
Flow:   Gera embedding via LLM ativo → UPDATE na tabela correspondente
```

### desk-inbound-email (Fase 3)
```
Input:  Webhook payload do Resend
Auth:   Webhook signature verification
Flow:   Parse email → busca account → cria/atualiza conversa
```

---

## 10. DESIGN SYSTEM

### Tema escuro (padrão)
```
Background:      #0f1117    (bg-[#0f1117])
Surface/Cards:   #1a1d2e    (bg-[#1a1d2e])
Sidebar:         #12141f    (bg-[#12141f])
Border:          #2a2d3e    (border-[#2a2d3e])
Text Primary:    #f0f0f0    (text-[#f0f0f0])
Text Secondary:  #9ca3af    (text-gray-400)
Accent:          #6366f1    (bg-indigo-500)
Success:         #10b981    (text-emerald-500)
Warning:         #f59e0b    (text-amber-500)
Error:           #f43f5e    (text-rose-500)
```

### Componentes visuais de mensagem
| sender_type | Alinhamento | Cor do fundo | Detalhe |
|-------------|-------------|-------------|---------|
| contact | Esquerda | gray-700/800 | Avatar com iniciais do nome |
| agent | Direita | indigo-600 | Avatar do operador |
| bot | Direita | indigo-500 (mais claro) | Badge "IA" + ícone robô |
| system | Centro | transparente | Texto pequeno, cinza, sem bolha |
| note (private) | Full width | amber-900/20 | Ícone cadeado + "Visível apenas para a equipe" |

### Padrões obrigatórios
- **Loading:** skeleton placeholders em todas as listas (shadcn Skeleton)
- **Empty states:** ícone + texto + CTA em todas as seções sem dados
- **Toasts:** shadcn Toast para todas as ações (sucesso, erro)
- **Transições:** 150ms ease para hover e mudanças de estado
- **Responsivo:** desktop-first no painel, mobile-first no widget
- **Idioma:** todos os textos em português do Brasil
- **Datas:** formato pt-BR (dd/mm/yyyy HH:mm), timestamps relativos ("há 2 min")

---

## 11. ATALHOS DE TECLADO

| Atalho | Ação |
|--------|------|
| `Ctrl+K` / `Cmd+K` | Busca global (conversas, contatos, macros) |
| `Ctrl+Enter` | Enviar mensagem e resolver conversa |
| `Ctrl+Shift+N` | Inserir nota interna |
| `/` no editor | Abrir seletor de macros |
| `Ctrl+[` / `Ctrl+]` | Navegar entre conversas |
| `E` (fora do editor) | Atribuir conversa para mim |
| `R` (fora do editor) | Marcar como resolvida |
| `Escape` | Fechar modal/drawer aberto |

---

## 12. MACROS (Variáveis dinâmicas)

| Variável | Valor |
|----------|-------|
| `{{contact.name}}` | account.name |
| `{{contact.email}}` | account.email |
| `{{agent.name}}` | desk_agents.name |
| `{{ticket.id}}` | Primeiros 8 chars do desk_conversations.id |
| `{{product.name}}` | Nome do produto (via purchases → products) |
| `{{purchase.status}}` | purchases.status |

Ao inserir macro, substituir variáveis antes de colocar no editor.

---

## 13. SLA (Service Level Agreement)

| Prioridade | Tempo alvo de resposta |
|------------|----------------------|
| Urgent | 15 minutos |
| High | 1 hora |
| Medium | 4 horas |
| Low | 24 horas |

Ao criar conversa, calcular `sla_deadline = created_at + tempo_alvo`.
Visual na inbox: badge amarelo quando < 25% do tempo restante, vermelho quando estourou.

---

## 14. NOTIFICAÇÕES

```typescript
// Desktop notification
if (Notification.permission === 'granted') {
  new Notification('Nova mensagem', {
    body: `${contact.name}: ${message.content.substring(0, 100)}`,
    icon: '/logo.png',
    tag: conversationId  // Evita duplicatas
  });
}

// Som (respeitar configuração do operador)
if (agent.notification_sound) {
  const audio = new Audio('/notification-sound.mp3');
  audio.volume = 0.3;
  audio.play();
}

// Badge no título da aba
document.title = unreadCount > 0 ? `(${unreadCount}) CloudDesk` : 'CloudDesk';
```

---

## 15. RLS (Row Level Security)

```sql
-- Operadores: acessam tudo das tabelas desk_*
CREATE POLICY "agents_full_access" ON desk_conversations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM desk_agents WHERE auth_user_id = auth.uid())
  );

-- Clientes: acessam apenas suas próprias conversas
CREATE POLICY "contacts_own_conversations" ON desk_conversations
  FOR SELECT USING (account_user_id = auth.uid());

CREATE POLICY "contacts_own_messages" ON desk_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM desk_conversations
      WHERE desk_conversations.id = desk_messages.conversation_id
      AND desk_conversations.account_user_id = auth.uid()
    )
    AND is_private_note = false  -- Clientes NÃO veem notas internas
  );

-- Clientes podem inserir mensagens nas suas conversas
CREATE POLICY "contacts_insert_messages" ON desk_messages
  FOR INSERT WITH CHECK (
    sender_type = 'contact'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM desk_conversations
      WHERE id = conversation_id AND account_user_id = auth.uid()
    )
  );
```

---

## 16. CONVENÇÕES DE CÓDIGO

### Geral
- TypeScript strict mode habilitado
- Sem `any` — tipar tudo
- Componentes como funções (sem classes)
- Um componente por arquivo
- Nomes de componentes em PascalCase, hooks com prefixo `use`
- Arquivos de componente: PascalCase.tsx
- Arquivos de utilidade/hooks: camelCase.ts

### Imports
```typescript
// Ordem de imports:
// 1. React
// 2. Bibliotecas externas
// 3. Componentes internos
// 4. Hooks
// 5. Stores
// 6. Types
// 7. Utils/constants

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ConversationItem } from './ConversationItem';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import { useInboxStore } from '@/stores/useInboxStore';
import type { DeskConversation } from '@/types/database';
import { formatRelativeDate } from '@/lib/utils';
```

### Estado
- Estado local: `useState` (coisas do componente)
- Estado compartilhado: Zustand stores (dados globais)
- Estado do servidor: fetch direto do Supabase (sem React Query por ora, manter simples)

### Supabase queries
```typescript
// SEMPRE usar o client importado de @/lib/supabase
import { supabase } from '@/lib/supabase';

// SEMPRE tipar o retorno
const { data, error } = await supabase
  .from('desk_conversations')
  .select('*, desk_messages(*)')
  .eq('status', 'open')
  .order('updated_at', { ascending: false });

// SEMPRE tratar erros
if (error) {
  toast.error('Erro ao carregar conversas');
  console.error(error);
  return;
}
```

### Commits
- Mensagens em inglês
- Prefixos: `feat:`, `fix:`, `refactor:`, `ui:`, `chore:`
- Exemplos: `feat: add realtime message subscription`, `fix: typing indicator debounce`

---

## 17. FASES DE IMPLEMENTAÇÃO

### ✅ Fase 0 — Scaffolding (concluída pelo Lovable)
- Projeto React + TypeScript + Vite
- Componentes base do widget (ChatBubbleButton, ChatWidget, etc.)
- WidgetPreview page
- Zustand store do widget

### 🔨 Fase 1 — Fundação (PRIORIDADE)
1. Migration SQL (todas as tabelas desk_*)
2. Auth de operadores + Login page + ProtectedRoute
3. Layout principal (Sidebar + InboxLayout 3 colunas)
4. ConversationList + ConversationItem (com dados mock, depois real)
5. ConversationThread + MessageBubble (5 tipos de bolha)
6. MessageComposer (editor + envio + Realtime)
7. ConversationDetails + ClientInfoPanel (integração account + purchases)
8. Supabase Realtime para mensagens e inbox
9. Notificações (desktop + som + badge)

### 📋 Fase 2 — Widget funcional
1. Conectar widget ao Supabase real (auth do cliente)
2. Criar/recuperar conversa pelo widget
3. Enviar/receber mensagens em tempo real
4. Typing indicator (Presence)
5. CSAT ao resolver

### 📋 Fase 3 — Motor de IA (EXPANDIDA)
1. Edge Function desk-ai-respond (pipeline completo de 8 steps)
2. Tela Settings > IA (CRUD de providers + configuração de persona)
3. Busca semântica (embeddings via pgvector)
4. Base de Conhecimento + Snippets (CRUD + geração de embedding)
5. FAQ dinâmico (auto-aprendizado + CRUD manual)
6. Regras de escalonamento inteligente (desk_routing_rules + tela Settings > Escalonamento)
7. Edge Function desk-ai-evaluate-routing (preview de regras)
8. Handoff IA ↔ Humano (bidirecional)
9. Log de interações da IA (desk_ai_interactions)
10. Tela Settings > IA > Métricas (analytics da IA)

### 📋 Fase 4 — Stripe + Email
1. Edge Function desk-stripe-customer
2. StripePanel no painel de detalhes
3. Canal de email (Resend webhooks)

### 📋 Fase 5 — Analytics + Polish
1. Dashboard de métricas (Recharts) incluindo métricas de IA
2. Tabela de performance da equipe
3. CRM/Contatos (leitura de account)
4. Configurações gerais, SLA, tags, macros
5. Polimento final (skeletons, empty states, performance)

---

## 18. VARIÁVEIS DE AMBIENTE

```env
# .env.local (nunca commitar)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxx

# Supabase Secrets (via dashboard ou CLI, para Edge Functions)
STRIPE_SECRET_KEY=rk_live_xxxx        # Restricted key, read-only
RESEND_API_KEY=re_xxxx                 # Para envio de emails (Fase 4)
```

---

## 19. COMANDOS ÚTEIS

```bash
# Dev
npm run dev                    # Start dev server
npm run build                  # Build produção
npm run preview                # Preview do build

# Supabase
npx supabase start             # Supabase local
npx supabase db push           # Aplicar migrations
npx supabase functions serve   # Edge Functions local
npx supabase gen types typescript --linked > src/types/database.ts  # Gerar types

# Lint
npx tsc --noEmit               # Type check
```

---

## 20. REGRAS ABSOLUTAS

1. **NUNCA** modificar tabelas existentes (account, purchases, products, infrastructure, users)
2. **NUNCA** salvar API keys no frontend — usar Edge Functions + Supabase Secrets
3. **NUNCA** fazer polling — usar Supabase Realtime para TUDO que é tempo real
4. **NUNCA** pedir dados do cliente no widget — ele já está logado
5. **NUNCA** usar `any` em TypeScript
6. **NUNCA** esquecer de limpar subscriptions Realtime no cleanup do useEffect
7. **NUNCA** commitar .env.local ou chaves
8. **SEMPRE** usar prefixo `desk_` nas tabelas novas
9. **SEMPRE** tratar erros de queries Supabase com toast de feedback
10. **SEMPRE** manter textos em português do Brasil
11. **SEMPRE** usar shadcn/ui para componentes de UI
12. **SEMPRE** implementar skeleton loading em listas e painéis
