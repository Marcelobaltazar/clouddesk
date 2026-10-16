-- Rollback de supabase/migrations/20261016000000_rls_lockdown.sql
-- Gerado em 16/10/2026 a partir de pg_policies (definições exatas de antes).
-- REABRE os buracos descritos na migration — só usar se algo quebrar.

BEGIN;

-- Remove as policies novas
DROP POLICY IF EXISTS "desk_attachments_agent_read" ON storage.objects;
DROP POLICY IF EXISTS "desk_kb_images_agent_read" ON storage.objects;
DROP POLICY IF EXISTS "agents_read_account" ON public.account;
DROP POLICY IF EXISTS "desk_snippets_agents_all" ON public.desk_snippets;

-- Recria as policies antigas
CREATE POLICY "desk_attachments_public_read" ON storage.objects FOR SELECT TO public
  USING ((bucket_id = 'desk-attachments'::text));
CREATE POLICY "desk_kb_images_public_read" ON storage.objects FOR SELECT TO public
  USING ((bucket_id = 'desk-kb-images'::text));
CREATE POLICY "account_read_all" ON public.account FOR SELECT TO public
  USING (true);
CREATE POLICY "Agents can view accounts" ON public.account FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM agents a
  WHERE (a.id = auth.uid()))));
CREATE POLICY "desk_faq_all" ON public.desk_faq FOR ALL TO public
  USING (true)
  WITH CHECK (true);
CREATE POLICY "desk_snippets_authenticated_all" ON public.desk_snippets FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "contacts_insert_own_conversations" ON public.desk_conversations FOR INSERT TO public
  WITH CHECK ((account_user_id = auth.uid()));
CREATE POLICY "contacts_select_own_conversations" ON public.desk_conversations FOR SELECT TO public
  USING ((account_user_id = auth.uid()));
CREATE POLICY "contacts_insert_own_messages" ON public.desk_messages FOR INSERT TO public
  WITH CHECK (((sender_type = 'contact'::text) AND (is_private_note = false) AND (EXISTS ( SELECT 1
   FROM desk_conversations
  WHERE ((desk_conversations.id = desk_messages.conversation_id) AND (desk_conversations.account_user_id = auth.uid()))))));
CREATE POLICY "contacts_select_own_messages" ON public.desk_messages FOR SELECT TO public
  USING (((is_private_note = false) AND (EXISTS ( SELECT 1
   FROM desk_conversations
  WHERE ((desk_conversations.id = desk_messages.conversation_id) AND (desk_conversations.account_user_id = auth.uid()))))));
CREATE POLICY "Agents can update own profile" ON public.agents FOR UPDATE TO authenticated
  USING ((id = auth.uid()));
CREATE POLICY "Agents can view org agents" ON public.agents FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view own org" ON public.organizations FOR SELECT TO authenticated
  USING ((id = get_agent_org_id()));
CREATE POLICY "Agents can insert org contacts" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can update org contacts" ON public.contacts FOR UPDATE TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view org contacts" ON public.contacts FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can insert org conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can update org conversations" ON public.conversations FOR UPDATE TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view org conversations" ON public.conversations FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.org_id = get_agent_org_id())))));
CREATE POLICY "Agents can view conversation messages" ON public.messages FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.org_id = get_agent_org_id())))));
CREATE POLICY "Agents can manage conversation tags" ON public.conversation_tags FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_tags.conversation_id) AND (c.org_id = get_agent_org_id())))));
CREATE POLICY "Agents can manage org macros" ON public.macros FOR ALL TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view org macros" ON public.macros FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can manage org tags" ON public.tags FOR ALL TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view org tags" ON public.tags FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can insert activity" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_agent_org_id()));
CREATE POLICY "Agents can view org activity" ON public.activity_log FOR SELECT TO authenticated
  USING ((org_id = get_agent_org_id()));

COMMIT;
