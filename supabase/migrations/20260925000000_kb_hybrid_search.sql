-- ─── Busca da IA: trechos + busca híbrida (vetor exato + BM25) ─────────────────
--
-- DIAGNÓSTICO (25/09/2026): a IA respondeu que o "MCP Cloudfy foi
-- descontinuado" com 7 artigos e 1 snippet sobre MCP publicados. A busca
-- semântica não devolveu nenhum deles. Três causas, em ordem de gravidade:
--
--   1. Índices ivfflat QUEBRADOS. A migration 20260613000000 zerou os vetores e
--      recriou `ivfflat (lists = 100)` com as tabelas VAZIAS. O ivfflat aprende
--      os centróides dos dados existentes na criação; criado vazio, ele manda
--      cada busca para 1 de 100 listas quase aleatórias. Para a pergunta do MCP,
--      a busca exata devolve os 5 artigos de MCP (similaridade 0.91); a busca
--      pelo índice devolvia Redis e PostgreSQL. Desde junho a IA vinha
--      recebendo contexto quase aleatório.
--   2. Um vetor por artigo, cortado em 2000 caracteres. 66 dos 116 artigos são
--      maiores que isso — o fim deles nunca foi pesquisável.
--   3. Só busca por significado. Termos exatos e raros ("MCP",
--      "N8N_RUNNERS_TASK_REQUEST_TIMEOUT", "502") pesam pouco num modelo de
--      embedding pequeno e treinado em inglês; é onde busca por palavra ganha.
--
-- O que esta migration faz:
--   • remove os índices ivfflat (com ~120 artigos a busca exata custa < 5 ms e
--     tem recall perfeito — índice aproximado só se paga com dezenas de milhares
--     de linhas, e aí o certo é HNSW, que não precisa de treino);
--   • cria desk_kb_chunks: artigos publicados e snippets fatiados em trechos de
--     ~900 caracteres, cada um com título + seção na frente (o fatiamento vive em
--     supabase/functions/_shared/kb-chunker.ts);
--   • cria a configuração de busca textual desk_pt (português, sem acento);
--   • cria desk_kb_hybrid_search: devolve, para UMA consulta, o ranking vetorial
--     e o ranking BM25 de cada trecho. A fusão (RRF) entre rankings e entre
--     consultas acontece no pipeline (_shared/ai-retrieval.ts).

-- ── 1. Índices ivfflat criados vazios: fora ─────────────────────────────────────
-- As funções match_* continuam existindo (fallback do pipeline) e passam a fazer
-- busca exata, que é o comportamento correto para este volume.
DROP INDEX IF EXISTS public.idx_desk_kb_embedding;
DROP INDEX IF EXISTS public.idx_desk_faq_embedding;
DROP INDEX IF EXISTS public.idx_desk_ai_snippets_embedding;

-- ── 2. Busca textual em português, sem acento ───────────────────────────────────
-- "cobrança" e "cobranca", "não" e "nao" viram o mesmo termo. O unaccent roda
-- antes do stemmer (é um dicionário filtro), igual na indexação e na consulta.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'desk_pt') THEN
    CREATE TEXT SEARCH CONFIGURATION public.desk_pt (COPY = pg_catalog.portuguese);
    ALTER TEXT SEARCH CONFIGURATION public.desk_pt
      ALTER MAPPING FOR hword, hword_part, word
      WITH extensions.unaccent, portuguese_stem;
  END IF;
END $$;

