-- ─── desk_snippets ─────────────────────────────────────────────────────────────
-- Respostas rápidas reutilizáveis que o operador insere no composer (item 5).
-- Diferente da Base de Conhecimento (artigos públicos), snippets são internos:
-- textos curtos e canônicos para agilizar o atendimento.

CREATE TABLE IF NOT EXISTS public.desk_snippets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  shortcut   TEXT,                 -- atalho opcional, ex.: "/saudacao"
  category   TEXT,
  created_by UUID,                 -- desk_agents.id (FK lógica, sem acoplar)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_desk_snippets_title ON public.desk_snippets (title);

-- RLS: apenas operadores autenticados gerenciam/usam snippets.
ALTER TABLE public.desk_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_snippets_authenticated_all" ON public.desk_snippets;
CREATE POLICY "desk_snippets_authenticated_all" ON public.desk_snippets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
