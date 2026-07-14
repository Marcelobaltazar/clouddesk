# deploy.ps1 - Deploya todas as Edge Functions do CloudDesk
# Uso: .\deploy.ps1

$PROJECT_REF = "tgjvjgvbqckoqjtgbjqx"

# IMPORTANTE: manter em sincronia com supabase/functions/*.
# desk-resend-credentials faltava aqui — a versao com validacao de posse ficou
# semanas sem deploy enquanto a versao antiga (sem gate) rodava em producao.
# desk-generate-embedding foi removida: nao existe source no repo (funcao legada
# ainda deployada; scripts/generate-kb-embeddings.ts depende dela).
$functions = @(
    "desk-widget-api",
    "desk-ai-respond",
    "get-contact-info",
    "desk-embed-article",
    "check-widget-eligibility",
    "desk-resend-credentials"
)

Write-Host ""
Write-Host "CloudDesk - Deploy de Edge Functions" -ForegroundColor Cyan
Write-Host "Projeto: $PROJECT_REF" -ForegroundColor DarkGray
Write-Host ""

$ok = 0
$fail = 0

foreach ($fn in $functions) {
    Write-Host "  Deployando $fn..." -NoNewline
    $result = npx supabase functions deploy $fn --project-ref $PROJECT_REF 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " OK" -ForegroundColor Green
        $ok++
    } else {
        Write-Host " FALHOU" -ForegroundColor Red
        Write-Host $result -ForegroundColor DarkRed
        $fail++
    }
}

Write-Host ""
if ($fail -eq 0) {
    Write-Host "$ok OK - tudo deployado" -ForegroundColor Green
} else {
    Write-Host "$ok OK  $fail falhou" -ForegroundColor Yellow
}
Write-Host ""
