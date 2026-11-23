# Runs every security check that works on a Windows developer machine without Docker,
# then the Docker-based checks if Docker Desktop is running. Output goes to security/reports/raw/.
#   powershell -ExecutionPolicy Bypass -File security\scripts\run-all-local.ps1
$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\..\.."
$out = Join-Path $root "security\reports\raw"
New-Item -ItemType Directory -Force $out | Out-Null
$py = Join-Path $root "apps\api\.venv\Scripts"

Write-Host "== Phase 1 SAST: Bandit =="
& "$py\bandit.exe" -r "$root\apps\api\app" -q -f json -o "$out\bandit.json"
& "$py\bandit.exe" -r "$root\apps\api\app" -q -lll

Write-Host "== Phase 1 SAST: Ruff security rules =="
& "$py\ruff.exe" check "$root\apps\api\app" --select S,B,E9,F --ignore S101,B008,B904

Write-Host "== Phase 1 SAST: TypeScript strict typecheck =="
Push-Location $root; npm --workspace apps/web run typecheck; Pop-Location
Push-Location "$root\apps\mobile"; npx tsc --noEmit; Pop-Location

Write-Host "== Phase 2 SCA: pip-audit =="
& "$py\pip-audit.exe" -r "$root\apps\api\requirements.txt" --format json -o "$out\pip-audit.json"
& "$py\pip-audit.exe" -r "$root\apps\api\requirements.txt"

Write-Host "== Phase 2 SCA: npm audit =="
Push-Location $root; npm audit --omit=dev; Pop-Location
Push-Location "$root\apps\mobile"; npm audit --omit=dev; Pop-Location

Write-Host "== Phases 4 & 7: API attack tests and AI-input tests (pytest) =="
Push-Location "$root\apps\api"; & "$py\python.exe" -m pytest -q -p no:warnings; Pop-Location

docker info *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "== Docker available: Semgrep, Gitleaks, Trivy =="
  docker run --rm -v "${root}:/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/python --config p/typescript --config p/secrets --json -o /src/security/reports/raw/semgrep.json /src
  docker run --rm -v "${root}:/repo" zricethezav/gitleaks:latest detect --source /repo --no-git --report-path /repo/security/reports/raw/gitleaks.json
  docker run --rm -v "${root}:/src" aquasec/trivy:latest fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL /src
} else {
  Write-Host "Docker is not running: skipped Semgrep, Gitleaks and Trivy (they run in CI)."
}
