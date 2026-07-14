# CloudDesk — Código de Embed (produção)

Cole isto **apenas nas páginas autenticadas** do cloudfy.space, **depois do login**.
Substitua os `{{ ... }}` pelos valores reais do seu template e calcule o `hash`
**no servidor** (nunca no navegador).

```html
<!-- ================= CloudDesk Widget ================= -->
<script>
  window.CloudfyUser = {
    id:    "{{ user.supabase_id }}",   // UUID do Supabase Auth do cliente
    email: "{{ user.email }}",          // e-mail do cliente
    name:  "{{ user.name }}",           // nome completo
    hash:  "{{ clouddesk_user_hash }}"  // HMAC-SHA256 calculado no servidor (ver abaixo)
  };
</script>
<script src="https://clouddesk.apps.cloudfy.cloud/widget.js" defer></script>
<!-- =================================================== -->
```

O widget só renderiza para quem tem `id`, `email` e um `hash` válido. Em páginas
públicas (landing, `/login`, `/signup`) **não inclua** este bloco.

---

## Como calcular o `hash` (server-side, obrigatório)

```
hash = HMAC_SHA256( CLOUDDESK_WIDGET_SECRET, lowercase(trim(email)) )   // saída em hex
```

O `CLOUDDESK_WIDGET_SECRET` é o mesmo valor guardado no Supabase do CloudDesk
como `WIDGET_IDENTITY_SECRET`. **Nunca exponha esse segredo no frontend.**

### Node.js / Next.js (API route ou getServerSideProps)
```js
import crypto from "crypto";

const clouddeskUserHash = crypto
  .createHmac("sha256", process.env.CLOUDDESK_WIDGET_SECRET)
  .update(user.email.trim().toLowerCase())
  .digest("hex");
```

### PHP (Laravel / puro)
```php
$clouddeskUserHash = hash_hmac(
    'sha256',
    strtolower(trim($user->email)),
    env('CLOUDDESK_WIDGET_SECRET')
);
```

### Python (Django / Flask)
```python
import hashlib, hmac, os

clouddesk_user_hash = hmac.new(
    os.environ["CLOUDDESK_WIDGET_SECRET"].encode(),
    user.email.strip().lower().encode(),
    hashlib.sha256,
).hexdigest()
```

### Ruby (Rails)
```ruby
clouddesk_user_hash = OpenSSL::HMAC.hexdigest(
  "SHA256",
  ENV["CLOUDDESK_WIDGET_SECRET"],
  user.email.strip.downcase
)
```

---

## Removendo o Intercom

Nas páginas autenticadas, **remova** o snippet do Intercom:

```html
<!-- REMOVER: -->
<script>
  window.intercomSettings = { app_id: "xxxxxxx", ... };
  (function(){ /* loader do widget.intercom.io */ })();
</script>
```

E qualquer chamada no código do app:
```js
Intercom('boot', ...);      // remover
Intercom('update', ...);    // remover
Intercom('shutdown');       // remover
window.Intercom(...);       // remover
```

Depois de remover, insira o snippet do CloudDesk acima. O CloudDesk passa a ser
o único widget na área logada.

---

## Checklist final antes de ir ao ar

- [ ] `WIDGET_IDENTITY_SECRET` configurado no Supabase do CloudDesk (feito no deploy)
- [ ] `CLOUDDESK_WIDGET_SECRET` (mesmo valor) no backend do cloudfy.space
- [ ] `hash` calculado no servidor e injetado em `window.CloudfyUser.hash`
- [ ] Snippet do CloudDesk só em páginas autenticadas
- [ ] Intercom removido das mesmas páginas
- [ ] widget.js publicado em `https://clouddesk.apps.cloudfy.cloud/widget.js`
      (sai no build/publish do painel)

---

## Como validar rápido (DevTools do cliente)

1. Abra uma página autenticada → DevTools → Console:
   `window.CloudfyUser` deve ter `id`, `email`, `name` e `hash` (64 chars hex).
2. Network → filtre `desk-widget-api` → a ação `hello` deve responder
   `{ "eligible": true }`. Se responder `401`, o `hash` não bate com o e-mail
   (confira lowercase/trim e se é o mesmo segredo dos dois lados).
3. A bolha 💬 aparece no canto inferior direito.
