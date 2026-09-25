-- ─── Artigos da Central: links do Intercom antigo → Central atual ─────────────
--
-- Os artigos importados do Intercom trazem no texto links para a Central
-- antiga (ajuda.cloudfy.cloud), que não existe mais. Em 25/09/2026 eram 24
-- artigos, 19 endereços distintos:
--   • ajuda.cloudfy.cloud/pt-BR/articles/<id>-<slug>  (16, todos com artigo
--     publicado aqui — o <id> do Intercom é o source_id do artigo importado)
--     → https://clouddesk-omega.vercel.app/ajuda/<id>-<slug do título ATUAL>,
--       o mesmo endereço que a própria Central gera (HelpCenter.tsx › articlePath);
--   • ajuda.cloudfy.cloud/pt-BR/ e qualquer outro caminho (inclui um
--     /articles/pagamento-faturas que não existe) → https://clouddesk-omega.vercel.app/ajuda
--
-- Idempotente: só toca artigo que ainda tem link antigo. updated_at não muda
-- (é migração de endereço, não edição de conteúdo). O content_hash muda, então
-- estes artigos aparecem como "Índice desatualizado" até serem reindexados
-- (Indexar pendentes no painel ou `npx tsx scripts/reindex-kb.ts --pending`).
-- Snippets ficam de fora: não aparecem na Central, e o pipeline da IA já
-- reescreve link antigo em toda resposta (_shared/help-links.ts).

DO $$
DECLARE
  art   RECORD;
  ref   RECORD;
  dest  RECORD;
  body  TEXT;
BEGIN
  FOR art IN
    SELECT id, content FROM public.desk_knowledge_base WHERE content ~ 'ajuda\.cloudfy\.cloud'
  LOOP
    body := art.content;

    -- 1. Link para artigo do Intercom que existe publicado aqui → mesmo artigo.
    FOR ref IN
      SELECT DISTINCT (regexp_matches(
        body, 'https?://ajuda\.cloudfy\.cloud/(?:[a-z]{2}(?:-[A-Z]{2})?/)?articles/([0-9]+)', 'g'))[1] AS source_id
    LOOP
      SELECT kb.title INTO dest
      FROM public.desk_knowledge_base kb
      WHERE kb.source_id = ref.source_id AND kb.is_published
      LIMIT 1;

      IF FOUND THEN
        body := regexp_replace(
          body,
          'https?://ajuda\.cloudfy\.cloud/(?:[a-z]{2}(?:-[A-Z]{2})?/)?articles/' || ref.source_id || '(?![0-9])(?:-[a-z0-9-]*)?',
          'https://clouddesk-omega.vercel.app/ajuda/' || ref.source_id || '-' ||
            -- mesmo slug de HelpCenter.tsx › slugify
            left(
              regexp_replace(
                regexp_replace(
                  btrim(regexp_replace(lower(extensions.unaccent(dest.title)), '[^a-z0-9[:space:]-]', '', 'g')),
                  '[[:space:]]+', '-', 'g'),
                '-{2,}', '-', 'g'),
              60),
          'g');
      END IF;
    END LOOP;

    -- 2. Qualquer outro endereço da Central antiga → página inicial da atual.
    body := regexp_replace(
      body,
      'https?://ajuda\.cloudfy\.cloud[^]()<>"''`[:space:]]*',
      'https://clouddesk-omega.vercel.app/ajuda',
      'g');

    UPDATE public.desk_knowledge_base SET content = body WHERE id = art.id AND content IS DISTINCT FROM body;
  END LOOP;
END $$;
