-- ─── desk_conversations.user_email ─────────────────────────────────────────────
-- Armazena o email do cliente diretamente na conversa.
--
-- Motivo: o widget cria conversas usando account_user_id como FK lógica para
-- account.user_id. Para visitantes que ainda não têm linha em `account`, o
-- ClientInfoPanel não conseguia descobrir o email — e sem o email não dá para
-- chamar get-contact-info (que busca assinaturas/infra no Supabase de produção).
-- Salvando o email na própria conversa, o painel sempre tem como identificar o
-- cliente, independentemente de existir registro em `account`.

ALTER TABLE public.desk_conversations
  ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Índice para buscas/junções por email (ex.: agrupar conversas do mesmo cliente).
CREATE INDEX IF NOT EXISTS idx_desk_conv_user_email
  ON public.desk_conversations(user_email);
