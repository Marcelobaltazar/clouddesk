-- Base da IA, 17/10/2026: número virtual volta a ser cancelado pela equipe.
-- Entre 13 e 16/10 o snippet dizia que o cliente cancelava em Números Virtuais —
-- a opção não existe para ele ("Não tem essa opção").
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-17-numero-virtual.sql
-- Depois: npx tsx scripts/reindex-kb.ts --pending
begin;
update desk_ai_snippets set content = $kbtxt$Cancelar só um adicional — número virtual, IA Ilimitada ou backup — sem mexer na sua infraestrutura é feito pela equipe de suporte. Pelo painel não dá pra cancelar nenhum deles sozinho: lá só aparece o cancelamento do plano inteiro.

Número virtual: peça por aqui e informe o número completo com DDD, ex.: (11) 91234-5678 — é por ele que a equipe acha a linha.

IA Ilimitada ou backup: é só pedir por aqui informando qual adicional.

Dica: número já aquecido vale ouro. Se for usar com outro cliente depois, pode valer a pena manter.$kbtxt$, updated_at = now() where id = 'b69d058e-6fef-49a3-be3b-dcdd82425b4a';
commit;
