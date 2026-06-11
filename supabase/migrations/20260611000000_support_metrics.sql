-- ─── Métricas de suporte: CSAT + first_response_at + SLA automático ────────────
--
-- Diagnóstico (11/06/2026): em 109 conversas reais, first_response_at = null em
-- 100% e sla_deadline = null em 100%. desk_csat tem 0 linhas porque o widget
-- nunca exibia o formulário e o componente tinha um TODO no lugar do INSERT.
-- Esta migration cria a camada robusta no banco (triggers) para que as métricas
-- funcionem para QUALQUER caminho de escrita (widget, operador, IA, email futuro).

-- ── 1. desk_csat: RLS para o widget anônimo ─────────────────────────────────────
-- O widget roda como anon (cliente vive no Supabase de produção da Cloudfy).
-- Mesmo trade-off documentado em 20260603000000_widget_anon_conversations.sql.

ALTER TABLE public.desk_csat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "widget_insert_csat" ON public.desk_csat;
CREATE POLICY "widget_insert_csat"
  ON public.desk_csat FOR INSERT
  TO anon
  WITH CHECK (
    rating BETWEEN 1 AND 3
    AND EXISTS (
      SELECT 1 FROM public.desk_conversations c
      WHERE c.id = conversation_id
        AND c.user_email IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "agents_read_csat" ON public.desk_csat;
CREATE POLICY "agents_read_csat"
  ON public.desk_csat FOR SELECT
  USING (true);

-- ── 2. first_response_at: trigger em desk_messages ──────────────────────────────
-- Marca a primeira resposta (bot ou agente) APÓS a primeira mensagem do cliente.
-- A saudação proativa do widget (bot antes de qualquer mensagem do contato) não
-- conta como primeira resposta.

CREATE OR REPLACE FUNCTION public.desk_set_first_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type IN ('agent', 'bot')
     AND COALESCE(NEW.is_private_note, false) = false THEN
    UPDATE public.desk_conversations c
       SET first_response_at = NEW.created_at
     WHERE c.id = NEW.conversation_id
       AND c.first_response_at IS NULL
       AND EXISTS (
         SELECT 1 FROM public.desk_messages m
         WHERE m.conversation_id = NEW.conversation_id
           AND m.sender_type = 'contact'
           AND m.created_at <= NEW.created_at
       );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_desk_first_response ON public.desk_messages;
CREATE TRIGGER trg_desk_first_response
  AFTER INSERT ON public.desk_messages
  FOR EACH ROW EXECUTE FUNCTION public.desk_set_first_response();

-- ── 3. SLA automático: trigger em desk_conversations ────────────────────────────
-- Se a conversa nasce sem sla_deadline, aplica a melhor policy ativa
-- (mesmo score do frontend: plan+priority > plan > priority > global).
-- O plano do cliente ainda não é conhecido na criação → só policies de plan null.

CREATE OR REPLACE FUNCTION public.desk_apply_sla_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minutes integer;
BEGIN
  IF NEW.sla_deadline IS NULL THEN
    SELECT p.first_response_minutes INTO v_minutes
      FROM public.desk_sla_policies p
     WHERE p.is_active = true
       AND p.plan IS NULL
       AND (p.priority IS NULL OR p.priority = NEW.priority)
     ORDER BY (p.priority = NEW.priority) DESC NULLS LAST
     LIMIT 1;

    IF v_minutes IS NOT NULL THEN
      NEW.sla_deadline := NEW.created_at + make_interval(mins => v_minutes);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_desk_sla_on_insert ON public.desk_conversations;
CREATE TRIGGER trg_desk_sla_on_insert
  BEFORE INSERT ON public.desk_conversations
  FOR EACH ROW EXECUTE FUNCTION public.desk_apply_sla_on_insert();

-- ── 4. desk_ai_interactions: RLS (service role grava, operadores leem) ──────────
ALTER TABLE public.desk_ai_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_read_ai_interactions" ON public.desk_ai_interactions;
CREATE POLICY "agents_read_ai_interactions"
  ON public.desk_ai_interactions FOR SELECT
  USING (true);
