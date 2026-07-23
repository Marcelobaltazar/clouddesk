# Canal de E-mail — Setup do Google (Service Account)

O CloudDesk fala **direto com a Gmail API** do Google Workspace da Cloudfy — sem
provedor terceiro. Ele lê a caixa `support@cloudfy.host` e envia as respostas
saindo como `support@cloudfy.email` (alias de envio da mesma conta).

Para isso, uma **Service Account com Domain-Wide Delegation** age em nome do
`support@cloudfy.host`. É uma configuração **única** (~15 min). Depois nunca mais
mexe. Você precisa ser **admin do Google Workspace** (você é).

---

## Passo 1 — Criar a Service Account (Google Cloud Console)

1. Acesse https://console.cloud.google.com → escolha (ou crie) um projeto, ex.: **CloudDesk Email**.
2. Menu → **APIs e serviços → Biblioteca** → procure **Gmail API** → **Ativar**.
3. Menu → **APIs e serviços → Credenciais** → **Criar credenciais → Conta de serviço**.
   - Nome: `clouddesk-gmail`
   - Papel: pode deixar sem papel (a permissão vem da delegação no Workspace).
   - **Concluir**.
4. Abra a Service Account criada → aba **Chaves** → **Adicionar chave → Criar nova chave → JSON**.
   - Baixa um arquivo `.json`. **Guarde com cuidado — é a credencial.**
5. Na aba **Detalhes** da Service Account, copie o **Client ID** (um número longo, ex.: `109876543210987654321`). Você vai usar no Passo 2.

---

## Passo 2 — Autorizar a delegação no Admin Console

1. Acesse https://admin.google.com (como admin).
2. **Segurança → Controle de acesso e dados → Controles de API → Delegação em todo o domínio** (Domain-wide delegation).
   - Caminho alternativo: **Segurança → API controls → Domain-wide delegation**.
3. **Adicionar novo**:
   - **Client ID**: o número que você copiou no Passo 1.5.
   - **Escopos OAuth** (cole exatamente, separados por vírgula):
     ```
     https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/gmail.send
     ```
   - **Autorizar**.

> `gmail.modify` = ler mensagens e marcar como lidas/processadas (não deleta nada).
> `gmail.send` = enviar as respostas.

---

## Passo 3 — Confirmar o alias de envio

O `support@cloudfy.email` já é um "Enviar e-mail como" dentro da conta
`support@cloudfy.host` (você confirmou). Nada a fazer aqui — só garantir que
continua ativo em **Gmail → Configurações → Contas → Enviar e-mail como**.

---

## Passo 4 — Entregar a credencial ao CloudDesk

Do arquivo `.json` que você baixou no Passo 1.4, o CloudDesk precisa de 2 campos:
`client_email` e `private_key`. Eles vão para os Supabase Secrets (nunca no
frontend, nunca no git):

```bash
# Rode na raiz do projeto (troque pelos valores do seu .json):
npx supabase secrets set GMAIL_SA_CLIENT_EMAIL="clouddesk-gmail@seu-projeto.iam.gserviceaccount.com" --project-ref tgjvjgvbqckoqjtgbjqx
npx supabase secrets set GMAIL_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" --project-ref tgjvjgvbqckoqjtgbjqx
npx supabase secrets set GMAIL_INBOX_USER="support@cloudfy.host" --project-ref tgjvjgvbqckoqjtgbjqx
npx supabase secrets set GMAIL_SEND_AS="support@cloudfy.email" --project-ref tgjvjgvbqckoqjtgbjqx
```

> A `private_key` do JSON vem com `\n` literais — cole exatamente como está no
> arquivo. Se preferir, me mande só o `client_email` e eu te ajudo a formatar o
> comando (a private key você mesmo cola, para não passar por mim).

---

## Como testar depois

1. Mande um e-mail de qualquer conta para **support@cloudfy.host**.
2. Em até ~1 min o CloudDesk lê, cria uma conversa (canal **E-mail**) na inbox e
   a Luna responde saindo como **support@cloudfy.email**, na mesma thread.
3. Responda o e-mail da Luna → vira uma nova mensagem na mesma conversa.

---

## Convivência com o Intercom

Isto roda **em paralelo** com o Intercom durante a transição — os dois leem a
mesma caixa. Quando você confiar no CloudDesk, é só remover a regra de
encaminhamento do Intercom no Workspace e desligar o Intercom. Nenhum passo
aqui interfere no Intercom.
