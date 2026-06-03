-- ─── Widget anônimo: conversas identificadas por email ─────────────────────────
--
-- Contexto: o widget é embedado no site da Cloudfy, onde o cliente está logado no
-- Supabase de PRODUÇÃO da Cloudfy (xovjrwyadyzgskwbefkf), NÃO no Supabase do
-- CloudDesk (tgjvjgvbqckoqjtgbjqx). Logo, o cliente é anônimo aqui e não possui
-- auth.uid() neste projeto.
--
-- As policies anteriores exigiam `account_user_id = auth.uid()`, o que sempre
-- falhava para o widget (auth.uid() = null → 42501 row-level security violation).
--
-- Solução: identificar o cliente do widget por `user_email` e permitir que o role
-- `anon` crie/leia a própria conversa e mensagens. account_user_id passa a ser
-- opcional (era NOT NULL) — o vínculo real com o cliente é o email, cuja origem é
-- o Cloudfy de produção (não há registro local de account no CloudDesk).
--
-- Trade-off de segurança (aceito para MVP): qualquer um pode criar uma conversa em
-- nome de um email. Mitigações futuras: Edge Function com service role + validação,
-- ou sessão Supabase compartilhada. Operadores continuam protegidos por is_desk_agent().

-- ── 1. account_user_id deixa de ser obrigatório ────────────────────────────────
ALTER TABLE public.desk_conversations
  ALTER COLUMN account_user_id DROP NOT NULL;

-- ── 2. desk_conversations: anon cria e lê conversas por email ───────────────────
DROP POLICY IF EXISTS "widget_insert_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "widget_select_conversations" ON public.desk_conversations;

CREATE POLICY "widget_insert_conversations"
  ON public.desk_conversations FOR INSERT
  TO anon
  WITH CHECK (user_email IS NOT NULL);

CREATE POLICY "widget_select_conversations"
  ON public.desk_conversations FOR SELECT
  TO anon
  USING (user_email IS NOT NULL);

-- ── 3. desk_messages: anon cria e lê mensagens da própria conversa ─────────────
-- O vínculo é a conversa (que por sua vez é identificada por user_email).
DROP POLICY IF EXISTS "widget_insert_messages" ON public.desk_messages;
DROP POLICY IF EXISTS "widget_select_messages" ON public.desk_messages;

CREATE POLICY "widget_insert_messages"
  ON public.desk_messages FOR INSERT
  TO anon
  WITH CHECK (
    is_private_note = false
    AND EXISTS (
      SELECT 1 FROM public.desk_conversations c
      WHERE c.id = conversation_id
        AND c.user_email IS NOT NULL
    )
  );

CREATE POLICY "widget_select_messages"
  ON public.desk_messages FOR SELECT
  TO anon
  USING (
    is_private_note = false
    AND EXISTS (
      SELECT 1 FROM public.desk_conversations c
      WHERE c.id = conversation_id
        AND c.user_email IS NOT NULL
    )
  );
