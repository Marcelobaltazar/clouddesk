-- ─── Migração para embeddings NATIVOS do Supabase (gte-small) ───────────────────
--
-- Decisão (Sessão 4): o projeto não tem e não terá OPENAI_API_KEY. Trocamos todo o
-- pipeline de embedding para o modelo nativo do Supabase `gte-small`, executado
-- dentro do runtime das Edge Functions (Supabase.ai.Session) — SEM API externa.
--
-- gte-small produz vetores de 384 dimensões (OpenAI text-embedding-3-small usava
-- 1536). Portanto TODAS as colunas embedding e funções match_* migram de
-- VECTOR(1536) → VECTOR(384). Os vetores antigos (1536) são incompatíveis e
-- precisam ser zerados; serão regerados pelas Edge Functions sob demanda.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. Derruba índices ivfflat (dependem do tipo/dimensão da coluna) ────────────
DROP INDEX IF EXISTS idx_desk_kb_embedding;
DROP INDEX IF EXISTS idx_desk_faq_embedding;
DROP INDEX IF EXISTS idx_desk_ai_snippets_embedding;

-- ── 2. Limpa e converte as colunas para VECTOR(384) ─────────────────────────────
-- Não dá para converter 1536→384 in-place; zeramos antes de alterar o tipo.
UPDATE public.desk_knowledge_base SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE public.desk_faq            SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE public.desk_ai_snippets    SET embedding = NULL WHERE embedding IS NOT NULL;

ALTER TABLE public.desk_knowledge_base ALTER COLUMN embedding TYPE VECTOR(384);
ALTER TABLE public.desk_faq            ALTER COLUMN embedding TYPE VECTOR(384);
ALTER TABLE public.desk_ai_snippets    ALTER COLUMN embedding TYPE VECTOR(384);

-- ── 3. Recria índices ivfflat para 384 dims ─────────────────────────────────────
CREATE INDEX idx_desk_kb_embedding
  ON public.desk_knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_desk_faq_embedding
  ON public.desk_faq USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_desk_ai_snippets_embedding
  ON public.desk_ai_snippets USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── 4. Recria as funções match_* com assinatura VECTOR(384) ─────────────────────
-- (CREATE OR REPLACE não permite mudar o tipo do parâmetro → DROP + CREATE.)

DROP FUNCTION IF EXISTS public.match_knowledge_base(VECTOR, FLOAT, INT);
CREATE FUNCTION public.match_knowledge_base(
  query_embedding VECTOR(384),
  match_threshold FLOAT DEFAULT 0.5,
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
    kb.id, kb.title, kb.content, kb.category, kb.source, kb.source_id,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.desk_knowledge_base kb
  WHERE kb.is_published = true
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

DROP FUNCTION IF EXISTS public.match_faq(VECTOR, FLOAT, INT);
CREATE FUNCTION public.match_faq(
  query_embedding VECTOR(384),
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT   DEFAULT 3
)
RETURNS TABLE (
  id         UUID,
  question   TEXT,
  answer     TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id, f.question, f.answer,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.desk_faq f
  WHERE f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

DROP FUNCTION IF EXISTS public.match_ai_snippets(VECTOR, FLOAT, INT);
CREATE FUNCTION public.match_ai_snippets(
  query_embedding VECTOR(384),
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT   DEFAULT 3
)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  content    TEXT,
  category   TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.title, s.content, s.category,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM public.desk_ai_snippets s
  WHERE s.embedding IS NOT NULL
    AND 1 - (s.embedding <=> query_embedding) > match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
