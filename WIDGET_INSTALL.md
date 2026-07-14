# CloudDesk Widget — Guia de Instalação (produção)

## Como funciona

O widget aparece para **todos os clientes logados**, em todos os planos (Starter, Advanced, Ultra, Max). A separação por plano acontece dentro do CloudDesk (tags automáticas por plano na inbox). Starter é atendido apenas pela IA; os demais planos têm atendimento humano.

> O Intercom foi descontinuado — o CloudDesk é o único widget na área logada.

**Arquitetura de segurança (v2):** o widget não acessa nenhuma tabela do banco diretamente. Toda operação passa pela Edge Function `desk-widget-api`, que verifica a identidade do cliente com **HMAC** (estilo Intercom Identity Verification), aplica **rate limiting** por e-mail e executa todas as escritas server-side. Sem um `hash` válido, o widget não renderiza e nenhuma ação é aceita.

---

## O que o dev precisa fazer no cloudfy.space

### 1. Guardar o segredo no backend

Adicionar ao ambiente do **backend** do cloudfy.space (NUNCA no frontend):

```
CLOUDDESK_WIDGET_SECRET=<valor em .widget-identity-secret.local / Supabase Secrets>
```

> O mesmo valor precisa estar no Supabase do CloudDesk como secret `WIDGET_IDENTITY_SECRET`
> (`npx supabase secrets set WIDGET_IDENTITY_SECRET=... --project-ref tgjvjgvbqckoqjtgbjqx`).

### 2. Calcular o hash do usuário (server-side)

No render da página autenticada, calcular:

```
user_hash = HMAC_SHA256( CLOUDDESK_WIDGET_SECRET, lowercase(email_do_usuario) )   // hex
```

Exemplos:

**Node.js**
```js
const crypto = require("crypto");
const userHash = crypto
  .createHmac("sha256", process.env.CLOUDDESK_WIDGET_SECRET)
  .update(user.email.trim().toLowerCase())
  .digest("hex");
```

**PHP**
```php
$userHash = hash_hmac('sha256', strtolower(trim($user->email)), getenv('CLOUDDESK_WIDGET_SECRET'));
```

**Python**
```python
import hashlib, hmac, os
user_hash = hmac.new(
    os.environ["CLOUDDESK_WIDGET_SECRET"].encode(),
    user.email.strip().lower().encode(),
    hashlib.sha256,
).hexdigest()
```

### 3. Expor o objeto do usuário logado + script

Inserir **apenas em páginas autenticadas**, depois do login e antes do script do widget:

```html
<script>
  window.CloudfyUser = {
    id:    "{{ user.supabase_id }}",   // UUID do Supabase Auth (produção Cloudfy)
    email: "{{ user.email }}",         // E-mail do usuário
    name:  "{{ user.name }}",          // Nome completo
    hash:  "{{ user_hash }}"           // HMAC calculado no passo 2 (server-side)
  };
</script>
<script src="https://clouddesk.apps.cloudfy.cloud/widget.js" defer></script>
```

---

## O que acontece automaticamente

1. Script carrega → lê `window.CloudfyUser`
2. Sem usuário logado → para aqui (sem erros, sem efeitos)
3. Chama `desk-widget-api` (ação `hello`) — verifica o `hash` HMAC
4. Hash inválido/ausente → widget **não renderiza** (log de warning no console)
5. Hash válido → monta a bolha no canto inferior direito
6. Ao abrir: `bootstrap` retoma a conversa aberta (com histórico) ou mostra a
   saudação personalizada com as assinaturas do cliente
7. A conversa só é **criada** quando o cliente envia a primeira mensagem
   (nada de conversas vazias na inbox)

---

## Garantias de segurança (o que o backend impõe)

| Garantia | Mecanismo |
|---|---|
| Ninguém lê conversas de outros clientes | RLS anônima removida; leitura só via gateway com HMAC + validação de posse |
| Ninguém cria conversa/mensagem em nome de outro e-mail | HMAC obrigatório; escrita 100% server-side |
| E-mail de credenciais só sai com clique do CLIENTE | Botão → gateway valida posse da infra + status DEPLOYED antes de disparar; a IA nunca dispara e afirmações falsas de envio são corrigidas server-side |
| Ticket não fecha sem estar resolvido | Auto-resolve exige confirmação textual do cliente + ≥2 turnos + sem ações pendentes; CSAT 😞 **reabre** a conversa para humano |
| Transferência para humano quando necessário | Decidida pela IA e persistida server-side; Starter nunca transfere (autoatendimento) |
| Prompt injection | Sanitização de marcadores de controle/cabeçalhos internos/caracteres invisíveis em toda mensagem; regras de segurança no system prompt; ações críticas nunca dependem só do modelo |
| Abuso / custo de LLM | Rate limiting por e-mail (10 msg/min, 40/h, 200/dia; 6 conversas novas/h; 3 reenvios de credencial/h) |

---

## Comandos para deploy

```powershell
# 0. Login com a conta dona do projeto (clouddesk@cloudfy.host)
npx supabase login

# 1. Aplicar a migration de segurança (RLS + rate limiting)
npx supabase db push --linked

# 2. Configurar o segredo de identidade (uma vez)
npx supabase secrets set WIDGET_IDENTITY_SECRET=<segredo> --project-ref tgjvjgvbqckoqjtgbjqx

# 3. Deploy de todas as Edge Functions
.\deploy.ps1

# 4. Build do painel + widget (public/widget.js entra no build do app)
npm run build:widget
npm run build

# 5. Publicar o app (Lovable → Share → Publish, ou o pipeline atual)
#    O widget fica em: https://clouddesk.apps.cloudfy.cloud/widget.js
```

> **Ordem importa:** faça o deploy das functions ANTES de publicar o widget.js
> novo. A migration remove o acesso anônimo — o widget antigo para de funcionar
> no momento do `db push` (ok se o Intercom ainda estiver no ar).

---

## Removendo o Intercom

1. Remover o snippet do Intercom (`window.intercomSettings` + script `widget.intercom.io`) de **todas** as páginas
2. Remover chamadas `Intercom('boot' | 'update' | 'shutdown')` no código do app
3. Inserir o snippet do CloudDesk (seção acima) nas páginas autenticadas
4. **NÃO incluir** em páginas públicas (landing, `/login`, `/signup`)

---

## Troubleshooting

**Widget não aparece:**
- `window.CloudfyUser` definido (com `id`, `email` e `hash`) antes do script?
- DevTools → Network → `desk-widget-api` → resposta da ação `hello`:
  - `401 Identidade não verificada` → o `hash` não bate com o e-mail. Confira se o backend usa o e-mail **lowercase/trim** e o mesmo segredo.
  - `500 Verificação de identidade não configurada` → falta `WIDGET_IDENTITY_SECRET` nos Supabase Secrets.

**"Muitas mensagens em pouco tempo":**
- Rate limit atingido (proteção de custo). Janelas: 10/min, 40/h, 200/dia por e-mail.

**Mensagens do operador não chegam no widget:**
- O widget escuta o canal Realtime `conv-live:{conversation_id}` (broadcast). O painel publica automaticamente. Ao focar a aba, o widget também re-sincroniza via API.

**Preview no painel:**
- `/widget-preview` exige **operador logado** (a identidade do preview é a sessão do operador — sem HMAC).
