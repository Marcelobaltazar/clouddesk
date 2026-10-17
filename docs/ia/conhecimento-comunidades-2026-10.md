# Conhecimento extraído das comunidades Cloudfy (jul–out/2026)

Fonte: exports dos grupos "Cloudfy BR #2" e "Cloudfy BR (3)" — 12.630 mensagens de
01/07 a 13/10/2026. Lidas na íntegra todas as respostas dos admins (Marcelo e Gui,
~935 mensagens) com o contexto da pergunta. Fotos, vídeos e áudios **não** foram
analisados.

Regras usadas na extração:
- Só vira conhecimento oficial o que um **admin** afirmou. O que o Cris ou outros
  membros disseram fica na seção 3 (bom, mas precisa de validação).
- Nada de dado pessoal: nenhum nome de cliente, e-mail, telefone ou nome de infra.
- O que é de terceiros, concorrente, oferta temporária ou decisão caso a caso fica
  **fora** da IA (seção 4).

## Status — aplicado na base em 13/10/2026

Aprovado pelo Marcelo ("pode aprovar se você sabe que está certo; não podemos ter
duas respostas diferentes para o mesmo problema"). Antes de inserir, cada proposta
foi comparada com os 101 artigos e 17 snippets publicados; onde a base dizia outra
coisa, a base foi corrigida em vez de ganhar uma segunda versão. Tudo reindexado
(67 trechos, 0 falhas). Rollback: `docs/ia/kb-2026-10-13-rollback.sql`.

**Artigos corrigidos (7):** Upgrade e downgrade; Infras vs Planos; Comprar uma nova
infra; Starter vs Advanced vs Ultra vs MAX; Como cancelar um plano de infra;
Reembolsos e Trial gratuito (upgrade agora é pelo console; o suporte não cancela
pelo cliente; reembolso é analisado pelo financeiro); SLA & Suporte (24h → 12h em
dias úteis).

**Snippets corrigidos (9) e removido (1):** duplicata de "infra bloqueada" removida
(tinha link do Discord quebrado e prometia "até 12h"); "Minha infra está
bloqueada", "Erro de DNS no n8n" (era aviso de incidente de 08/10 dizendo "time
investigando"), "Política de reembolso", "Formas de pagamento" (+12x), "Como
atualizar o n8n?", "Quedas frequentes", "Não consigo excluir minha instância",
"Criar e excluir instâncias da Evolution", "MCP - CLOUDFY".

**Snippets novos (11):** S1 upgrade, S2 anual→mensal, S5 mensalidade atrasada,
S11 IA Ilimitada, S17/S18 mensagem não chega, S20 credenciais, S21 terminal/env,
S22 Supabase/Chatwoot, S23 backup, S24 suporte, S27 Hermes/OpenClaw.

**Segunda leva (mesmo dia):** S7 publicado depois da confirmação de que adicional
(número virtual, IA Ilimitada, backup) só a equipe de suporte cancela; o artigo
"Minha instância n8n está offline…" foi reescrito (mandava rodar docker/kubectl —
agora: confirmar pela URL, aguardar, Executions, reiniciar pelo console, chat).

**Terceira leva (mesmo dia):** número virtual passou a ser cancelado pelo próprio
cliente (Números Virtuais, no painel lateral); só IA Ilimitada e backup seguem com
a equipe. Snippet de adicionais atualizado.

**Desfeito em 17/10/2026:** a opção não existe para o cliente (caso real: "Não tem
essa opção"). Número virtual voltou a ser cancelado pela equipe, e a Luna pede o
número completo com DDD. Snippet em `kb-2026-10-17-numero-virtual.sql` (rollback ao
lado); guard `wantsVirtualNumberCancel` em `support-intents.ts`.

**Fora por enquanto:** S3, S6,
S9, S10 (baixa confiança ou já cobertos por artigo/página de preços); S12–S16, S19,
S25, S26 (fundidos em snippets existentes ou já cobertos).

**Pendência na base (não alterada):**
- "Onde posso ver minhas credenciais?" e "Onde encontrar minhas credenciais?" são
  dois artigos sobre o mesmo tema (hoje não se contradizem).

---

Seção original da proposta (antes da aprovação):

---

## 1. Correções urgentes na base atual

| Artigo / snippet | Problema | Evidência |
|---|---|---|
| **Upgrade e downgrade. Como funciona?** | Diz que não existe botão de upgrade e que é preciso assinar uma infra nova e migrar na mão. Desde **07/10/2026** existe upgrade direto com migração automática. | Em 08/10 um cliente reclamou no grupo que "o atendimento manda docs desatualizadas". |
| **SLA & Suporte: como funciona?** | Fala em resposta em até **24 horas**. O prazo combinado agora é **12 horas** (dias úteis; fim de semana e feriado = próximo dia útil). | Decisão de 13/10/2026. |
| Modelos da IA Ilimitada | Gemini 2.5 Flash vai ser descontinuado; Gemini 3.5 Flash entrou em 08/10. Conferir se algum artigo lista modelos. | Avisos dos admins de 07/10 e 08/10. |
| Evolution "volte para a 2.3.3" | Foi a orientação de ago/2026 para mensagens que não chegavam. Pode estar datada. **Confirmar antes** de virar snippet. | Avisos de 08/08 e 19/08. |

---

## 2. Snippets propostos (respostas oficiais, prontos para aprovar)

Cada item tem a resposta já no tom novo. Entre parênteses, a origem.

### Planos, upgrade e cobrança

**S1. Como faço upgrade de plano?** *(admin, 07/10 e 08/10)*
Agora dá pra fazer upgrade direto pela Cloudfy: Home → três pontinhos ao lado do
nome da infra → **Upgrade de plano**. Vc vai pra uma infra nova do plano escolhido e
a gente migra tudo automaticamente: workflows do n8n, banco de dados, configurações e
credenciais dos produtos Cloudfy. Vc paga só a diferença entre os planos.
Credenciais de serviços de fora (que vc mesmo criou) não migram, por segurança.
Antes de qualquer mudança, vale exportar um backup dos seus workflows.

**S2. Quero trocar de anual para mensal.** *(admin, 17/08)*
Não tem como converter uma assinatura anual em mensal. O caminho é assinar uma infra
mensal, migrar seus fluxos e cancelar a **renovação** da anual — ela continua ativa
até o fim do período que vc já pagou.

**S3. Mudei sem querer de mensal para anual.** *(admin, 07/07)*
A troca pede uma confirmação (o check) antes de cobrar. Se a cobrança já foi feita,
não dá pra voltar pelo sistema — aí precisa de análise da equipe.

**S4. Minha infra foi bloqueada por pagamento.** *(admins, vários casos)*
Quando a cobrança automática falha, a infra é bloqueada até o pagamento passar.
Atualiza o cartão em **Configurações → Faturamento** (ou pelo link da fatura). Assim
que o pagamento é confirmado, o acesso volta — normalmente é rapidinho.
Se vc **já pagou** e continua bloqueada, a operadora às vezes segura a liberação;
nesse caso a equipe libera manualmente.
*(Obs.: compra de add-on com cartão recusado — IA Ilimitada, número virtual — também
bloqueia a infra. Mesmo procedimento.)*

**S5. Paguei a fatura atrasada e bloqueou de novo.** *(admin, 24/08 e 07/10)*
A assinatura renova sempre no mesmo dia do mês. Se vc paga uma mensalidade atrasada
perto da próxima renovação, a próxima também vence — e, sem pagamento, a infra
bloqueia de novo. Pra liberar, é preciso quitar a mensalidade em aberto.

**S6. O que acontece quando eu cancelo?** *(admins, julho–outubro)*
O cancelamento é feito por vc em **Configurações → Faturamento → engrenagem da
assinatura**. A infra continua ativa até o fim do período que vc já pagou; depois disso
ela é **excluída** e não dá pra reativar nem recuperar. Antes de cancelar, faça backup
dos seus workflows e do banco. Se for trocar de infra, assine a nova primeiro, migre
e só depois cancele a antiga.

**S7. Quero cancelar só o número virtual (ou só um add-on), sem mexer na infra.**
*(admin, 03/07, 07/07, 14/07)*
Dá pra cancelar só o item, sem derrubar a infra. É a equipe que faz: peça pelo chat
de suporte informando o número. Dica: número já aquecido é ouro — se for usar com
outro cliente depois, vale manter.
*(Atenção: em 03/07 o chat disse a um cliente que precisava excluir a infra inteira
pra cancelar os números. Isso está errado.)*

**S8. Parcelamento.** *(admin, 07/08)*
Planos anuais podem ser parcelados em até 12x no cartão.

### O que vem em cada plano

**S9. O que vem em cada plano?** *(admin, 19/08 e 03/09)*
- n8n + PostgreSQL: sempre incluídos.
- Chatwoot: opcional no Advanced, Ultra e Max.
- Redis: incluso no Ultra e Max; no Advanced entra quando necessário.
- Supabase: Ultra e Max.
- WhatsApp: vc escolhe WAHA **ou** Evolution API (novas contratações).
- Modo fila do n8n: Ultra e Max.
- Max: tudo do Ultra + IA Ilimitada incluída, 30 execuções simultâneas (10 no
  Ultra), servidor dedicado mais rápido, 100 GB de banco + backup diário, CRM
  (Chatwoot ou Twenty), 50 mensagens do Doctor/mês, timeout maior e troca de domínio.
- Infra já criada não ganha serviços novos lançados depois; é uma contratação à parte.
- A Cloudfy não divulga configuração de memória/CPU das infras.

**S10. Starter serve pra cliente final?** *(admin, 23/09 e 02/10)*
O Starter é pra testes e estudo. Ele tem limites de memória e payload pra proteger
a infra, e com várias instâncias ou volume real tende a cair. Pra rodar pra cliente,
o recomendado é Advanced pra cima — e **uma infra por cliente**.

### IA Ilimitada

**S11. IA Ilimitada: erro de crédito, "budget exceeded" ou 402.** *(admins, julho–outubro)*
Quando vc ativa a IA Ilimitada, a Cloudfy cria sozinha no seu n8n a credencial
**openrouter_cloudfy**. Use o nó da OpenRouter com essa credencial e um dos modelos
liberados (a lista fica no console). Não altere o nome nem a chave dessa credencial —
se ela foi apagada ou alterada, a equipe precisa recriar.
No plano Max a IA já está incluída: não precisa ativar nem pagar de novo.
Prompt ou contexto muito grande também estoura o limite: vale enxugar o prompt e ter
um modelo de fallback no agente.

### Quedas, lentidão e reinício

**S12. Meu n8n caiu / fica caindo.** *(admins, julho–outubro)*
Na grande maioria das vezes a queda vem de dentro do n8n: fluxo em looping, sobrecarga
nos nós ou no banco, execuções presas ou muitas execuções ao mesmo tempo sem modo fila.
O n8n se derruba por segurança e costuma subir sozinho em alguns minutos.
Depois que voltar, olha as Executions procurando algo travado ou repetindo sem parar.
O MCP da Cloudfy ajuda muito nessa análise (dá pra pedir pro Claude/ChatGPT
investigar).
*(Para a IA: só diga ao cliente que foi looping/sobrecarga quando houver evidência.
Sem evidência, fale de forma neutra.)*

**S13. Quando e como reiniciar a infra.** *(admin, 27/07 e 18/09)*
Home → três pontinhos ao lado do nome da infra → **Reiniciar infra**, e aguarde uns
5 minutos. Use com moderação: se a causa foi sobrecarga ou looping, reiniciar uma vez
resolve na hora, mas não corrige o fluxo. Se o serviço já caiu de vez, o botão pode
dar erro — aí é com a equipe.

**S14. Erro de DNS no n8n (getaddrinfo EAI_AGAIN).** *(admin, 08/10 — incidente)*
Em 08/10 uma atualização do n8n gerou erros genéricos de DNS em requisições externas.
A orientação foi reiniciar a infra (S13) e aguardar 5 minutos.
*(Marcar como incidente datado; revisar se continua válido.)*

**S15. Atualizar ou voltar a versão do n8n.** *(admins)*
Meus serviços → n8n → admin → versões. Depois de trocar, aguarde 5 a 10 minutos.
Se o ambiente é muito antigo, não pule direto pra última versão. Versões muito
antigas saem da lista e não dá pra voltar pra elas. O n8n lança atualizações 3 a 4
vezes por semana.

### Evolution e WhatsApp

**S16. Criar, excluir ou destravar instância da Evolution.** *(admins, julho–outubro)*
Faça tudo pelo painel da Cloudfy: Meus serviços → Evolution → Instâncias. Por lá a
instância já sai configurada. O nome não pode ter espaços nem caracteres especiais
(o erro 404 "instance does not exist" costuma ser isso).
Se travou ou não deixa excluir: desconecte primeiro no celular (WhatsApp →
Aparelhos conectados), depois exclua e crie de novo pelo painel.
Se o celular fica sem internet ou desligado, a instância cai junto.

**S17. Mensagem fica "pending" ou não chega no WhatsApp.** *(admin, julho–agosto)*
O status "pending" é normal. Se a mensagem sai da Evolution mas não chega, quase
sempre é bloqueio da Meta — principalmente em número novo. Veja S18.

**S18. Número bloqueado ou restrito pela Meta.** *(admin, 17/07, 11/08, 17/09)*
Quem bloqueia é a própria Meta, não a Evolution. Antes de ligar um número na
automação, aqueça: use o WhatsApp normalmente por alguns dias, trocando mensagem com
pessoas de verdade. Evite nome de perfil com "IA", "Bot" ou "Automação". Mensagens
ativas (disparos) aumentam muito o risco. Número bloqueado não volta: é cancelar e
assinar outro.
Número virtual comprado na Cloudfy fica disponível em segundos ou minutos, e dá pra
escolher o DDD.

**S19. Webhook voltando pra URL de teste.** *(admin, 05/08)*
É normal: o editor mostra a URL de teste. Copie a de produção pra Evolution e
lembre de **publicar** o fluxo.

### Acesso e credenciais

**S20. Onde ficam minhas credenciais e senhas?** *(admins)*
Todas as credenciais dos serviços ficam no console: Meus serviços → [serviço] →
admin. Se o e-mail não chega, confira o spam e se o seu provedor não bloqueou os
e-mails da Cloudfy. A senha do Chatwoot não fica salva no console: resete pelo próprio
Chatwoot. Se esqueceu a senha do n8n, a equipe reseta e vc refaz o cadastro inicial.

**S21. Dá pra mexer em variáveis de ambiente, terminal ou Dockerfile?** *(admins, 03/07 e 21/07)*
Não. A infra já vem configurada e, por segurança, não tem acesso ao terminal nem
troca de variáveis. Deploy com Dockerfile próprio não é suportado.

**S22. Supabase e Chatwoot self-hosted: limitações.** *(admins)*
Supabase da Cloudfy: só o schema `public` fica exposto na API. Chatwoot da Cloudfy é
self-hosted: Instagram e SSO só existem no plano direto com o Chatwoot.

### Backup, suporte e ferramentas

**S23. Backup.** *(admin, 09/07 e 10/08)*
O add-on de backup roda uma vez por dia, no horário da contratação, e salva tudo da
infra (workflows, banco etc.). A restauração é feita pela equipe, em até 12 horas.

**S24. Como falo com o suporte?** *(admins)*
O suporte oficial é pelo chat dentro do console (canto inferior). Não existe
WhatsApp de suporte. O suporte cuida da infra (serviços no ar, acesso, cobrança).
Configuração de fluxo e problemas de número com a Meta ficam fora do escopo, mas a IA
e o MCP ajudam muito nisso.

**S25. MCP da Cloudfy.** *(admin, 17/09, 22/09, 06/10)*
O MCP é gratuito e conecta sua infra no Claude, ChatGPT, Cursor ou Codex. Pelo chat
da IA vc controla o painel, cria e ajusta fluxos no n8n, vê instâncias do WhatsApp e
o Supabase. É o melhor jeito de investigar quedas e erros de fluxo.
Como conectar: console → MCP (aba Tokens/Conectar). Sempre salve o JSON da versão
atual dos fluxos antes de pedir alterações.

**S26. Doctor e templates.** *(admin, 02/07, 09/07, 27/08)*
O Doctor fica no console e analisa/ajusta sua aplicação (há créditos grátis; o Max
tem 50 mensagens/mês). A biblioteca de templates também fica no console: os templates
são uma base e precisam ser ajustados ao seu negócio.

**S27. Outros produtos.** *(admins)*
- Hermes: roda numa infra separada, só dele; vc alterna entre infras no painel.
- OpenClaw é outro produto: tem planos sem IA, com Kimi K2 ou com Sonnet. A IA
  Ilimitada é só pro n8n.
- Quando o site cloudfy.space ou a Cloudflare ficam instáveis, as infras continuam
  rodando normalmente.
- Na América Latina, a Cloudfy atende só o Brasil.

---

## 3. Dicas boas da comunidade (precisam de validação)

Vieram principalmente do Cris. Valem como dica de n8n, não como fato da Cloudfy.
- Nó com dados fixados (pin) roda com dados fictícios: despin e teste de novo.
- Code node estourando timeout normalmente é dado que não chega no nó ou loop.
- Expressão com "=" sobrando no campo quebra o nó.
- Agente de IA sem fallback de modelo para de responder quando o provedor falha.
- MCP do n8n (oficial) roda fluxos e lê execuções; o MCP da Cloudfy opera a infra
  inteira. Um complementa o outro.

---

## 4. Fora da IA (risco de prejudicar)

- **Terceiros e concorrentes:** UAZAPI, WAHA externo, Blaber, Railway, Hostinger,
  NotificaMe, produtos e cursos de membros (inclusive o "guardian" do Cris). Os admins
  citaram alguns no grupo, mas a IA oficial não deve indicar.
- **Ofertas da comunidade:** crédito dos últimos 4 meses na migração para Ultra/Max
  anual (oferta exclusiva e temporária) — só humano.
- **Decisões caso a caso:** abatimento em migração com menos de 60 dias, reembolso,
  liberação manual de bloqueio, recriação de credencial — a IA encaminha, não promete.
- **Respostas de atendimento individual** ("já liberei", "testa em 3 min").
- **Discussões ásperas** entre admins e clientes irritados: são exemplo do que evitar.
- **Qualquer menção a servidor, provedor, localização ou hardware.** Um cliente
  reclamou em 07/10 que "a resposta automática afirmou coisas sobre o servidor que não
  eram verdadeiras, inclusive o local da hospedagem".

---

## 5. O que os clientes mais pedem (visão de CX)

Temas nas mensagens de membros (5.681 mensagens com mais de 25 caracteres):

| Tema | Menções |
|---|---|
| Evolution (travou, não envia, QR, instância) | 526 |
| **Suporte não responde / quero humano** | 299 |
| Bloqueio por pagamento / cobrança | 187 |
| Versão e atualização do n8n | 174 |
| IA Ilimitada / OpenRouter | 152 |
| Bloqueio da Meta / número | 142 |
| Infra caiu / lenta | 113 |
| Login, senha, credenciais | 100 |
| Upgrade / plano | 82 |
| Cancelamento | 77 |

Leituras:
1. **A maior dor é não ser atendido.** O grupo virou o suporte de verdade: o admin
   resolve em minutos o que o chat leva horas ou dias. Um cliente citou a promessa da
   IA de "4 horas" que não foi cumprida.
2. **"Já paguei e continua bloqueado"** é o caso mais repetido no financeiro. O admin
   libera manualmente em minutos. É candidato número 1 a automação (detectar pagamento
   confirmado + infra bloqueada).
3. **Evolution é o maior gerador de volume.** As respostas são quase sempre as mesmas
   (S16–S18): a IA pode resolver sozinha a maior parte.
4. **Quedas por looping/sobrecarga** são a principal causa de "infra caiu". O MCP é a
   melhor resposta, e a IA deve oferecê-lo sempre que o assunto for fluxo.
5. **Muita gente escreve o ticket com ChatGPT**: textos longos, técnicos e formais. A
   IA precisa responder à altura, sem cair em resposta genérica.
6. **Documentação desatualizada gera reclamação pública** (upgrade, link antigo da
   Central de Ajuda).
