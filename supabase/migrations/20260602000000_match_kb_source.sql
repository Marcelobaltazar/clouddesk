-- ─── match_knowledge_base: expor source + source_id ────────────────────────────
-- A IA passa a citar a fonte dos artigos usados na resposta (link da central de
-- ajuda). Para isso a busca semântica precisa devolver `source` e `source_id`
-- além dos campos já existentes.
--
-- CREATE OR REPLACE não permite mudar o tipo de retorno (RETURNS TABLE), então
-- removemos e recriamos a função.

DROP FUNCTION IF EXISTS public.match_knowledge_base(VECTOR, FLOAT, INT);

CREATE FUNCTION public.match_knowledge_base(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count     INT   DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  content    TEXT,
  category   TEXT,
  source     TEXT,
  source_id  TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.title,
    kb.content,
    kb.category,
    kb.source,
    kb.source_id,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.desk_knowledge_base kb
  WHERE kb.is_published = true
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
