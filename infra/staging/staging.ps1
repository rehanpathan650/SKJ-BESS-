# Local staging environment on Docker Desktop.
#   powershell -ExecutionPolicy Bypass -File infra\staging\staging.ps1 up       # create/start
#   powershell -ExecutionPolicy Bypass -File infra\staging\staging.ps1 status
#   powershell -ExecutionPolicy Bypass -File infra\staging\staging.ps1 logs
#   powershell -ExecutionPolicy Bypass -File infra\staging\staging.ps1 down     # stop (data kept)
#   powershell -ExecutionPolicy Bypass -File infra\staging\staging.ps1 destroy  # stop and DELETE all staging data
param([ValidateSet("up", "down", "status", "logs", "destroy")][string]$Action = "up")
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root
$envFile = Join-Path $root ".env.staging"
$accounts = Join-Path $root ".staging-accounts.txt"
$compose = @("compose", "-p", "skj-staging", "--env-file", $envFile, "-f", "docker-compose.yml", "-f", "docker-compose.staging.yml")
$utf8 = New-Object System.Text.UTF8Encoding $false

function Rand([int]$n = 36) {
  $bytes = New-Object byte[] $n
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '').Substring(0, [Math]::Min(40, $n))
}
function FernetKey {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
}
function Dc { & docker @compose @args; if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed" } }

switch ($Action) {
  "status" { & docker @compose ps; exit }
  "logs" { & docker @compose logs --tail 100; exit }
  "down" { & docker @compose down; exit }
  "destroy" { & docker @compose down -v; Remove-Item $envFile, $accounts -ErrorAction SilentlyContinue; exit }
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running. Start it and try again." }

if (-not (Test-Path $envFile)) {
  Write-Host "Generating staging secrets in .env.staging"
  $lines = @(
    "ENVIRONMENT=staging", "APP_DOMAIN=localhost", "ALLOWED_EMAIL_DOMAINS=skjenergy.com",
    "JWT_SECRET=$(Rand 48)", "DATA_ENCRYPTION_KEY=$(FernetKey)",
    "DB_SUPERUSER_PASSWORD=$(Rand)", "DB_OWNER_PASSWORD=$(Rand)", "DB_APP_PASSWORD=$(Rand)",
    "DB_BACKUP_PASSWORD=$(Rand)", "REDIS_PASSWORD=$(Rand)",
    "ANTHROPIC_API_KEY=", "AI_MONTHLY_BUDGET_USD=20", "PUSH_ENABLED=false",
    "SMTP_HOST=mailpit", "SMTP_PORT=1025", "SMTP_USER=", "SMTP_PASSWORD=", "SMTP_FROM=staging@skjenergy.com"
  )
  [IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", $utf8)
}

if (-not (Test-Path "$root\infra\postgres\certs\server.crt")) {
  Write-Host "Creating PostgreSQL TLS certificates"
  docker run --rm -v "${root}\infra\postgres:/w" alpine:3.22 sh -c "apk add -q openssl && sh /w/gen-certs.sh"
  if ($LASTEXITCODE -ne 0) { throw "certificate generation failed" }
}

Write-Host "Building the web app"
npm run web:build | Out-Host
if ($LASTEXITCODE -ne 0) { throw "web build failed" }

Write-Host "Building images and starting services"
Dc up -d --build

Write-Host "Waiting for PostgreSQL"
for ($i = 0; $i -lt 60; $i++) {
  & docker @compose exec -T db pg_isready -U postgres *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}

Write-Host "Running migrations and seeding roles"
Dc run --rm api alembic upgrade head
Dc run --rm api python -m app.cli seed

if (-not (Test-Path $accounts)) {
  $pw = "Stg-$(Rand 24)"
  Dc run --rm api python -m app.cli create-superadmin --email admin@skjenergy.com --name "Staging Admin" --password $pw
  [IO.File]::WriteAllText($accounts, "# Staging accounts (git-ignored)`nadmin@skjenergy.com  $pw  (Super Administrator; MFA set-up required at first login)`n", $utf8)
}

Write-Host ""
Write-Host "Staging is up:"
Write-Host "  App      https://localhost:8443   (accept the local certificate warning once)"
Write-Host "  Emails   http://127.0.0.1:8025    (verification links, approvals)"
Write-Host "  Admin    see .staging-accounts.txt"
