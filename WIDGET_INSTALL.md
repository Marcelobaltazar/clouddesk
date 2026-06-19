# CloudDesk Widget — Guia de Instalação

## Como funciona

O widget aparece para **todos os clientes logados**, em todos os planos (Starter, Advanced, Ultra, Max). A separação por plano acontece dentro do CloudDesk: cada conversa cai automaticamente na view do plano correspondente na inbox. Starter é atendido apenas pela IA; os demais planos têm atendimento humano.

> O Intercom foi descontinuado — o CloudDesk é o único widget na área logada.

---

## O que o dev precisa fazer no cloudfy.space

### 1. Expor o objeto do usuário logado

Inserir no `<head>` ou antes do `</body>`, **depois do login** e **antes do script do widget**:

```html
<script>
  window.CloudfyUser = {
    id:    "{{ user.supabase_id }}",   // UUID do Supabase Auth
    email: "{{ user.email }}",         // Email do usuário
    name:  "{{ user.name }}"           // Nome completo
  };
</script>
```

### 2. Incluir o script do widget

```html
<!-- Antes do </body> -->
<script src="https://clouddesk.cloudfy.live/widget.js" defer></script>
```

---

## O que acontece automaticamente

1. Script carrega → lê `window.CloudfyUser`
2. Se não há usuário logado → para aqui (sem erros, sem efeitos)
3. Chama Edge Function `check-widget-eligibility` com o email
4. Edge Function retorna `eligible: true` para qualquer email logado
   - Sem email → `eligible: false` (não renderiza)
   - Este ponto existe para permitir bloquear usuários no futuro, se preciso
5. Se `eligible: true` → monta o widget React no canto inferior direito

---

## Variáveis de template

Substituir `{{ user.* }}` pelos valores reais do sistema de templates do cloudfy.space.

| Placeholder | Valor |
|---|---|
| `{{ user.supabase_id }}` | UUID do usuário no Supabase Auth |
| `{{ user.email }}` | Email do usuário |
| `{{ user.name }}` | Nome completo |

---

## Importante

- **NÃO incluir** em páginas públicas (landing page, `/login`, `/signup`)
- **Incluir APENAS** em páginas autenticadas (dashboard, infraestrutura, configurações)
- O script é seguro para incluir sempre — só renderiza quando há um usuário logado em `window.CloudfyUser`
- Não polui o namespace global além de `window.CloudDeskWidget` (usado apenas para `destroy()` de emergência)
- **Remover as tags do Intercom** das páginas autenticadas — o CloudDesk passa a ser o único widget

---

## Comandos para deploy

```bash
# 1. Deploy da Edge Function (sem verificação de JWT pois é chamada sem auth)
npx supabase functions deploy check-widget-eligibility --no-verify-jwt

# 2. Build do bundle do widget
npm run build:widget
# Gera: dist-widget/widget.js

# 3. Fazer upload do widget.js para o CDN/servidor de assets
# Deve ficar acessível em: https://clouddesk.cloudfy.live/widget.js
```

---

## Secrets necessários na Edge Function

A `check-widget-eligibility` **não precisa mais de secrets** — não consulta mais o Airtable.

Os dados de cliente/plano usados dentro do widget vêm da `get-contact-info`, que lê o Supabase de produção da Cloudfy e exige:

```
CLOUDFY_SUPABASE_URL              = https://xxxx.supabase.co
CLOUDFY_SUPABASE_SERVICE_ROLE_KEY = eyJxxxx
```

---

## Troubleshooting

**Widget não aparece para o cliente:**
- Verificar se `window.CloudfyUser` está definido (com `id` e `email`) antes do script carregar
- Abrir DevTools → Network → filtrar por `check-widget-eligibility` — deve retornar `{ eligible: true }`
- Confirmar que o `id` enviado é o UUID do Supabase Auth (não o ID interno do cloudfy.space)

**Dados do cliente/plano não carregam:**
- Verificar os secrets `CLOUDFY_SUPABASE_*` na função `get-contact-info`
- Filtrar por `get-contact-info` no Network para ver a resposta

**Erro de CORS:**
- A Edge Function já tem `Access-Control-Allow-Origin: *` — verificar se a URL da função está correta no `.env`
