-- Rollback da política do Starter na base da IA (13/10/2026) — conteúdo original.
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-13-starter-rollback.sql
-- Depois: npx tsx scripts/reindex-kb.ts --pending
begin;
update desk_knowledge_base set content = $kbtxt$A gente é um grupo de apaixonados por automação e DevOps — geeks totais nesse assunto — e estamos aqui pra ajudar. Nosso time manja de todas as ferramentas e realmente curte resolver problemas. Mas... a gente não é super-herói.

Quando o seu atendimento passa para a equipe, a resposta vem **em até 12 horas em dias úteis**. Em fim de semana e feriado, a resposta vem no próximo dia útil. Temos milhares de clientes e queremos que cada um sinta que é único — então a gente faz tudo com calma pra dar tudo certo.

## Fato curioso sobre os chamados

Mais de **80% dos chamados que recebemos** não têm nada a ver com a infraestrutura da Cloudfy. É sobre os fluxos dos clientes — automações que não funcionam, gatilhos que não disparam, loops que nunca acabam, DNS que não propaga.

Tecnicamente, resolver essas coisas nem faz parte do nosso SLA... mas a gente ajuda mesmo assim. Sabe por quê? Porque a gente não resiste a um bom quebra-cabeça de automação — e a gente quer ver você ganhar.

* * *

## Como falar com a gente

-   **Chat dentro do app:** Disponível no seu painel (mas só se você tiver uma **infraestrutura ativa** com a gente)
    

![](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/37da2e2c-9da0-471d-94c2-b4ccdea47b36/c63b52192254d6d5.png)

## Suporte prioritário? Temos

Clientes com infraestrutura em **planos anuais** têm prioridade na fila. Se velocidade é importante pra você, pense em fazer um upgrade — isso te coloca na frente da linha.

## Resumo: como a gente trabalha

-   Prazo: até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil.
    
-   **Clientes com plano anual:** Resposta prioritária.
    
-   **Só infra ativa:** Suporte via chat.
    
-   **Maioria dos tickets:** Sobre fluxos dos clientes, não a infra do Cloudfy — e sim, a gente ajuda nisso também (porque somos legais assim).
    

Se você travou — seja um bug de infra de verdade ou só um fluxo que resolveu te desafiar — chama a gente!$kbtxt$ where id = '37da2e2c-9da0-471d-94c2-b4ccdea47b36';
update desk_ai_snippets set content = $kbtxt$O suporte oficial é pelo chat dentro do Cloudfy Console. Não existe WhatsApp de suporte.

Quando o atendimento passa para a equipe, a resposta vem em até 12 horas em dias úteis; em fim de semana e feriado, no próximo dia útil. Clientes de planos anuais têm prioridade na fila.

O suporte cuida da infraestrutura (serviços no ar, acesso, cobrança). Configuração de fluxo e bloqueio de número pela Meta ficam fora do escopo, mas a gente ajuda no que der — e o MCP da Cloudfy é ótimo pra isso.$kbtxt$ where id = '9aa95e75-6e86-474e-8ce0-1a4adfa6a176';
commit;
