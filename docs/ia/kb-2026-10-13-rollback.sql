-- Rollback das alterações na base da IA feitas em 13/10/2026 (conteúdo original).
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-13-rollback.sql
-- Depois: npx tsx scripts/reindex-kb.ts --pending
begin;
update desk_knowledge_base set content = $kbtxt$Quando suas automações começam a crescer — ou quando seus fluxos de trabalho ficam mais complexos e pesados — é normal pensar em fazer um upgrade. Talvez você esteja enfrentando atrasos na execução, ou percebeu que seu plano atual não tem as ferramentas ou a performance que você precisa agora.

Mas antes de sair procurando por um botão de “mudar de plano”, é importante entender como a infraestrutura funciona na Cloudfy.

* * *

### **Como as infraestruturas da Cloudfy são projetadas**

As infraestruturas da Cloudfy são **contêineres escaláveis** criados para rodar todos os seus projetos, agentes, fluxos de trabalho e automações. Olha só o que faz elas serem diferentes:

**Funcionalidade**

**Descrição**

Sem limite de projetos ou fluxos

Você pode hospedar quantos fluxos ou projetos quiser em uma única infra.

Execuções ilimitadas

Não tem limite de quantas execuções você pode rodar.

Processamento sequencial (em fila)

As execuções rodam uma depois da outra — não tudo ao mesmo tempo.

Ambiente dedicado

Cada infra é totalmente isolada das outras, garantindo estabilidade e segurança.

**Importante:** Porque as execuções são processadas em sequência (uma de cada vez), se você acionar muitos fluxos de trabalho ao mesmo tempo, eles podem formar uma fila — causando **atrasos**. Isso é um sinal de que sua configuração atual de infra pode não estar mais dando conta das suas necessidades de performance.

* * *

### **Por que a Cloudfy não faz upgrades ou downgrades “tradicionais”**

Diferente de outras plataformas onde você pode “subir” de plano para liberar recursos ou mais potência, a Cloudfy usa uma **filosofia diferente**:

Você não muda uma infra — você simplesmente **cria uma nova** com as especificações que você precisa.

Pensa como comprar um notebook: se o seu MacBook atual não aguenta edição de vídeo ou tarefas pesadas, você não faz “upgrade” nele — você compra um novo que atenda ao que você precisa.

As infraestruturas da Cloudfy funcionam do mesmo jeito.

* * *

### **Como escalar usando várias infraestruturas**

Você pode criar **quantas infraestruturas quiser**, com **planos e tipos de cobrança diferentes** pra cada. Isso te dá liberdade total pra organizar seus projetos do jeito que quiser.

**Exemplos:**

**Cenário**

**Sua configuração**

Um projeto crescendo rápido

Crie uma nova infra Ultra só pra esse projeto

Gerenciando vários clientes

Separe uma infra Starter pra cada um

Necessidades de cobrança diferentes

Escolha planos anuais pra infra principal, mensal pros testes

Se você tá testando um MVP pequeno ou rodando um agente super importante, é só criar a infra que combina com o que você precisa — sem migração, sem trocar de plano, sem dor de cabeça. Com a Cloudfy, você não fica preso(a) em um único plano. Dá pra combinar quantas infraestruturas quiser, cada uma com suas próprias configurações e ciclo de pagamento.

Por exemplo, você pode ter 3 infraestruturas no **Starter** — 2 cobradas todo mês e 1 cobrada por ano. Ao mesmo tempo, você pode rodar 2 do **Advanced** infraestruturas, as duas cobradas anualmente, e 5 do **Ultra** — com 3 cobradas todo mês e 2 cobradas por ano.

Cada infraestrutura é gerenciada de forma independente, dando total liberdade pra escalar, organizar e pagar do jeito que faz mais sentido pra cada projeto ou cliente.

#### **Resumo**

-   Você controla cada uma separadamente
    
-   Você pode escalar ou cancelar individualmente
    
-   Você é livre pra atribuir cada uma pra um cliente, projeto ou caso de uso diferente
    

* * *

### **O que fazer se sua infra atual estiver lenta**

Se você tá enfrentando atrasos, provavelmente quer dizer que sua infraestrutura atual tá recebendo mais execuções do que consegue processar direitinho em sequência.

Veja como lidar com isso:

1.  **Mantenha sua infra atual funcionando** para as tarefas menores ou que não têm tanto problema com o tempo.
    
2.  **Compre uma nova infra** (por exemplo, Advanced ou Ultra) pros fluxos que precisam de mais velocidade e desempenho.
    
3.  **Migre aos poucos** seus fluxos ou agentes pra nova infra.
    
4.  **Cancele a infra antiga** se não precisar mais — dá pra fazer rapidinho pelo Portal do Cliente.
    

* * *

**Resumo**

-   A Cloudfy **não** dá suporte para upgrade ou downgrade de infraestruturas já existentes.
    
-   Em vez disso, você pode criar **novas infraestruturas** com planos e ciclos de cobrança diferentes — a qualquer hora.
    