-- ── 3. Trechos indexados ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_kb_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('article', 'snippet')),
  -- Duas FKs em vez de uma "polimórfica": apagar o artigo/snippet apaga os
  -- trechos dele, sem gatilho.
  article_id  UUID REFERENCES public.desk_knowledge_base(id) ON DELETE CASCADE,
  snippet_id  UUID REFERENCES public.desk_ai_snippets(id) ON DELETE CASCADE,
  chunk_index INT  NOT NULL,
  title       TEXT NOT NULL,
  heading     TEXT,
  content     TEXT NOT NULL,
  embedding   VECTOR(384),
  fts         TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('public.desk_pt'::regconfig,
      coalesce(title, '') || ' ' || coalesce(heading, '') || ' ' || content)
  ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT desk_kb_chunks_one_doc CHECK (
    (doc_type = 'article' AND article_id IS NOT NULL AND snippet_id IS NULL) OR
    (doc_type = 'snippet' AND snippet_id IS NOT NULL AND article_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS desk_kb_chunks_article_idx
  ON public.desk_kb_chunks (article_id, chunk_index) WHERE article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS desk_kb_chunks_snippet_idx
  ON public.desk_kb_chunks (snippet_id, chunk_index) WHERE snippet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS desk_kb_chunks_fts_idx
  ON public.desk_kb_chunks USING gin (fts);
-- Sem índice vetorial de propósito: ver item 1.

-- Só a IA (service role) lê e escreve trechos. RLS ligado sem policy = nenhum
-- papel além do service role enxerga a tabela.
ALTER TABLE public.desk_kb_chunks ENABLE ROW LEVEL SECURITY;

-- ── 4. Busca híbrida ────────────────────────────────────────────────────────────
-- Para UMA consulta, devolve os trechos que aparecem no top-N vetorial OU no
-- top-N por palavra, com a posição em cada ranking. Só entram trechos de artigos
-- PUBLICADOS (despublicar esconde da IA na hora, sem reindexar) e snippets.
--
-- O ranking por palavra é BM25 de verdade (com IDF), não ts_rank: o ts_rank não
-- sabe que "mcp" é raro e "plano" aparece em metade da base, e aí o artigo que
-- repete "plano" ganha do que fala de MCP.
DROP FUNCTION IF EXISTS public.desk_kb_hybrid_search(TEXT, VECTOR, INT);

CREATE FUNCTION public.desk_kb_hybrid_search(
  query_text      TEXT,
  query_embedding VECTOR(384),
  match_count     INT DEFAULT 20
)
RETURNS TABLE (
  chunk_id       UUID,
  doc_type       TEXT,
  doc_id         UUID,
  chunk_index    INT,
  title          TEXT,
  heading        TEXT,
  content        TEXT,
  vec_rank       INT,
  vec_similarity DOUBLE PRECISION,
  text_rank      INT,
  text_score     DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH live AS (
    SELECT c.id, c.doc_type, coalesce(c.article_id, c.snippet_id) AS doc_id,
           c.chunk_index, c.title, c.heading, c.content, c.embedding, c.fts
    FROM public.desk_kb_chunks c
    LEFT JOIN public.desk_knowledge_base kb ON kb.id = c.article_id
    WHERE c.doc_type = 'snippet' OR kb.is_published = true
  ),
  vec AS (
    SELECT l.id,
           1 - (l.embedding <=> query_embedding) AS sim,
           row_number() OVER (ORDER BY l.embedding <=> query_embedding) AS rnk
    FROM live l
    WHERE query_embedding IS NOT NULL AND l.embedding IS NOT NULL
    ORDER BY l.embedding <=> query_embedding
    LIMIT match_count
  ),
  -- Termos da consulta já normalizados (sem stopword, sem acento, com stem).
  q AS (
    SELECT DISTINCT lex
    FROM unnest(tsvector_to_array(to_tsvector('public.desk_pt'::regconfig, coalesce(query_text, '')))) AS lex
  ),
  stats AS (
    SELECT count(*)::float AS n, greatest(avg(length(fts)), 1)::float AS avgdl FROM live
  ),
  df AS (
    SELECT q.lex, count(l.id)::float AS df
    FROM q LEFT JOIN live l ON l.fts @@ quote_literal(q.lex)::tsquery
    GROUP BY q.lex
  ),
  tf AS (
    SELECT l.id, u.lexeme,
           coalesce(array_length(u.positions, 1), 1)::float AS tf,
           length(l.fts)::float AS dl
    FROM live l
    CROSS JOIN LATERAL unnest(l.fts) AS u
    WHERE u.lexeme IN (SELECT lex FROM q)
  ),
  bm25 AS (
    -- k1 = 1.2, b = 0.75
    SELECT tf.id,
           sum(
             ln(1 + (s.n - df.df + 0.5) / (df.df + 0.5)) *
             tf.tf * 2.2 / (tf.tf + 1.2 * (0.25 + 0.75 * tf.dl / s.avgdl))
           ) AS score
    FROM tf
    JOIN df ON df.lex = tf.lexeme
    CROSS JOIN stats s
    GROUP BY tf.id
  ),
  txt AS (
    SELECT b.id, b.score, row_number() OVER (ORDER BY b.score DESC) AS rnk
    FROM bm25 b
    ORDER BY b.score DESC
    LIMIT match_count
  )
  SELECT l.id, l.doc_type, l.doc_id, l.chunk_index, l.title, l.heading, l.content,
         vec.rnk::int, vec.sim, txt.rnk::int, txt.score
  FROM live l
  LEFT JOIN vec ON vec.id = l.id
  LEFT JOIN txt ON txt.id = l.id
  WHERE vec.id IS NOT NULL OR txt.id IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.desk_kb_hybrid_search(TEXT, VECTOR, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_kb_hybrid_search(TEXT, VECTOR, INT) TO service_role;
