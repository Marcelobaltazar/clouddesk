-- ─── Segurança do widget: fecha o acesso anônimo direto ao banco ────────────────
--
-- ANTES desta migration, a anon key (pública, embutida no widget.js) permitia:
--   • ler TODAS as conversas e mensagens de TODOS os clientes
--     (widget_select_* usavam apenas `user_email IS NOT NULL`);
--   • criar conversas em nome de qualquer e-mail (impersonação);
--   • inserir mensagens como 'bot'/'agent'/'system' em qualquer conversa;
--   • ler desk_csat e desk_ai_interactions (policies USING (true) sem TO).
--
-- DEPOIS: o widget opera exclusivamente via Edge Function `desk-widget-api`
-- (service role), que verifica a identidade do cliente com HMAC (user_hash,
-- estilo Intercom Identity Verification) antes de qualquer leitura/escrita.
-- O role anon não tem mais NENHUMA policy em desk_conversations/desk_messages/
-- desk_csat. Realtime do widget passa a ser broadcast-only (canal conv-live:{id},
-- protegido por capability: o UUID da conversa só é conhecido pelo dono).

-- ── 1. Remover policies anônimas do widget ──────────────────────────────────────
DROP POLICY IF EXISTS "widget_insert_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "widget_select_conversations" ON public.desk_conversations;
DROP POLICY IF EXISTS "widget_insert_messages"      ON public.desk_messages;
DROP POLICY IF EXISTS "widget_select_messages"      ON public.desk_messages;
DROP POLICY IF EXISTS "widget_insert_csat"          ON public.desk_csat;

-- ── 2. Fechar policies USING (true) que vazavam para anon ───────────────────────
-- (sem cláusula TO elas se aplicavam a todos os roles, inclusive anon)
DROP POLICY IF EXISTS "agents_read_csat" ON public.desk_csat;
CREATE POLICY "agents_read_csat"
  ON public.desk_csat FOR SELECT
  USING (public.is_desk_agent());

DROP POLICY IF EXISTS "agents_read_ai_interactions" ON public.desk_ai_interactions;
CREATE POLICY "agents_read_ai_interactions"
  ON public.desk_ai_interactions FOR SELECT
  USING (public.is_desk_agent());

-- ── 3. Funções RPC de busca semântica: fechar EXECUTE para anon ─────────────────
-- match_* leem FAQ/snippets internos; por padrão o Postgres concede EXECUTE a
-- PUBLIC (e revogar só de `anon` seria inócuo — ele herdaria via PUBLIC).
-- Revoga de PUBLIC e concede explicitamente a operadores + service role.
REVOKE EXECUTE ON FUNCTION public.match_knowledge_base(vector, double precision, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_faq(vector, double precision, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_ai_snippets(vector, double precision, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_base(vector, double precision, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_faq(vector, double precision, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_snippets(vector, double precision, integer) TO authenticated, service_role;

-- ── 4. Rate limiting persistente (janela fixa) ──────────────────────────────────
-- Usado pelas Edge Functions (service role) para limitar chamadas por e-mail:
-- mensagens de IA, criação de conversas, reenvio de credenciais, CSAT.
CREATE TABLE IF NOT EXISTS public.desk_rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0
);

-- RLS ligado sem nenhuma policy: apenas o service role (bypassa RLS) acessa.
ALTER TABLE public.desk_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.desk_rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now     timestamptz := now();
  v_allowed boolean;
BEGIN
  -- Limpeza oportunista (~1% das chamadas) de janelas mortas há mais de 2 dias
  IF random() < 0.01 THEN
    DELETE FROM desk_rate_limits WHERE window_start < v_now - interval '2 days';
  END IF;

  INSERT INTO desk_rate_limits AS rl (key, window_start, count)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rl.window_start < v_now - make_interval(secs => p_window_seconds) THEN 1
      ELSE rl.count + 1
    END,
    window_start = CASE
      WHEN rl.window_start < v_now - make_interval(secs => p_window_seconds) THEN v_now
      ELSE rl.window_start
    END
  RETURNING count <= p_max INTO v_allowed;

  RETURN v_allowed;
END;
$$;

-- Apenas o service role pode consultar o rate limit (revogar PUBLIC sem
-- conceder a service_role deixaria a própria Edge Function sem acesso)
REVOKE EXECUTE ON FUNCTION public.desk_rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_rate_limit_hit(text, integer, integer) TO service_role;
