# Docker-based security scans against local staging. Reports: security/reports/raw/
#   powershell -ExecutionPolicy Bypass -File infra\staging\scan.ps1
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root
$out = "$root\security\reports\raw"
New-Item -ItemType Directory -Force $out | Out-Null
$compose = @("compose", "-p", "skj-staging", "--env-file", ".env.staging", "-f", "docker-compose.yml", "-f", "docker-compose.staging.yml")
$py = "$root\apps\api\.venv\Scripts\python.exe"
$envs = @{}; Get-Content .env.staging | Where-Object { $_ -match '^([A-Z_]+)=(.*)$' } | ForEach-Object { $envs[$Matches[1]] = $Matches[2] }
$scanPw = ((Get-Content .staging-accounts.txt | Select-String "scanner@") -split '\s+')[1]

Write-Host "== Unlock scanner account (lockout tests may have locked it) =="
& docker @compose exec -T -e PGPASSWORD=$($envs.DB_OWNER_PASSWORD) -e PGSSLMODE=require db psql -h db -U skj_owner -d skj -qc `
  "update users set locked_until = null, failed_logins = 0 where email = 'scanner@skjenergy.com'" | Out-Null

Write-Host "== OpenAPI spec for ZAP (docs are disabled on staging, so generate it from code) =="
$gen = @'
import json, os, sys
os.environ.update(ENVIRONMENT="test", DATABASE_URL="sqlite://", STORAGE_DIR=os.environ.get("TEMP", "/tmp") + "/skj-openapi")
sys.path.insert(0, "apps/api")
from app.main import app
spec = app.openapi()
spec["servers"] = [{"url": "https://proxy"}]
json.dump(spec, open(sys.argv[1], "w"))
'@
$gen | & $py - "$out\openapi.json"

Write-Host "== ZAP API scan (authenticated as a Sales Executive) =="
$token = & $py security\scripts\staging_probe.py token scanner@skjenergy.com $scanPw
$auth = "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true " +
  "-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization " +
  "-config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ $token"
docker run --rm --network skj-staging_edge -v "${out}:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable `
  zap-api-scan.py -t /zap/wrk/openapi.json -f openapi -O https://proxy -r zap-api.html -J zap-api.json -z $auth -I
Write-Host "== ZAP baseline scan of the web app =="
docker run --rm --network skj-staging_edge -v "${out}:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable `
  zap-baseline.py -t https://proxy -r zap-baseline.html -J zap-baseline.json -I

Write-Host "== Trivy: API container image =="
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v "${out}:/out" aquasec/trivy:latest image `
  --scanners vuln,secret --severity HIGH,CRITICAL --format json -o /out/trivy-image.json skj-staging-api
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --scanners vuln --severity HIGH,CRITICAL --quiet skj-staging-api
Write-Host "== Trivy: configuration (Dockerfile, compose) =="
docker run --rm -v "${root}:/src:ro" -v "${out}:/out" aquasec/trivy:latest config --severity HIGH,CRITICAL --format json -o /out/trivy-config.json /src
docker run --rm -v "${root}:/src:ro" aquasec/trivy:latest config --severity HIGH,CRITICAL --quiet /src

Write-Host "== Semgrep (OWASP Top 10, Python, TypeScript, secrets) =="
docker run --rm -v "${root}:/src" -w /src semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/python `
  --config p/typescript --config p/secrets --exclude node_modules --exclude .venv --exclude dist --exclude security/reports `
  --json -o security/reports/raw/semgrep.json --quiet
Write-Host "== Gitleaks (secrets in files) =="
docker run --rm -v "${root}:/repo" zricethezav/gitleaks:latest dir /repo --report-path /repo/security/reports/raw/gitleaks.json `
  --report-format json --no-banner
Write-Host "Scans finished."
