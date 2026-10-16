-- ─── Fecha o que a anon key (pública) e contas avulsas ainda alcançavam ─────────
--
-- Auditoria de 16/10/2026 (pg_policies + teste ao vivo só com a anon key, que é
-- pública por natureza — vai no widget.js de todo cliente e no bundle do painel).
-- ANTES desta migration:
--   • qualquer um LISTAVA os 614 anexos que clientes enviaram pelo chat
--     (desk_attachments_public_read) e, com a lista, baixava cada um;
--   • qualquer um lia `account` (cópia local) — account_read_all USING (true);
--   • qualquer um lia/gravava/apagava desk_faq — desk_faq_all USING (true);
--   • qualquer conta criada no Auth (cadastro público estava ligado) editava e
--     apagava as macros do painel — desk_snippets_authenticated_all;
--   • contas avulsas criavam conversas/mensagens na inbox (contacts_*_own, do
--     widget antigo — desde 14/07 o widget só fala via desk-widget-api);
--   • as tabelas do scaffold Lovable (agents, organizations, contacts, ...)
--     tinham policies por org; o trigger handle_new_user põe toda conta nova em
--     `agents`, o que dava a ela leitura de `account` e dos nomes/e-mails da equipe.
--
-- DEPOIS: anon só lê artigos publicados da Central (desk_kb_read_published).
-- Todo o resto exige operador (is_desk_agent()) ou service role.
--
-- URLs públicas de arquivo (/storage/v1/object/public/...) NÃO dependem de
-- policy: os dois buckets continuam public, então imagens no chat, na Central e
-- as que a IA analisa seguem abrindo. Sem policy de SELECT o que some é a
-- LISTAGEM/busca de objetos pela API.
--
-- Rollback: docs/seguranca/2026-10-16-rls-lockdown-rollback.sql

-- ── 1. Storage: sem listagem pública de anexos e imagens da Central ────────────
DROP POLICY IF EXISTS "desk_attachments_public_read" ON storage.objects;
DROP POLICY IF EXISTS "desk_attachments_agent_read" ON storage.objects;
CREATE POLICY "desk_attachments_agent_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'desk-attachments' AND public.is_desk_agent());

-- O upload de imagem do editor da Central usa upsert, que precisa de SELECT.
DROP POLICY IF EXISTS "desk_kb_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "desk_kb_images_agent_read" ON storage.objects;
CREATE POLICY "desk_kb_images_agent_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'desk-kb-images' AND public.is_desk_agent());

-- ── 2. account (cópia local): só operadores ────────────────────────────────────
DROP POLICY IF EXISTS "account_read_all" ON public.account;
DROP POLICY IF EXISTS "Agents can view accounts" ON public.account;
DROP POLICY IF EXISTS "agents_read_account" ON public.account;
CREATE POLICY "agents_read_account"
  ON public.account FOR SELECT TO authenticated
  USING (public.is_desk_agent());

-- ── 3. desk_faq: fica só agents_full_access_faq (is_desk_agent) ────────────────
DROP POLICY IF EXISTS "desk_faq_all" ON public.desk_faq;

-- ── 4. desk_snippets (macros do painel): só operadores ─────────────────────────
DROP POLICY IF EXISTS "desk_snippets_authenticated_all" ON public.desk_snippets;
DROP POLICY IF EXISTS "desk_snippets_agents_all" ON public.desk_snippets;
CREATE POLICY "desk_snippets_agents_all"
  ON public.desk_snippets FOR ALL TO authenticated
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());

-- ── 5. Widget antigo (auth.uid do cliente): sem uso desde o gateway ────────────
-- Ficam agents_full_access_conversations / agents_full_access_messages.
DROP POLICY IF EXISTS "contacts_insert_own_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "contacts_select_own_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "contacts_insert_own_messages" ON public.desk_messages;
DROP POLICY IF EXISTS "contacts_select_own_messages" ON public.desk_messages;

-- ── 6. Scaffold Lovable: nenhum código usa; RLS continua ligado, sem policy ────
-- (só o service role alcança; o trigger handle_new_user é SECURITY DEFINER e
-- segue funcionando)
DROP POLICY IF EXISTS "Agents can update own profile" ON public.agents;
DROP POLICY IF EXISTS "Agents can view org agents" ON public.agents;
DROP POLICY IF EXISTS "Agents can view own org" ON public.organizations;
DROP POLICY IF EXISTS "Agents can insert org contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can update org contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can view org contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can insert org conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents can update org conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents can view org conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Agents can view conversation messages" ON public.messages;
DROP POLICY IF EXISTS "Agents can manage conversation tags" ON public.conversation_tags;
DROP POLICY IF EXISTS "Agents can manage org macros" ON public.macros;
DROP POLICY IF EXISTS "Agents can view org macros" ON public.macros;
DROP POLICY IF EXISTS "Agents can manage org tags" ON public.tags;
DROP POLICY IF EXISTS "Agents can view org tags" ON public.tags;
DROP POLICY IF EXISTS "Agents can insert activity" ON public.activity_log;
DROP POLICY IF EXISTS "Agents can view org activity" ON public.activity_log;
