-- ─── desk_conversations.tags ──────────────────────────────────────────────────
-- Tags livres por conversa (text[]). A primeira é a tag automática de plano
-- (max / ultra / advanced / starter / sem-plano), gravada pela Edge Function
-- desk-ai-respond a cada resposta da IA. O painel lê esta coluna para mostrar
-- o badge de plano na lista de conversas (item 3).

ALTER TABLE public.desk_conversations
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Índice GIN para filtrar conversas por tag de forma eficiente.
CREATE INDEX IF NOT EXISTS idx_desk_conv_tags
  ON public.desk_conversations USING gin (tags);
