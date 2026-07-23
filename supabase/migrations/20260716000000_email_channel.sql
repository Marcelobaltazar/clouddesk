-- ─── Canal de e-mail (Gmail API, Google puro) ──────────────────────────────────
--
-- O schema já suporta channel='email'. Aqui adicionamos as colunas de threading
-- do Gmail em desk_conversations, para casar respostas na conversa certa e
-- responder na mesma thread do cliente.
--
-- Tudo escrito server-side pela Edge Function (service role) — sem acesso anon.

ALTER TABLE public.desk_conversations
  ADD COLUMN IF NOT EXISTS email_thread_id   text,   -- Gmail threadId (agrupa a conversa)
  ADD COLUMN IF NOT EXISTS email_message_id  text,   -- último RFC Message-ID (In-Reply-To da próxima resposta)
  ADD COLUMN IF NOT EXISTS email_references  text,   -- cadeia References acumulada
  ADD COLUMN IF NOT EXISTS email_subject     text;   -- assunto original (para "Re: ...")

-- Uma conversa por thread de e-mail: acha rápido a conversa ao chegar resposta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_conv_email_thread
  ON public.desk_conversations (email_thread_id)
  WHERE email_thread_id IS NOT NULL;

-- Índice por canal (a inbox filtra chat vs email).
CREATE INDEX IF NOT EXISTS idx_desk_conv_channel
  ON public.desk_conversations (channel);

-- ── Dedup de mensagens de e-mail já processadas ────────────────────────────────
-- Guarda o gmailMessageId de cada e-mail inbound processado, para o poll ser
-- idempotente (não recriar mensagem se o mesmo e-mail for lido duas vezes).
CREATE TABLE IF NOT EXISTS public.desk_email_seen (
  gmail_message_id text PRIMARY KEY,
  conversation_id  uuid REFERENCES public.desk_conversations(id) ON DELETE CASCADE,
  seen_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS ligado sem policies: só o service role (Edge Function) acessa.
ALTER TABLE public.desk_email_seen ENABLE ROW LEVEL SECURITY;

-- Limpeza oportunista de registros antigos (>90 dias) fica a cargo da função.
