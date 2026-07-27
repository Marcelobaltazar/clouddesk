-- ─── Bucket para imagens da Base de Conhecimento ───────────────────────────────
--
-- As imagens/GIFs dos artigos importados do Intercom vivem hoje em URLs assinadas
-- do intercomcdn.com (que podem expirar). Migramos os arquivos para este bucket
-- público — imagens estáveis, nossas, servíveis na central de ajuda e nas
-- respostas ao cliente.
--
-- Público para leitura (a central /ajuda é pública). Só o service role escreve
-- (o script de migração usa service role; ninguém sobe arquivo direto).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'desk-kb-images',
  'desk-kb-images',
  true,
  15728640, -- 15 MB (GIFs de tutorial podem ser grandes)
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "desk_kb_images_public_read" ON storage.objects;
CREATE POLICY "desk_kb_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'desk-kb-images');