-   Todas as infras são isoladas, têm execução em fila e oferecem espaço ilimitado para projetos.
    
-   **Você pode combinar os planos do jeito que quiser** conforme suas necessidades mudam — sem restrições.
    
-   Se você precisar de mais que uma infra, é só comprar outra — simples, modular e escalável.
    

Precisa de ajuda pra escolher o plano certo pra sua próxima infra? Fale com nosso time pelo chat do console em: [https://cloudfy.space](https://cloudfy.space)$kbtxt$, updated_at = now() where id = '4094f24b-6018-446e-a9bd-d528a7b2b954';
update desk_knowledge_base set content = $kbtxt$Quando você usa o Cloudfy, é importante entender a diferença entre _infraestruturas_ e _planos (tipos de infra)_, já que eles têm relação mas não são a mesma coisa.

### **O que são Infraestruturas?**

Infraestruturas são as máquinas ou servidores que você aluga pra rodar sua instância do n8n, hospedar seus fluxos de trabalho e executar suas automações. Pense neles como computadores físicos ou virtuais conectados à internet, prontos pra você usar.  
​

Cada infraestrutura tem só **uma instância** (conta) de cada aplicação, dependendo do plano dela (veja abaixo):

-   1 conta n8n
    
-   1 banco de dados Supabase
    
-   1 gerenciador Evolution API
    
-   1 conta Redis
    
-   1 conta Chatwoot
    

Você pode criar quantos workflows quiser dentro dessa infraestrutura, mas todos os workflows rodam na **mesma conta n8n, usando o mesmo banco de dados, a mesma memória e tudo mais**.

Se quiser usar bancos de dados diferentes ou ter várias contas n8n, você precisa comprar uma **nova infraestrutura**.

* * *

### **O que é um Plano? (tipo de infra)**

Cada infraestrutura vem com um _tipo_ — o que a gente chama de **plano**. Você também pode pensar nisso como o _tamanho_ ou _modelo_ da infraestrutura, tipo como os MacBooks têm versões com telas de 13” e 16”.

Aqui na Cloudfy, a gente oferece quatro planos de infraestrutura (ou tipos) pra você escolher:

-   **Starter**
    
-   **Advanced**
    
-   **Ultra**
    
-   MAX
    

Cada plano oferece uma potência e recursos diferentes, dependendo do que você precisa.

* * *

### **Tabela de comparação de planos**

Recurso / Plano

Starter

Advanced

Ultra

Max

n8n

✓

✓

✓

✓

Limite de workflows

Até 3 workflows

Ilimitado

Ilimitado

Ilimitado

WhatsApp API (Evolution)

✓

✓

✓

✓

Banco de dados (Storage)

\-

\-

50 GB

100 GB

Redis

\-

✓

✓

✓

Chatwoot CRM

\-

✓

✓

✓

Supabase

\-

\-

✓

✓

Execuções simultâneas

\-

\-

10

30

Modo fila (queue mode) no n8n

\-

\-

✓

✓

Backup diário

\-

\-

\-

✓

Servidor dedicado

\-

\-

\-

✓

IA ilimitada (bots e automações)

\-

\-

\-

✓

URLs com SSL

✓

✓

✓

✓

Credenciais pré-configuradas

✓

✓

✓

✓

SMTP pronto para uso

✓

✓

✓

✓

Timeout de execução maior

\-

\-

\-

✓

* * *

### **Resumo**

-   Você pode ter **várias infraestruturas** na mesma conta Cloudfy. Cada infraestrutura precisa ter um **plano** (ou tipo, se preferir) que você escolhe de acordo com o projeto que quer rodar nela.
    
-   Sua **conta Cloudfy NÃO tem um plano** — os planos ficam em cada infraestrutura que você compra.
    
-   Por exemplo, se você tem 1 infra do tipo Starter, 1 do Advanced e 2 do Ultra, sua conta Cloudfy não está vinculada a nenhum plano específico, pois cada infra tem seu próprio plano.
    
-   Então, você pode ter quantas infraestruturas quiser, cada uma diferente e independente entre si.
    
-   Cada infraestrutura pode ser assinada mensalmente ou anualmente, te dando total flexibilidade para cada projeto.  
    ​
    
-   **IMPORTANTE:** **Você** **não pode fazer upgrade ou downgrade do plano de uma infra**. Se você quiser mais recursos ou potência, precisa comprar uma nova infraestrutura e escolher um plano diferente pra ela. (Pensa no exemplo do MacBook: se você tem um MacBook de 13” e quer uma tela maior, não dá pra só trocar a tela—tem que comprar outro MacBook).$kbtxt$, updated_at = now() where id = 'a4577d78-b546-480a-931d-e286c1f6092b';
update desk_knowledge_base set content = $kbtxt$Este guia vai te mostrar o passo a passo para gerenciar suas infraestruturas Cloudfy — incluindo como cancelar uma infraestrutura ativa, mudar a frequência de cobrança (mensal para anual ou ao contrário), atualizar formas de pagamento e adicionar novas infraestruturas.

* * *

### Adicionar uma nova infra

Se você quiser adicionar uma nova infraestrutura ( com outro plano ou ciclo de cobrança ), é preciso fazer uma nova compra . Siga estes passos:

1.  Acesse [https://cloudfy.space/infrastructure/new](https://cloudfy.space/infrastructure/new)
    
2.  Escolha o plano de infraestrutura que você quer (Starter, Advanced ou Ultra.
    
3.  Selecione o ciclo de cobrança que preferir — mensal ou anual (obs: planos anuais normalmente têm desconto)
    
4.  Finalize a compra
    

[Starter vc Advanced vs Ultra - Escolhendo o plano certo para cada infra](https://clouddesk-omega.vercel.app/ajuda/12292983-starter-vs-advanced-vs-ultra-vs-max-escolhendo-o-plano-certo)

Depois da compra, sua nova infraestrutura vai aparecer no menu **Infrastructure** dentro da sua conta Cloudfy. Em poucos minutinhos ela já estará pronta pra usar e você recebe as credenciais por email.

![](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/891f1259-081c-4caf-ab4c-a62bbcd71187/bf6afa268ee31f8a.png)

* * *

#### Entendendo a diferença entre infras e planos

![](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/891f1259-081c-4caf-ab4c-a62bbcd71187/6e2a5babdc8e3139.png)

[Infras vs Planos: Eles são iguais? Qual é a diferença?](https://clouddesk-omega.vercel.app/ajuda/12293349-infras-vs-planos-qual-e-a-diferenca)

* * *

### Posso fazer um upgrade ou downgrade de um plano de infraestrutura?

Diferente de alguns serviços de assinatura onde você pode fazer upgrade ou downgrade do plano fácil, **a Cloudfy não permite trocar o tipo de plano de uma infraestrutura já existente**.

Se você precisa de mais recursos, funções ou espaço do que a infraestrutura atual oferece, a única opção é **comprar uma nova infraestrutura** com o plano/tipo desejado (**Starter**, **Advanced**, ou **Ultra**) e, se não precisar mais da antiga, cancelar ela.

Essa forma garante que cada infraestrutura rode no melhor desempenho e mantém seus projetos estáveis e seguros.

[Upgrade e downgrade. Como funciona?](https://clouddesk-omega.vercel.app/ajuda/12293482-upgrade-e-downgrade-como-funciona)

* * *

### Portal do Cliente

Todos os pagamentos e assinaturas recorrentes são processados pelo **Stripe**, nosso parceiro confiável de pagamentos. Por isso, você gerencia seu faturamento e assinaturas pelo **[Portal do Cliente](https://billing.stripe.com/p/login/9AQ9Es0vUebO6A0eUU)**.

O que você pode fazer dentro do Portal do Cliente:

#### **1\. Cancelar uma infra ativa**

Selecione a assinatura que você quer cancelar e clique em **Cancelar**. Sua infraestrutura será desativada logo depois.

#### 2\. Alterar frequência de cobrança

Para mudar entre cobrança mensal e anual, encontre sua assinatura e clique em **Atualizar assinatura**. Escolha o ciclo de cobrança que preferir e confirme.  
​

#### **3\. Atualizar método de pagamento**

Vá até a seção **Método de pagamento**, clique em **Mais opções**, depois selecione **Adicionar método de pagamento** para adicionar ou trocar os dados do seu cartão.

#### **4\. Atualizar informações de cobrança**

Você também pode editar seu endereço pessoal e de cobrança em **Atualizar Informações.**$kbtxt$, updated_at = now() where id = '891f1259-081c-4caf-ab4c-a62bbcd71187';
update desk_knowledge_base set content = $kbtxt$* * *

Escolher o plano de infraestrutura certo é fundamental pra garantir boa performance e os recursos adequados pros seus projetos de automação — sem investir em capacidade que você não vai usar.  
Neste guia, explicamos as diferenças entre os planos **Starter, Advanced, Ultra e Max**, pra facilitar sua decisão.

* * *

## O que é a Cloudfy?

A Cloudfy é uma plataforma de infraestrutura pronta pra automações e agentes de IA. Ela entrega ambientes totalmente hospedados, com ferramentas já instaladas como:

-   n8n
    
-   Evolution WhatsApp API
    
-   Redis
    
-   Chatwoot
    
-   Supabase (disponível nos planos Ultra e Max)
    

Isso permite colocar workflows, bots e agentes de IA em produção rapidamente, sem precisar lidar com servidores, instalações manuais ou configurações complexas.

* * *

## Recursos em comum em todos os planos

Independentemente do plano escolhido, você recebe:

-   n8n pronto pra uso
    
-   Evolution WhatsApp API
    
-   URLs com SSL
    
-   Credenciais pré-configuradas
    
-   SMTP pronto para envio de e-mails
    
-   Ambiente hospedado e gerenciado
    

* * *

## Como escolher o plano certo para seus projetos?

## 1\. Plano Starter — Ideal pra começar

Indicado se:

-   Você está iniciando em automações
    
-   Precisa rodar poucos fluxos (até 3)
    
-   Quer usar n8n e WhatsApp API sem complexidade
    

Melhor opção para uso individual, testes ou projetos simples.

* * *

## 2\. Plano Advanced — Para projetos em crescimento

Indicado se:

-   Você precisa de mais espaço (10 GB)
    
-   Quer usar Redis para melhorar performance
    
-   Precisa do Chatwoot para atendimento e automações
    
-   Vai rodar vários workflows sem limitação
    

Boa escolha para pequenos negócios ou operações em expansão.

* * *

## 3\. Plano Ultra — Para automações mais robustas

Indicado se:

-   Você precisa de 50 GB de banco de dados
    
-   Quer usar Supabase como backend
    
-   Precisa rodar execuções simultâneas (até 10)
    
-   Vai usar n8n em modo fila (queue mode)
    
-   Quer estruturar projetos maiores ou atender vários clientes
    

Voltado para operações com maior volume e complexidade.

* * *

## 4\. Plano Max — Para produção em escala

Indicado se:

-   Você precisa de 100 GB de banco de dados
    
-   Quer até 30 execuções simultâneas
    
-   Precisa de backup diário
    
-   Quer servidor dedicado
    
-   Precisa de maior limite de execução
    
-   Vai rodar projetos críticos em produção
    
-   Quer IA ilimitada para bots e automações
    

Plano ideal para empresas, agências ou produtos em produção contínua.

* * *

**Posso ter vários clientes ou projetos em uma única infra?**  
Pode, mas não é o ideal. Apesar de os planos permitirem vários workflows, as execuções concorrem entre si. Se você concentrar muitos projetos em uma só infra, pode haver lentidão. A recomendação é criar uma nova infra para cada projeto relevante.

* * *

**Posso fazer upgrade ou downgrade do plano depois?**  
Não. O plano é definido no momento da criação da infra. Para mudar de plano, é necessário criar uma nova infra com o plano desejado e cancelar a antiga.

* * *

**Quantos workflows posso rodar?**  
Starter: até 3 workflows.  
Advanced, Ultra e Max: workflows ilimitados.

* * *

**A Cloudfy é uma VPS? Preciso gerenciar servidor?**  
Não. A Cloudfy é uma plataforma gerenciada. Você não escolhe máquina, sistema operacional ou configurações técnicas. Tudo já vem pronto e funcionando. Você foca nas automações, não na infraestrutura.

* * *

Se você está começando, o plano Starter atende bem.  
Se o projeto crescer, os planos Advanced e Ultra trazem mais recursos de banco de dados e atendimento.  
Para produção em escala, o plano Max oferece capacidade, concorrência e segurança.

O objetivo é simples: permitir que você construa e publique automações rapidamente, sem se preocupar com a complexidade da nuvem.

Se precisar de ajuda para escolher o plano ideal pro seu projeto, o time de suporte pode orientar a qualquer momento.$kbtxt$, updated_at = now() where id = 'd87a2efb-45e8-4596-b692-a473c47185e0';
update desk_knowledge_base set content = $kbtxt$## Cancelamento

Você pode cancelar sua infraestrutura a qualquer momento — sem complicação nenhuma. Inclusive se tiver mais de uma infra configurada conosco, pode cancelar cada uma independente da outra. Basta seguir as orientações aqui e respeitas os **[Termos & Condições de uso e política de cancelamento.](https://www.cloudfy.host/terms)**

### ⚠️ **Importante:** Cancelamento e upgrades precisam ser feito por você diretamente no Portal do Cliente Stripe. **Suporte por email ou chat não realizam cancelamentos ou upgrades de infraestruturas e planos**.

* * *

**1**

## **Selecionar a infra desejada**

Clique no canto superior esquerdo e escolha a infra que você deseja gerenciar. Todas as ações seguirão na infra selecionada.

![Selecionar a infra desejada](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/b791f37d-808b-4fd8-b248-2ce2ffc07a6e/d968145b8ff2dfb6.jpg)

**2**

## **Acessar Configurações**

Após escolher a infra, clique na opção Configurações no menu para prosseguir.

![Acessar Configurações](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/b791f37d-808b-4fd8-b248-2ce2ffc07a6e/c3195baf7b956415.jpg)

**3**

## **Acessar Faturamento**

Clique na seção Faturamento para visualizar e alterar detalhes relacionados.

![Acessar Faturamento](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/b791f37d-808b-4fd8-b248-2ce2ffc07a6e/589624f07b048cde.jpg)

**4**

## **Gerenciar assinaturas**

Na página de assinaturas, clique na engrenagem para acessar opções adicionais de gerenciamento.

![Gerenciar assinaturas](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/b791f37d-808b-4fd8-b248-2ce2ffc07a6e/384414071160295b.jpg)

**5**

## **Cancelar a infra**

Siga para a opção de cancelamento da infra selecionada para completar o processo.  
​

* * *

  
​

![](https://tgjvjgvbqckoqjtgbjqx.supabase.co/storage/v1/object/public/desk-kb-images/b791f37d-808b-4fd8-b248-2ce2ffc07a6e/e2831860395bc696.gif)

  
​

* * *

## Teste grátis de 7 dias, como funciona?

-   Nos **planos** **anuais**, você sempre tem 7 dias para testar sem pagar nada.
    
-   É válido para cada nova infraestrutura que você ativar.
    
-   Você coloca o cartão, mas a cobrança só acontece se você NÃO cancelar até o sétimo dia.
    

**Exemplo rapidinho:**

-   Ativou a infra dia 1º? O teste vai até dia 7.
    
-   Cancelou até lá? Nada será cobrado e a infra é desativada.
    
-   Não cancelou? No dia 8 o valor anual será cobrado.
    

* * *

## Reembolsos e Trial gratuito — entenda

#### ❌ Quando você NÃO tem direito a reembolso

-   Quando assina qualquer infra em plano mensal.
    
-   A partir do oitavo dia, quando assina no plano anual.
    

#### ✅ Quando você NÃO paga nada

-   Cancelando dentro dos 7 dias de teste do plano anual. Totalmente sem custo.$kbtxt$, updated_at = now() where id = 'b791f37d-808b-4fd8-b248-2ce2ffc07a6e';
update desk_knowledge_base set content = $kbtxt$Antes de assinar um plano da Cloudfy, é importante entender como funcionam o período de teste gratuito e a nossa política de reembolsos.

Nesta seção, você encontra explicações claras sobre quando o trial se aplica, em quais situações não há cobrança, e os casos em que não existe direito a reembolso. Isso ajuda você a tomar decisões com tranquilidade e evitar surpresas na sua fatura.

* * *

### **Trial gratuito de 7 dias**

-   Todo novo plano **anual** vem com um período de teste grátis de 7 dias.
    
-   Esse trial é válido para **cada nova infraestrutura** que você ativar.
    
-   Para ativar, você precisa informar um cartão de crédito, mas a cobrança só acontece se você **não cancelar** até o 7º dia.
    
    ⚠️ Importante: o trial é exclusivo para **planos anuais**. Em planos mensais não existe período gratuito.
    

* * *

### Reembolso

#### **Quando você não tem direito a reembolso?**

-   Se assinou qualquer plano **mensal**.
    
-   Se deixou passar o período de trial (7 dias) no **plano anual**. A partir do 8º dia a cobrança é válida e não há devolução.
    

* * *

### **Cancelamento**

Você pode cancelar sua infraestrutura a qualquer momento — sem complicação nenhuma. Inclusive se tiver mais de uma infra configurada conosco, pode cancelar cada uma independente da outra. Basta seguir as orientações aqui e respeitar os **[Termos & Condições de uso e política de cancelamento.](https://www.cloudfy.host/terms)**

-   Toda a gestão de cobranças, cancelamentos e upgrades é feita direto pelo **Portal do Cliente Stripe**.
    
-   Você acessa pelo painel Cloudfy em **Configurações > Faturamento**.
    
    ⚠️ **Importante**: suporte via chat ou e-mail **não realizam cancelamentos ou upgrades**, apenas você pode fazer isso direto no portal.$kbtxt$, updated_at = now() where id = 'ed020597-bc16-4a69-b39b-772be28697db';
update desk_knowledge_base set content = $kbtxt$A gente é um grupo de apaixonados por automação e DevOps — geeks totais nesse assunto — e estamos aqui pra ajudar. Nosso time manja de todas as ferramentas e realmente curte resolver problemas. Mas... a gente não é super-herói.

Nossa meta é responder **todo chamado em até 24 horas**, mas às vezes demora um pouco mais. Temos milhares de clientes e queremos que cada um sinta que é único — então a gente faz tudo com calma pra dar tudo certo.

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

-   Meta: Responder em até 24h ( às vezes mais rápido, às vezes demora um pouquinho ).
    
-   **Clientes com plano anual:** Resposta prioritária.
    
-   **Só infra ativa:** Suporte via chat.
    
-   **Maioria dos tickets:** Sobre fluxos dos clientes, não a infra do Cloudfy — e sim, a gente ajuda nisso também (porque somos legais assim).
    

Se você travou — seja um bug de infra de verdade ou só um fluxo que resolveu te desafiar — chama a gente!$kbtxt$, updated_at = now() where id = '37da2e2c-9da0-471d-94c2-b4ccdea47b36';
insert into desk_ai_snippets (id, title, content, category) values ('fbda655f-46cf-421f-95bb-22660055f09f', $kbtxt$Minha infra esta bloqueada$kbtxt$, $kbtxt$Alguns casos, o acesso pode ser temporariamente impactado quando há alguma tentativa de cobrança que não é autorizada pela operadora do cartão.
﻿​﻿
﻿Posteriormente mesmo após o pagamento ser processado, pode ocorrer um prazo de até 12h até a normalização completa do acesso pela operadora.

Caso precise consultar algum procedimento, nossa central de ajuda está aqui:

https://ajuda.cloudfy.cloud/pt-BR/
​﻿
﻿Grupo do Discord: https://discord.gg/uDftSRtfK$kbtxt$, $kbtxt$Infraestrutura$kbtxt$);
update desk_ai_snippets set title = $kbtxt$MInha infra está bloqueada$kbtxt$, content = $kbtxt$Em alguns casos, o acesso pode ser temporariamente impactado quando há alguma tentativa de cobrança que não é autorizada pela operadora do cartão.
﻿​﻿
﻿Posteriormente mesmo após o pagamento ser processado, pode ocorrer um prazo de até 12h até a normalização completa do acesso pela operadora.

Caso precise consultar algum procedimento, nossa central de ajuda está aqui:

https://ajuda.cloudfy.cloud/pt-BR/
​﻿
﻿Grupo do Discord: https://discord.gg/uDftSRtfKe$kbtxt$, category = $kbtxt$Financeiro$kbtxt$, updated_at = now() where id = '2c3beaa1-dda7-4e55-bafb-ac69e4ba5c80';
update desk_ai_snippets set title = $kbtxt$Instabilidade DNS após atualização do n8n$kbtxt$, content = $kbtxt$Identificamos uma instabilidade relacionada ao DNS após algumas atualizações recentes do n8n, que pode afetar o funcionamento de algumas infraestruturas.

Nosso time técnico já está atuando na investigação e trabalhando na correção do problema.

Assim que tivermos novas informações, atualizaremos este chamado.$kbtxt$, category = $kbtxt$bug$kbtxt$, updated_at = now() where id = '5b86ab88-c2b6-437b-a693-1b039dba8ecb';
update desk_ai_snippets set title = $kbtxt$Politica de reembolso$kbtxt$, content = $kbtxt$Entendo que você tenha dúvidas sobre o reembolso e estou aqui para esclarecer como funciona nossa política, baseada no tipo de plano contratado:

 📅 Planos Mensais

De acordo com nossos Termos e Condições, os planos mensais não possuem período de teste gratuito (trial) e não são elegíveis a reembolso. Ao assinar essa modalidade, o serviço é ativado e cobrado imediatamente para o período de 30 dias.

 🗓️ Planos Anuais

Para os planos anuais, oferecemos um período de teste de 7 dias:

 

Até o 7º dia: Você pode cancelar sem qualquer cobrança.

 Após o 7º dia: Se a cobrança já tiver sido processada (a partir do 8º dia), a assinatura permanecerá ativa pelo período contratado e não será elegível a reembolso, conforme detalhado em nossos Termos e Condições.

 

Como gerenciar sua assinatura: Toda a gestão de faturamento é feita por você através do Portal do Cliente (Stripe). Para acessar:
 

Vá em Configurações > Faturamento no seu painel Cloudfy.

 Lá você pode visualizar faturas e gerenciar cancelamentos para evitar renovações.

Nota: Nossa equipe de suporte não realiza cancelamentos ou estornos manualmente; esse controle é exclusivo do usuário via painel para sua maior segurança.$kbtxt$, category = $kbtxt$reembolso$kbtxt$, updated_at = now() where id = 'dbd5e9fb-8422-433a-b6f0-47b3130f519b';
update desk_ai_snippets set title = $kbtxt$Formas de pagamento$kbtxt$, content = $kbtxt$Formas de pagamentos atuais.

Na Cloudfy é possível pagar com cartão de crédito de maneira mensal onde o cartão fica cadastrado para as cobranças.

é possível para com PIX mas apenas para planos anuais no modelo avista.

Planos anuais podem ser parcelados no cartão de crédito.$kbtxt$, category = $kbtxt$Forma de Pagamento$kbtxt$, updated_at = now() where id = 'f7534708-1a45-4fbb-be7e-bdc638f6563e';
update desk_ai_snippets set title = $kbtxt$Como atualizar o n8n?$kbtxt$, content = $kbtxt$Para atualizar seu n8n siga os passos abaixo dentro do console:

Meus serviços > n8n > admin > versões

Dessa maneira você conseguirá atualizar o n8n.$kbtxt$, category = $kbtxt$n8n$kbtxt$, updated_at = now() where id = '13f9c206-7e37-4871-87f3-6591030d73c1';
update desk_ai_snippets set title = $kbtxt$Quedas frequentes do n8n ou n8n ficando offline$kbtxt$, content = $kbtxt$Alguns tipos de quedas que você possa estar percebendo no n8n geralmente estão ligadas a comportamentos internos do próprio fluxo, como loops involuntários, configurações que geram sobrecarga ou execuções simultâneas fora do padrão.
Em cenários assim, é fundamental revisar cada etapa do workflow para identificar se algum nó está sendo acionado repetidamente ou consumindo mais recurso do que deveria.

Recomendamos fortemente uma análise detalhada do fluxo para garantir que não haja looping, triggers mal configurados ou qualquer lógica que possa estar impactando a estabilidade.$kbtxt$, category = $kbtxt$Infraestrutura$kbtxt$, updated_at = now() where id = '52d738a8-4a99-43a1-88c2-da4a32d8e800';
update desk_ai_snippets set title = $kbtxt$Não consigo excluir minha instância do Evolution.$kbtxt$, content = $kbtxt$A instância pode estar vinculada ao WhatsApp no aparelho. Antes de tentar excluí-la pelo painel da Cloudfy, é necessário desconectar o WhatsApp da instância.

No aplicativo do WhatsApp, acesse Configurações > Dispositivos conectados.
Localize a conexão relacionada ao Evolution e faça a desconexão.
Após desconectar, acesse o painel da Cloudfy.
Vá em Meus serviços > Evolution > Instâncias.
Localize a instância e tente excluí-la novamente.

Depois, acesse o painel da Cloudfy em Meus serviços > Evolution > Instâncias, localize a instância e tente realizar a exclusão novamente.

Espero ter ajudado!$kbtxt$, category = $kbtxt$Evolution$kbtxt$, updated_at = now() where id = '34ad879b-8b81-49f1-be50-11de0ce7cc96';
update desk_ai_snippets set title = $kbtxt$Deletar Instancias Evolution$kbtxt$, content = $kbtxt$Não consegue excluir as instancias do Evolution?

Você pode criar e excluir instancias do Evolution pelo painel da Cloudfy:

Meus serviços > Evolution > Instancias$kbtxt$, category = $kbtxt$Evolution$kbtxt$, updated_at = now() where id = 'b47824b5-0f37-4f46-bad5-639c85c6704a';
update desk_ai_snippets set title = $kbtxt$MCP - CLOUDFY$kbtxt$, content = $kbtxt$Todos os clientes tem acesso e podem utilizar MCP da Cloudfy.$kbtxt$, category = $kbtxt$Comuns$kbtxt$, updated_at = now() where id = '53994ae5-95e7-4a78-b432-f50b1ac44f51';
delete from desk_ai_snippets where title = $kbtxt$Como fazer upgrade de plano?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Dá pra trocar o plano anual por mensal?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Paguei a mensalidade atrasada e a infra bloqueou de novo$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Mensagem sai da Evolution mas não chega no WhatsApp$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Onde ficam minhas credenciais de acesso?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Posso alterar variáveis de ambiente, acessar o terminal ou usar Dockerfile?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Limitações do Supabase e do Chatwoot da Cloudfy$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Como falo com o suporte da Cloudfy?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$IA Ilimitada: erro de limite, crédito ou 402$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Como funciona o backup diário?$kbtxt$;
delete from desk_ai_snippets where title = $kbtxt$Hermes e OpenClaw$kbtxt$;
commit;

-- Segunda leva (13/10/2026): artigo "n8n offline" + snippet de adicionais
begin;
update desk_knowledge_base set content = $kbtxt$## O Problema

Você está enfrentando problemas para acessar sua instância do n8n. Isso pode se manifestar de diversas formas:

*   **Erro 502 (Bad Gateway):** O servidor agindo como um gateway ou proxy recebeu uma resposta inválida de um servidor upstream.
*   **Erro 404 (Not Found):** O servidor não conseguiu encontrar o recurso solicitado, indicando que a URL pode estar incorreta ou o serviço não está respondendo.
*   **Instância 'fora do ar' ou 'caiu':** A interface do n8n não carrega, ou os workflows não estão sendo executados/recebendo dados.
*   **Workflows não recebem mensagens:** Seus webhooks estão registrados e ativos, mas os dados não chegam ao n8n.
*   **Aba 'Executions' não abre:** Você não consegue visualizar o histórico de execuções dos seus workflows.

Esses sintomas indicam que sua instância do n8n pode estar inoperante, inacessível ou com problemas de comunicação.

## Por que acontece

A indisponibilidade do n8n pode ser causada por uma variedade de fatores, incluindo:

1.  **Problemas no contêiner/pod do n8n:** O contêiner onde o n8n está rodando pode ter travado, sido encerrado inesperadamente, ou estar com falta de recursos (CPU, memória).
2.  **Problemas de rede ou firewall:** Bloqueios de rede, configurações de firewall incorretas ou problemas no balanceador de carga/proxy reverso podem impedir o acesso ao n8n.
3.  **Configuração incorreta do n8n:** Variáveis de ambiente erradas, problemas de conexão com o banco de dados (se configurado), ou configurações de porta incorretas.
4.  **Recursos insuficientes no servidor:** O servidor onde o n8n está hospedado pode estar sobrecarregado, sem memória ou CPU disponível, causando a falha do serviço.
5.  **Atualização falha:** Uma atualização recente do n8n pode ter introduzido um problema ou não foi concluída corretamente.
6.  **Problemas no serviço de proxy reverso (nginx, Caddy, etc.):** Se você usa um proxy reverso na frente do n8n, ele pode estar com problemas e não conseguindo encaminhar as requisições corretamente (comum em erros 502).
7.  **Domínio/DNS:** Problemas na resolução de DNS ou no apontamento do domínio para o IP correto do servidor.

## Solução passo a passo

Siga os passos abaixo para diagnosticar e resolver o problema da sua instância n8n offline:

1.  **Verifique o status do serviço/contêiner do n8n:**
    *   **Para Docker/Docker Compose:**
        ```bash
        docker ps -a | grep n8n
        docker logs <container_id_ou_nome_do_n8n>
        ```
        Verifique se o contêiner está `Up` e procure por erros nos logs.
    *   **Para Kubernetes (pods):**
        ```bash
        kubectl get pods -n <namespace_do_n8n> | grep n8n
        kubectl describe pod <nome_do_pod_n8n> -n <namespace_do_n8n>
        kubectl logs <nome_do_pod_n8n> -n <namespace_do_n8n>
        ```
        Verifique o `STATUS` do pod (deve ser `Running`) e procure por eventos ou erros nos logs.

2.  **Reinicie o serviço/contêiner do n8n:**
    *   **Para Docker/Docker Compose:**
        ```bash
        docker restart <container_id_ou_nome_do_n8n>
        ```
    *   **Para Kubernetes (reinício forçado do pod):**
        ```bash
        kubectl delete pod <nome_do_pod_n8n> -n <namespace_do_n8n>
        ```
        Isso forçará o Kubernetes a criar um novo pod, o que pode resolver problemas temporários.

3.  **Verifique a utilização de recursos do servidor:**
    *   Use comandos como `top`, `htop`, `free -h` ou `df -h` para verificar o uso de CPU, memória e espaço em disco no servidor onde o n8n está hospedado. Recursos esgotados podem causar a falha do n8n.

4.  **Verifique as configurações de rede e firewall:**
    *   Certifique-se de que a porta em que o n8n está escutando (geralmente 5678) está acessível e não está bloqueada por um firewall (tanto no servidor quanto em qualquer firewall de rede externo).
    *   Se você usa um proxy reverso (Nginx, Caddy), verifique os logs do proxy para ver se há erros de comunicação com o n8n. Certifique-se de que a configuração do proxy está correta e apontando para a porta e IP certos do n8n.

5.  **Teste a conectividade interna:**
    *   Se você tem acesso ao servidor, tente acessar o n8n localmente (ex: `curl http://localhost:5678`). Se funcionar localmente, mas não externamente, o problema é de rede ou proxy.

6.  **Verifique as variáveis de ambiente do n8n:**
    *   Confirme se todas as variáveis de ambiente essenciais (como `N8N_HOST`, `N8N_PORT`, `DB_TYPE`, `DB_POSTGRES_HOST`, etc.) estão configuradas corretamente.

7.  **Consulte a documentação oficial do n8n:**
    *   A documentação pode ter informações específicas para sua forma de instalação (Docker, Kubernetes, etc.) e dicas de troubleshooting.

## Como evitar

Para minimizar a ocorrência de problemas de indisponibilidade do n8n, considere as seguintes práticas:

*   **Monitoramento:** Implemente um sistema de monitoramento para sua instância n8n e para os recursos do servidor (CPU, memória, disco). Configure alertas para quando o serviço ficar inacessível ou os recursos atingirem limites críticos.
*   **Recursos adequados:** Aloque recursos de CPU e memória suficientes para o contêiner/pod do n8n, especialmente se você tiver muitos workflows ou workflows complexos.
*   **Backups regulares:** Faça backups regulares da sua base de dados do n8n e dos seus workflows. Isso permite uma recuperação rápida em caso de falha catastrófica.
*   **Atualizações controladas:** Ao atualizar o n8n, faça-o em um ambiente de teste primeiro, se possível, e sempre siga as instruções de atualização cuidadosamente. Considere usar tags de versão específicas em vez de `latest` para evitar atualizações automáticas que possam quebrar a compatibilidade.
*   **Logs centralizados:** Configure o n8n para enviar logs para um sistema de log centralizado (ELK Stack, Grafana Loki, etc.) para facilitar a depuração de problemas.
*   **Redundância:** Para ambientes de produção críticos, considere configurar o n8n com alta disponibilidade (se sua arquitetura permitir) para evitar um único ponto de falha.
*   **Revisão de configurações:** Periodicamente, revise as configurações do n8n, do proxy reverso e do firewall para garantir que estão otimizadas e corretas.$kbtxt$, updated_at = now() where id = '5c8adc2c-7f23-4235-b919-8cc043d7f7ac';
delete from desk_ai_snippets where title = $kbtxt$Como cancelar só o número virtual ou outro adicional?$kbtxt$;
commit;

-- Terceira leva (13/10/2026): número virtual passa a ser cancelado pelo próprio cliente
begin;
update desk_ai_snippets set content = $kbtxt$Cancelar só um adicional (número virtual, IA Ilimitada, backup) sem mexer na sua infraestrutura é feito pela equipe de suporte — pelo painel você só consegue cancelar o plano inteiro.

É só pedir por aqui informando qual adicional (e, se for número, qual número).

Dica: número já aquecido vale ouro. Se for usar com outro cliente depois, pode valer a pena manter.$kbtxt$, updated_at = now() where id = 'b69d058e-6fef-49a3-be3b-dcdd82425b4a';
commit;
