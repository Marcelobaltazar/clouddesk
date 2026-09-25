-- ─── Base da IA: só operador escreve + status real do índice ───────────────────
--
-- 1. PERMISSÃO. A policy `desk_knowledge_base_all` (FOR ALL USING (true) para o
--    papel public) foi criada à mão no painel do Supabase — não está em nenhuma
--    migration. Com ela, a anon key, que é pública (vai no bundle do widget),
--    lia rascunhos e podia criar, editar e APAGAR artigos: exatamente o que a IA
--    lê para responder. Confirmado em 25/09/2026 lendo rascunhos com a anon key.
--    Continuam valendo: `desk_kb_agents_all` (operador faz tudo) e
--    `desk_kb_read_published` (qualquer um lê artigo publicado — Central de
--    Ajuda pública). A IA e os scripts usam service role, que ignora RLS.
--    Snippets: de "qualquer autenticado" para "só operador", no mesmo padrão.
--
-- 2. STATUS DO ÍNDICE. O selo "Indexado" do painel olhava só se a coluna
--    embedding estava preenchida. Depois de editar um artigo, se a reindexação
--    falhasse (ela roda em silêncio ao salvar), o selo continuava "Indexado" com
--    o índice do texto antigo. Agora:
--      content_hash  — md5 do título + conteúdo ATUAIS (coluna gerada);
--      indexed_hash  — md5 do título + conteúdo que foi indexado;
--      index_chunks  — quantos trechos foram gerados;
--      index_error   — último erro de indexação (null quando deu certo);
--      indexed_at    — quando terminou.
--    Indexado de verdade = indexed_hash = content_hash. Quem grava é a Edge
--    Function desk-embed-article, ao terminar o último lote.

-- ── 1. Permissões ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "desk_knowledge_base_all" ON public.desk_knowledge_base;

DROP POLICY IF EXISTS "desk_ai_snippets_authenticated_all" ON public.desk_ai_snippets;
DROP POLICY IF EXISTS "desk_ai_snippets_agents_all" ON public.desk_ai_snippets;
CREATE POLICY "desk_ai_snippets_agents_all" ON public.desk_ai_snippets
  FOR ALL TO authenticated
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());

-- ── 2. Status do índice ─────────────────────────────────────────────────────────
ALTER TABLE public.desk_knowledge_base
  ADD COLUMN IF NOT EXISTS content_hash TEXT
    GENERATED ALWAYS AS (md5(coalesce(title, '') || E'\n' || coalesce(content, ''))) STORED,
  ADD COLUMN IF NOT EXISTS indexed_hash TEXT,
  ADD COLUMN IF NOT EXISTS index_chunks INT,
  ADD COLUMN IF NOT EXISTS index_error  TEXT,
  ADD COLUMN IF NOT EXISTS indexed_at   TIMESTAMPTZ;

ALTER TABLE public.desk_ai_snippets
  ADD COLUMN IF NOT EXISTS content_hash TEXT
    GENERATED ALWAYS AS (md5(coalesce(title, '') || E'\n' || coalesce(content, ''))) STORED,
  ADD COLUMN IF NOT EXISTS indexed_hash TEXT,
  ADD COLUMN IF NOT EXISTS index_chunks INT,
  ADD COLUMN IF NOT EXISTS index_error  TEXT,
  ADD COLUMN IF NOT EXISTS indexed_at   TIMESTAMPTZ;
