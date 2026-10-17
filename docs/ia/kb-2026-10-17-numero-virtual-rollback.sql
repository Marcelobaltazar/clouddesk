-- Rollback de docs/ia/kb-2026-10-17-numero-virtual.sql (texto de 13/10/2026).
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-17-numero-virtual-rollback.sql
-- Depois: npx tsx scripts/reindex-kb.ts --pending
begin;
update desk_ai_snippets set content = $kbtxt$Número virtual: você mesmo cancela, sem mexer na sua infraestrutura. No painel lateral da Cloudfy, abra **Números Virtuais**, localize o número e cancele por lá.

IA Ilimitada ou backup: esse cancelamento é feito pela equipe de suporte — é só pedir por aqui informando qual adicional.

Dica: número já aquecido vale ouro. Se for usar com outro cliente depois, pode valer a pena manter.$kbtxt$, updated_at = now() where id = 'b69d058e-6fef-49a3-be3b-dcdd82425b4a';
commit;
