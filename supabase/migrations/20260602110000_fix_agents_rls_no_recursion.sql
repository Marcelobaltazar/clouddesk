-- ─── Fix RLS recursion: desk_agents e todas as tabelas desk_* ────────────────
--
-- PROBLEMA: todas as policies que verificam "é um agente?" fazem:
--   EXISTS (SELECT 1 FROM desk_agents WHERE auth_user_id = auth.uid())
-- Isso causa "infinite recursion" porque o PostgreSQL tenta avaliar as
-- policies de desk_agents para executar o SELECT dentro delas mesmas.
--
-- SOLUÇÃO: criar duas funções SECURITY DEFINER que rodam com o role do
-- proprietário (service role), bypassando RLS completamente ao verificar
-- se o usuário corrente é agente ou admin.

-- ── Funções helper (SECURITY DEFINER bypassa RLS) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.is_desk_agent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.desk_agents
    WHERE auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_desk_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.desk_agents
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ── desk_agents ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "agents_read_all_agents"    ON public.desk_agents;
DROP POLICY IF EXISTS "agents_read_own_row"        ON public.desk_agents;
DROP POLICY IF EXISTS "admins_manage_agents"       ON public.desk_agents;
DROP POLICY IF EXISTS "agents_update_own_status"   ON public.desk_agents;

-- Leitura: cada agente pode ler a própria linha + admins leem todas.
-- Sem recursão: is_desk_agent() usa SECURITY DEFINER.
CREATE POLICY "agents_select"
  ON public.desk_agents FOR SELECT
  USING (auth_user_id = auth.uid() OR public.is_desk_admin());

-- Admins gerenciam todos os agentes
CREATE POLICY "admins_insert_agents"
  ON public.desk_agents FOR INSERT
  WITH CHECK (public.is_desk_admin());

CREATE POLICY "admins_update_agents"
  ON public.desk_agents FOR UPDATE
  USING (public.is_desk_admin() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_desk_admin() OR auth_user_id = auth.uid());

CREATE POLICY "admins_delete_agents"
  ON public.desk_agents FOR DELETE
  USING (public.is_desk_admin());

-- ── desk_conversations ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "agents_full_access_conversations"  ON public.desk_conversations;
DROP POLICY IF EXISTS "contacts_select_own_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "contacts_insert_own_conversations" ON public.desk_conversations;

CREATE POLICY "agents_full_access_conversations"
  ON public.desk_conversations FOR ALL
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());

CREATE POLICY "contacts_select_own_conversations"
  ON public.desk_conversations FOR SELECT
  USING (account_user_id = auth.uid());

CREATE POLICY "contacts_insert_own_conversations"
  ON public.desk_conversations FOR INSERT
  WITH CHECK (account_user_id = auth.uid());

-- ── desk_messages ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "agents_full_access_messages"  ON public.desk_messages;
DROP POLICY IF EXISTS "contacts_select_own_messages" ON public.desk_messages;
DROP POLICY IF EXISTS "contacts_insert_own_messages" ON public.desk_messages;

CREATE POLICY "agents_full_access_messages"
  ON public.desk_messages FOR ALL
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());

CREATE POLICY "contacts_select_own_messages"
  ON public.desk_messages FOR SELECT
  USING (
    is_private_note = false
    AND EXISTS (
      SELECT 1 FROM public.desk_conversations
      WHERE id = conversation_id
        AND account_user_id = auth.uid()
    )
  );

CREATE POLICY "contacts_insert_own_messages"
  ON public.desk_messages FOR INSERT
  WITH CHECK (
    sender_type = 'contact'
    AND is_private_note = false
    AND EXISTS (
      SELECT 1 FROM public.desk_conversations
      WHERE id = conversation_id
        AND account_user_id = auth.uid()
    )
  );

-- ── Outras tabelas desk_* ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "agents_full_access_tags"               ON public.desk_tags;
DROP POLICY IF EXISTS "agents_full_access_conversation_tags"  ON public.desk_conversation_tags;
DROP POLICY IF EXISTS "agents_full_access_views"              ON public.desk_views;
DROP POLICY IF EXISTS "agents_full_access_sla_policies"       ON public.desk_sla_policies;
DROP POLICY IF EXISTS "agents_full_access_faq"                ON public.desk_faq;
DROP POLICY IF EXISTS "desk_kb_agents_all"                    ON public.desk_knowledge_base;

CREATE POLICY "agents_full_access_tags"
  ON public.desk_tags FOR ALL
  USING (public.is_desk_agent()) WITH CHECK (public.is_desk_agent());

CREATE POLICY "agents_full_access_conversation_tags"
  ON public.desk_conversation_tags FOR ALL
  USING (public.is_desk_agent()) WITH CHECK (public.is_desk_agent());

CREATE POLICY "agents_full_access_views"
  ON public.desk_views FOR ALL
  USING (public.is_desk_agent()) WITH CHECK (public.is_desk_agent());

CREATE POLICY "agents_full_access_sla_policies"
  ON public.desk_sla_policies FOR ALL
  USING (public.is_desk_agent()) WITH CHECK (public.is_desk_agent());

-- desk_faq: só existe se a tabela existir
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'desk_faq'
  ) THEN
    DROP POLICY IF EXISTS "agents_full_access_faq" ON public.desk_faq;
    EXECUTE $p$
      CREATE POLICY "agents_full_access_faq"
        ON public.desk_faq FOR ALL
        USING (public.is_desk_agent())
        WITH CHECK (public.is_desk_agent());
    $p$;
  END IF;
END $$;

-- desk_knowledge_base: agentes gerenciam, qualquer um lê publicados
CREATE POLICY "desk_kb_agents_all"
  ON public.desk_knowledge_base FOR ALL
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());
