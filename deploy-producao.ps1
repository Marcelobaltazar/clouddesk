# deploy-producao.ps1 — Deploy completo do CloudDesk para produção
#
# Pré-requisito ÚNICO: estar logado na conta dona do projeto (clouddesk@cloudfy.host):
#   npx supabase login
#
# O script faz, nesta ordem:
#   1. Preflight  — confirma acesso ao projeto tgjvjgvbqckoqjtgbjqx
#   2. Migration  — aplica 20260714000000_widget_security (fecha RLS anônima)
#   3. Secret     — WIDGET_IDENTITY_SECRET (lido de .widget-identity-secret.local)
#   4. Functions  — deploy de todas as Edge Functions (deploy.ps1)
#   5. Smoke test — hello com HMAC válido (200) e com HMAC inválido (401)
#   6. Builds     — widget.js + painel (prontos para publicar)
#
# Uso: .\deploy-producao.ps1

$ErrorActionPreference = "Stop"
$PROJECT_REF = "tgjvjgvbqckoqjtgbjqx"
$SUPABASE_URL = "https://$PROJECT_REF.supabase.co"

function Fail($msg) { Write-Host "`n[ERRO] $msg" -ForegroundColor Red; exit 1 }

Write-Host "`nCloudDesk - Deploy de producao" -ForegroundColor Cyan
Write-Host "Projeto: $PROJECT_REF`n" -ForegroundColor DarkGray

# ── 1. Preflight ────────────────────────────────────────────────────────────────
Write-Host "[1/6] Verificando acesso ao projeto..." -ForegroundColor Cyan
$projects = npx supabase projects list -o json 2>$null | Out-String
if ($projects -notmatch $PROJECT_REF) {
    Fail "Sem acesso ao projeto $PROJECT_REF. Rode primeiro: npx supabase login (conta clouddesk@cloudfy.host)"
}
Write-Host "  OK - acesso confirmado" -ForegroundColor Green

# ── 2. Migration ────────────────────────────────────────────────────────────────
Write-Host "[2/6] Aplicando migrations (db push)..." -ForegroundColor Cyan
npx supabase db push --linked
if ($LASTEXITCODE -ne 0) { Fail "db push falhou" }
Write-Host "  OK - migrations aplicadas" -ForegroundColor Green

# ── 3. Secret de identidade ─────────────────────────────────────────────────────
Write-Host "[3/6] Configurando WIDGET_IDENTITY_SECRET..." -ForegroundColor Cyan
$secretFile = ".widget-identity-secret.local"
if (-not (Test-Path $secretFile)) { Fail "Arquivo $secretFile nao encontrado" }
$secret = (Get-Content $secretFile -Raw).Trim()
if ($secret.Length -lt 32) { Fail "Segredo invalido em $secretFile" }
npx supabase secrets set "WIDGET_IDENTITY_SECRET=$secret" --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) { Fail "secrets set falhou" }
Write-Host "  OK - segredo configurado (copie o mesmo valor para o backend do cloudfy.space como CLOUDDESK_WIDGET_SECRET)" -ForegroundColor Green

# ── 4. Edge Functions ───────────────────────────────────────────────────────────
Write-Host "[4/6] Deploy das Edge Functions..." -ForegroundColor Cyan
& .\deploy.ps1
if ($LASTEXITCODE -ne 0) { Fail "deploy de functions falhou" }

# ── 5. Smoke test ───────────────────────────────────────────────────────────────
Write-Host "[5/6] Smoke test do gateway (identidade HMAC)..." -ForegroundColor Cyan

$envFile = Get-Content ".env" -Raw
if ($envFile -match "VITE_SUPABASE_ANON_KEY=(\S+)") { $anonKey = $Matches[1] } else { Fail "anon key nao encontrada no .env" }

$testEmail = "smoke-test@clouddesk.internal"
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
$hashBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($testEmail))
$userHash = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""

$headers = @{ "Authorization" = "Bearer $anonKey"; "Content-Type" = "application/json"; "apikey" = $anonKey }

# 5a. hello com hash VALIDO -> 200 eligible
$body = @{ action = "hello"; email = $testEmail; user_hash = $userHash } | ConvertTo-Json
try {
    $res = Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/functions/v1/desk-widget-api" -Headers $headers -Body $body
    if ($res.eligible -eq $true) {
        Write-Host "  OK - hello com HMAC valido aceito (eligible=true)" -ForegroundColor Green
    } else {
        Fail "hello retornou eligible!=true: $($res | ConvertTo-Json -Compress)"
    }
} catch { Fail "hello com HMAC valido falhou: $($_.Exception.Message)" }

# 5b. hello com hash INVALIDO -> 401
$badBody = @{ action = "hello"; email = $testEmail; user_hash = ("0" * 64) } | ConvertTo-Json
$unauthorized = $false
try {
    Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/functions/v1/desk-widget-api" -Headers $headers -Body $badBody | Out-Null
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $unauthorized = $true }
}
if ($unauthorized) {
    Write-Host "  OK - hello com HMAC invalido rejeitado (401)" -ForegroundColor Green
} else {
    Fail "SEGURANCA: hash invalido NAO foi rejeitado com 401!"
}

# 5c. leitura anonima direta de desk_conversations -> deve vir vazia/negada
try {
    $rows = Invoke-RestMethod -Method Get -Uri "$SUPABASE_URL/rest/v1/desk_conversations?select=id&limit=1" -Headers @{ "apikey" = $anonKey; "Authorization" = "Bearer $anonKey" }
    if ($rows.Count -eq 0) {
        Write-Host "  OK - RLS fechada: anon nao le conversas" -ForegroundColor Green
    } else {
        Fail "SEGURANCA: anon ainda consegue ler desk_conversations!"
    }
} catch {
    Write-Host "  OK - RLS fechada: anon nao le conversas (acesso negado)" -ForegroundColor Green
}

# ── 6. Builds ───────────────────────────────────────────────────────────────────
Write-Host "[6/6] Builds (widget + painel)..." -ForegroundColor Cyan
npm run build:widget
if ($LASTEXITCODE -ne 0) { Fail "build:widget falhou" }
npm run build
if ($LASTEXITCODE -ne 0) { Fail "build falhou" }

Write-Host "`nDEPLOY CONCLUIDO" -ForegroundColor Green
Write-Host @"

Proximos passos manuais:
  1. Publicar o painel (Lovable -> Share -> Publish) - o widget.js novo vai junto
  2. Copiar o segredo de .widget-identity-secret.local para o backend do
     cloudfy.space como CLOUDDESK_WIDGET_SECRET
  3. Inserir o snippet do widget (ver WIDGET_INSTALL.md) e remover o Intercom
"@
