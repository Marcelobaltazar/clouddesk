-- ─── Mesclar conversas (feature "Mesclar com..." do painel) ────────────────────
--
-- O mesmo cliente abre vários chamados sobre o mesmo assunto. O operador mescla:
-- estando na conversa ATUAL (origem), escolhe outra do MESMO cliente (destino);
-- as mensagens e o histórico da origem migram para o destino e a origem vira
-- status='merged' (some da inbox, mas não é deletada — rastreável via merged_into).
--
-- Feito por uma função SECURITY DEFINER (transacional) chamada pela Edge Function
-- desk-merge-conversations, que valida operador + mesmo cliente antes.

-- 1) Permitir o novo status 'merged' e rastrear o destino
ALTER TABLE public.desk_conversations
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.desk_conversations(id);

-- Recria o CHECK do status incluindo 'merged'
DO $$
BEGIN
  ALTER TABLE public.desk_conversations DROP CONSTRAINT IF EXISTS desk_conversations_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.desk_conversations
  ADD CONSTRAINT desk_conversations_status_check
  CHECK (status IN ('open', 'pending', 'snoozed', 'resolved', 'merged'));

-- 2) Função de merge — move tudo de source → target, atômico.
--    p_summary_question / p_summary_bullets: card de resumo (gerado pela IA na
--    Edge Function). Se preenchidos, viram uma mensagem 'system' rica no destino,
--    com metadata.merge = { source, question, summary[], agent_name }.
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

  -- Card de resumo da conversa absorvida (mensagem 'system' rica) — gravado
  -- ANTES de mover as mensagens, para ficar no topo do bloco mesclado.
  INSERT INTO desk_messages (conversation_id, sender_type, content, content_type, metadata)
  VALUES (
    p_target, 'system',
    v_who || ' mesclou a conversa #' || v_source_short || ' aqui.',
    'text',
    jsonb_build_object('merge', jsonb_build_object(
      'source', p_source,
      'agent_name', p_agent_name,
      'question', p_summary_question,
      'summary', COALESCE(to_jsonb(p_summary_bullets), '[]'::jsonb)
    ))
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

-- Só o service role executa (a Edge Function valida operador + mesmo cliente antes)
REVOKE EXECUTE ON FUNCTION public.desk_merge_conversations(uuid, uuid, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_merge_conversations(uuid, uuid, text, text, text[]) TO service_role;

-- Índice para o buscador de "conversas do mesmo cliente" (por e-mail)
CREATE INDEX IF NOT EXISTS idx_desk_conv_user_email ON public.desk_conversations (user_email);
