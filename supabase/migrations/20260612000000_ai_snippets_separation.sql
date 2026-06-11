-- ─── Separação: Respostas rápidas (operador) × Snippets de IA (RAG) ─────────────
--
-- Diagnóstico (Sessão 4): a tabela `desk_snippets` estava sendo usada para DUAS
-- coisas distintas e conflitantes:
--   1. Respostas rápidas que o OPERADOR insere manualmente no composer
--      (página Macros.tsx + picker "/" do ConversationThread).
--   2. "Snippets para IA" — base de conhecimento curta que SÓ a IA consulta via
--      busca semântica (aba Snippets da Base de Conhecimento).
--
-- Além disso o embedding dos snippets de IA NUNCA era gerado: a página chamava a
-- Edge Function `desk-embed-article` com table='desk_snippets', mas aquela função
-- só aceitava desk_knowledge_base/desk_faq → retornava 400 silenciosamente.
--
-- Solução: tabela DEDICADA `desk_ai_snippets` para o caso (2), com coluna de
-- embedding e função de busca semântica própria. `desk_snippets` permanece como
-- respostas rápidas do operador (sem embedding, sem RAG).

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. Tabela dedicada para snippets de IA (RAG) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_ai_snippets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  category   TEXT,
  embedding  VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Migração de dados: snippets que JÁ tinham embedding eram, na prática, ─────
-- conteúdo de IA (a página de respostas rápidas nunca gera embedding). Movemos
-- esses registros para a tabela nova. Idempotente: só insere o que ainda não foi
-- migrado (mesmo título + conteúdo).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'desk_snippets' AND column_name = 'embedding'
  ) THEN
    INSERT INTO public.desk_ai_snippets (title, content, category, embedding, created_at)
    SELECT s.title, s.content, s.category, s.embedding, s.created_at
    FROM public.desk_snippets s
    WHERE s.embedding IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.desk_ai_snippets a
        WHERE a.title = s.title AND a.content = s.content
      );

    -- Remove da tabela de respostas rápidas os que foram migrados (tinham embedding).
    DELETE FROM public.desk_snippets WHERE embedding IS NOT NULL;
  END IF;
END $$;

-- ── 3. Índice IVFFlat para busca por similaridade ───────────────────────────────
DROP INDEX IF EXISTS idx_desk_ai_snippets_embedding;
CREATE INDEX idx_desk_ai_snippets_embedding
  ON public.desk_ai_snippets
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── 4. RLS: apenas operadores autenticados ──────────────────────────────────────
ALTER TABLE public.desk_ai_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_ai_snippets_authenticated_all" ON public.desk_ai_snippets;
CREATE POLICY "desk_ai_snippets_authenticated_all" ON public.desk_ai_snippets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- service_role (Edge Functions) ignora RLS, então a busca da IA funciona sem policy extra.

-- ── 5. Função de busca semântica de snippets de IA ──────────────────────────────
DROP FUNCTION IF EXISTS public.match_ai_snippets(VECTOR, FLOAT, INT);

CREATE FUNCTION public.match_ai_snippets(
  query_embedding VECTOR(1536),
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
    s.id,
    s.title,
    s.content,
    s.category,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM public.desk_ai_snippets s
  WHERE s.embedding IS NOT NULL
    AND 1 - (s.embedding <=> query_embedding) > match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
