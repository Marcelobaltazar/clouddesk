-- ─── Mesclagem: separar o que é do operador do que o cliente lê ───────────────
--
-- A versão anterior inseria UMA mensagem de sistema com is_private_note = false
-- (o default). Resultado: o cliente lia no chat dele
--
--     "Marc mesclou a conversa #eae0f3a1 aqui."
--
-- — jargão interno e um id interno, numa tela onde ele só quer saber o que
-- aconteceu com o chamado dele.
--
-- Agora são duas mensagens:
--   1. Card interno (nota privada): mantém o id da origem e o resumo da IA.
--      Continua renderizado como card rico no painel — o MessageBubble casa em
--      sender_type='system' + metadata.merge ANTES de olhar is_private_note.
--   2. Linha visível ao cliente: em português de gente, sem id e sem nome de
--      operador, explicando que o chamado dele foi juntado a outro.
--
-- Mesma assinatura da função anterior (CREATE OR REPLACE) — a Edge Function
-- desk-merge-conversations não muda.

CREATE OR REPLACE FUNCTION public.desk_merge_conversations(
  p_source uuid,               -- conversa ATUAL (será absorvida)
  p_target uuid,               -- conversa ESCOLHIDA (recebe tudo)
  p_agent_name text DEFAULT NULL,
  p_summary_question text DEFAULT NULL,
  p_summary_bullets text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_short text := left(p_source::text, 8);
  v_src_tags text[];
  v_tgt_tags text[];
  v_who text := COALESCE(p_agent_name, 'O atendimento');
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'Não é possível mesclar uma conversa com ela mesma';
  END IF;

  -- Trava as duas linhas para evitar corrida
  PERFORM 1 FROM desk_conversations WHERE id IN (p_source, p_target) FOR UPDATE;

  -- 1) Card interno da conversa absorvida — NOTA PRIVADA (o cliente não vê).
  INSERT INTO desk_messages (conversation_id, sender_type, content, content_type, is_private_note, metadata)
  VALUES (
    p_target, 'system',
    v_who || ' mesclou a conversa #' || v_source_short || ' aqui.',
    'text',
    true,
    jsonb_build_object('merge', jsonb_build_object(
      'source', p_source,
      'agent_name', p_agent_name,
      'question', p_summary_question,
      'summary', COALESCE(to_jsonb(p_summary_bullets), '[]'::jsonb)
    ))
  );

  -- 2) Linha que o CLIENTE lê. Sem id, sem nome de operador, sem "mesclar".
  INSERT INTO desk_messages (conversation_id, sender_type, content, content_type, is_private_note)
  VALUES (
    p_target, 'system',
    'Juntamos seu outro chamado aqui para manter tudo no mesmo lugar. 🙂',
    'text',
    false
  );

  -- Move as mensagens (a origem some, então o histórico todo vai pro destino)
  UPDATE desk_messages SET conversation_id = p_target WHERE conversation_id = p_source;

  -- Move CSAT e log de atividades (se as tabelas existirem)
  UPDATE desk_csat            SET conversation_id = p_target WHERE conversation_id = p_source;
  UPDATE desk_ai_interactions SET conversation_id = p_target WHERE conversation_id = p_source;

  -- Tags: união sem duplicar (a coluna tags é text[] em desk_conversations)
  SELECT tags INTO v_src_tags FROM desk_conversations WHERE id = p_source;
  SELECT tags INTO v_tgt_tags FROM desk_conversations WHERE id = p_target;
  IF v_src_tags IS NOT NULL THEN
    UPDATE desk_conversations
       SET tags = (
         SELECT array_agg(DISTINCT t)
         FROM unnest(COALESCE(v_tgt_tags, '{}') || v_src_tags) AS t
       )
     WHERE id = p_target;
  END IF;

  -- desk_conversation_tags (M:N): move evitando violar a PK composta
  BEGIN
    DELETE FROM desk_conversation_tags dct
     WHERE dct.conversation_id = p_source
       AND EXISTS (
         SELECT 1 FROM desk_conversation_tags x
         WHERE x.conversation_id = p_target AND x.tag_id = dct.tag_id
       );
    UPDATE desk_conversation_tags SET conversation_id = p_target WHERE conversation_id = p_source;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Origem vira 'merged' e aponta para o destino; sobe o updated_at do destino
  UPDATE desk_conversations
     SET status = 'merged', merged_into = p_target, ai_active = false, updated_at = now()
   WHERE id = p_source;

  UPDATE desk_conversations SET updated_at = now() WHERE id = p_target;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.desk_merge_conversations(uuid, uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_merge_conversations(uuid, uuid, text, text, text[]) TO service_role;

-- ─── Limpeza dos merges já feitos ─────────────────────────────────────────────
-- Cards de mesclagem antigos continuam visíveis para o cliente até serem
-- marcados como nota. Eles NÃO ganham a linha amigável retroativa: acrescentar
-- uma mensagem nova em conversas antigas acenderia "não lida" sem motivo.

UPDATE public.desk_messages
   SET is_private_note = true
 WHERE sender_type = 'system'
   AND is_private_note = false
   AND metadata ? 'merge';

-- ─── Índice para achar as conversas absorvidas ────────────────────────────────
-- Usado pelo painel (banner de chamados duplicados) e pelo gateway do widget,
-- que segue merged_into até a thread viva.
CREATE INDEX IF NOT EXISTS idx_desk_conv_merged_into
  ON public.desk_conversations (merged_into)
  WHERE merged_into IS NOT NULL;
