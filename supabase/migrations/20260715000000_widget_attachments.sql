-- ─── P2: bucket para imagens/anexos do chat ────────────────────────────────────
--
-- O cliente envia a imagem via desk-widget-api (service role), que valida
-- tipo/tamanho e faz o upload. O bucket é PÚBLICO para leitura (a IA precisa de
-- uma URL acessível para analisar a foto, e o operador para visualizá-la), mas
-- NINGUÉM escreve direto: sem policy de INSERT para anon/authenticated, só o
-- service role sobe arquivos. O caminho tem UUID (não adivinhável).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'desk-attachments',
  'desk-attachments',
  true,
  4194304, -- 4 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura pública dos objetos do bucket (bucket já é public, mas a policy
-- explícita garante SELECT para anon mesmo com storage RLS ativo).
DROP POLICY IF EXISTS "desk_attachments_public_read" ON storage.objects;
CREATE POLICY "desk_attachments_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'desk-attachments');

-- Nenhuma policy de INSERT/UPDATE/DELETE para anon/authenticated:
-- somente o service role (que bypassa RLS) escreve.
