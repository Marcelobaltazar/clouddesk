-- Política do Starter na base da IA (13/10/2026): no Starter o atendimento é a
-- Luna (IA), sem equipe humana; a equipe é dos planos Advanced, Ultra e Max.
-- Antes, o artigo "SLA & Suporte" e o snippet "Como falo com o suporte"
-- prometiam a equipe em 12 h para todo mundo — e a Luna repetia isso ao Starter.
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-13-starter.sql
-- Depois:  npx tsx scripts/reindex-kb.ts --pending
-- Desfazer: docs/ia/kb-2026-10-13-starter-rollback.sql
do $$
declare n int;
begin
  update desk_knowledge_base
     set content = replace(replace(content,
           $o1$Quando o seu atendimento passa para a equipe, a resposta vem **em até 12 horas em dias úteis**.$o1$,
           $n1$No plano **Starter**, o atendimento no chat é feito pela **Luna**, nossa assistente com IA: ela resolve com você na hora e mostra o caminho — inclusive o **MCP da Cloudfy**, que conecta sua infraestrutura no ChatGPT ou no Claude pra IA criar e ajustar seus fluxos. O atendimento da equipe é dos planos **Advanced, Ultra e Max**.

Nesses planos, quando o seu atendimento passa para a equipe, a resposta vem **em até 12 horas em dias úteis**.$n1$),
           $o2$-   Prazo: até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil.$o2$,
           $n2$-   **Plano Starter:** atendimento no chat com a Luna, nossa assistente com IA.

-   **Advanced, Ultra e Max:** quando precisa, a equipe assume — resposta em até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil.$n2$),
         updated_at = now()
   where id = '37da2e2c-9da0-471d-94c2-b4ccdea47b36'
     and position($o1$Quando o seu atendimento passa para a equipe, a resposta vem **em até 12 horas em dias úteis**.$o1$ in content) > 0
     and position($o2$-   Prazo: até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil.$o2$ in content) > 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'artigo SLA & Suporte: texto esperado não encontrado (% linhas)', n; end if;

  update desk_ai_snippets
     set content = $s$O suporte oficial é pelo chat dentro do Cloudfy Console. Não existe WhatsApp de suporte.

No plano Starter, o atendimento no chat é feito pela Luna, nossa assistente com IA: ela resolve na hora e mostra o caminho — inclusive o MCP da Cloudfy, que conecta a infraestrutura no ChatGPT ou no Claude pra IA criar e ajustar os fluxos. O atendimento da equipe é dos planos Advanced, Ultra e Max.

Nesses planos, quando o atendimento passa para a equipe, a resposta vem em até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil. Clientes de planos anuais têm prioridade na fila.

O suporte cuida da infraestrutura (serviços no ar, acesso, cobrança). Configuração de fluxo e bloqueio de número pela Meta ficam fora do escopo, mas a gente ajuda no que der — e o MCP da Cloudfy é ótimo pra isso.$s$
   where id = '9aa95e75-6e86-474e-8ce0-1a4adfa6a176'
     and content like 'O suporte oficial é pelo chat dentro do Cloudfy Console.%Quando o atendimento passa para a equipe%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'snippet Como falo com o suporte: texto esperado não encontrado (% linhas)', n; end if;
end $$;
