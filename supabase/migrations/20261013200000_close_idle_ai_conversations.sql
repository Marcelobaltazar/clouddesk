-- Conversa atendida só pela Luna em que o cliente parou de responder não fica
-- aberta para sempre (13/10/2026). Eram ~200 abertas, a maioria do Starter, que
-- não tem equipe humana para fechar. Fecha quando:
--   • status open, IA ativa, sem operador atribuído, não mesclada;
--   • a última mensagem de gente (cliente, operador ou Luna — sistema não
--     conta) é da Luna: ninguém está esperando resposta nossa;
--   • nada novo há p_idle (padrão 24 horas).
-- O aviso vai como NOTA INTERNA: o operador vê no histórico, e o cliente não
-- ganha badge de "não lida" por isso. Se ele voltar a escrever, o gateway
-- reabre a mesma thread (Starter volta para a Luna; os demais, para a equipe).
-- Sem agendador (decisão de 13/10/2026): o desk-widget-api chama a função de
-- carona no tráfego do widget, no máximo a cada 15 min por instância.

CREATE OR REPLACE FUNCTION public.desk_close_idle_ai_conversations(
  p_idle interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 200
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed integer;
BEGIN
  WITH idle AS (
    SELECT c.id
      FROM desk_conversations c
     WHERE c.status = 'open'
       AND c.ai_active
       AND c.assigned_agent_id IS NULL
       AND c.merged_into IS NULL
       AND COALESCE(c.last_message_at, c.updated_at) < now() - p_idle
       AND (SELECT m.sender_type
              FROM desk_messages m
             WHERE m.conversation_id = c.id
               AND NOT COALESCE(m.is_private_note, false)
               AND m.sender_type <> 'system'
             ORDER BY m.created_at DESC
             LIMIT 1) = 'bot'
     ORDER BY COALESCE(c.last_message_at, c.updated_at)
     LIMIT p_limit
     FOR UPDATE OF c SKIP LOCKED
  ), closed AS (
    UPDATE desk_conversations c
       SET status = 'resolved', resolved_at = now()
      FROM idle
     WHERE c.id = idle.id
       AND c.status = 'open'
    RETURNING c.id
  ), noted AS (
    -- Executa mesmo sem ser lido abaixo (CTE que escreve sempre roda inteira).
    INSERT INTO desk_messages (conversation_id, sender_type, content, content_type, is_private_note)
    SELECT id, 'system', 'Encerrada automaticamente: a Luna respondeu e o cliente não voltou a escrever.', 'text', true
      FROM closed
    RETURNING 1
  )
  SELECT count(*) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.desk_close_idle_ai_conversations(interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_close_idle_ai_conversations(interval, integer) TO service_role;
