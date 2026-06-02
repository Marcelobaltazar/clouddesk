-- ─── desk_snippets: garantir colunas faltantes ─────────────────────────────────
-- A migration 20260602130000 foi registrada como aplicada mas o ALTER TABLE
-- não adicionou as colunas no banco remoto (a tabela ficou só com
-- id, title, content, category, created_at). Reaplicamos aqui de forma
-- idempotente para que o painel (Respostas rápidas) e o picker do composer
-- consigam ler/gravar shortcut, category, created_by e updated_at.

ALTER TABLE public.desk_snippets
  ADD COLUMN IF NOT EXISTS shortcut   TEXT,                          -- atalho, ex.: "/saudacao"
  ADD COLUMN IF NOT EXISTS category   TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,                          -- desk_agents.id (FK lógica)
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_desk_snippets_title ON public.desk_snippets (title);
