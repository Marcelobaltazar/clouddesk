-- ─── Fix RLS: desk_agents self-read ──────────────────────────────────────────
-- Problema: a policy "agents_read_all_agents" faz referência circular a
-- desk_agents dentro do USING — um usuário precisa estar em desk_agents para
-- poder ler desk_agents. Isso impede o login: o fetchAgent() chamado logo após
-- o signInWithPassword retorna null (RLS bloqueia) e o frontend exibe
-- "Acesso não autorizado".
--
-- Solução: cada usuário autenticado pode ler APENAS a própria linha
-- (auth_user_id = auth.uid()). Sem recursão.
-- A policy "admins_manage_agents" (FOR ALL) já garante que admins leem tudo.

DROP POLICY IF EXISTS "agents_read_all_agents" ON public.desk_agents;

CREATE POLICY "agents_read_own_row"
  ON public.desk_agents
  FOR SELECT
  USING (auth_user_id = auth.uid());
