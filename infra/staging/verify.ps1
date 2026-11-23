# Infrastructure checks against the running staging stack (Phase 6 + PostgreSQL controls).
#   powershell -ExecutionPolicy Bypass -File infra\staging\verify.ps1
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root
$compose = @("compose", "-p", "skj-staging", "--env-file", ".env.staging", "-f", "docker-compose.yml", "-f", "docker-compose.staging.yml")
$envs = @{}
Get-Content .env.staging | Where-Object { $_ -match '^([A-Z_]+)=(.*)$' } | ForEach-Object { $envs[$Matches[1]] = $Matches[2] }
$results = New-Object System.Collections.Generic.List[object]
function Check($name, [bool]$ok, $detail = "") {
  $results.Add([pscustomobject]@{ Check = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail })
}
function Psql($user, $pass, $sql, $ssl = "require") {
  $out = & docker @compose exec -T -e PGPASSWORD=$pass -e PGSSLMODE=$ssl db psql -h db -U $user -d skj -v ON_ERROR_STOP=1 -tAc $sql 2>&1
  return @{ code = $LASTEXITCODE; out = ($out | Out-String).Trim() }
}

# --- Network exposure ---
$published = & docker @compose ps --format "{{.Service}} {{.Publishers}}"
$exposed = $published | Where-Object { $_ -match "0\.0\.0\.0|\[::\]" }
Check "No service published on all interfaces" (-not $exposed) ($exposed -join "; ")
foreach ($port in 5432, 6379, 3310, 8000) {
  $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $proc = if ($owner) { (Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue).ProcessName } else { "" }
  # Only Docker's port forwarders count; a local dev server (e.g. the VS Code API task) is not staging.
  $docker = $proc -match "docker|wslrelay|vpnkit"
  Check "Staging port $port not published to host" (-not $docker) $(if ($owner -and -not $docker) { "in use by local $proc (not staging)" } else { "" })
}
$egress = & docker @compose exec -T redis sh -c "nc -z -w 3 1.1.1.1 443 && echo OPEN || echo BLOCKED" 2>&1
Check "Internal network has no internet egress (redis)" ("$egress" -match "BLOCKED") "$egress"

# --- PostgreSQL ---
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "select 1" "disable"
Check "Non-TLS DB connection refused" ($r.code -ne 0) $r.out
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "select ssl, version from pg_stat_ssl where pid = pg_backend_pid()"
Check "App DB connection uses TLS 1.2+" ($r.out -match "^t\|TLSv1\.[23]") $r.out
$r = Psql "skj_app" "wrong-password" "select 1"
Check "Wrong DB password rejected" ($r.code -ne 0)
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "update audit_log set action = 'tampered' where id = (select min(id) from audit_log)"
Check "App role cannot UPDATE audit_log" ($r.code -ne 0) $r.out
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "delete from audit_log"
Check "App role cannot DELETE audit_log" ($r.code -ne 0) $r.out
$r = Psql "skj_owner" $envs.DB_OWNER_PASSWORD "delete from audit_log"
Check "Even schema owner cannot DELETE audit_log (trigger)" ($r.code -ne 0) $r.out
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "create table hack(x int)"
Check "App role cannot create tables (no DDL)" ($r.code -ne 0) $r.out
$r = Psql "skj_backup" $envs.DB_BACKUP_PASSWORD "insert into departments(id, name) values ('x','x')"
Check "Backup role is read-only" ($r.code -ne 0) $r.out
$r = Psql "skj_app" $envs.DB_APP_PASSWORD "select count(*) from users"
Check "App role can read its tables" ($r.code -eq 0) $r.out

# --- Containers ---
foreach ($svc in "api", "worker") {
  $u = & docker @compose exec -T $svc id -u 2>&1
  Check "$svc runs as non-root" ("$u".Trim() -ne "0") "uid=$u"
  $w = & docker @compose exec -T $svc sh -c "touch /app/x 2>&1 || echo READONLY" 2>&1
  Check "$svc root filesystem read-only" ("$w" -match "READONLY|Read-only") "$w"
}

# --- HTTPS edge ---
$h = curl.exe -sk -D - -o NUL https://localhost:8443/ 2>&1 | Out-String
Check "HSTS header on web app" ($h -match "Strict-Transport-Security") ""
Check "CSP header on web app" ($h -match "Content-Security-Policy") ""
Check "Server header hidden" (-not ($h -match "(?im)^server:")) ""
$api = curl.exe -sk https://localhost:8443/api/v1/health
Check "API reachable through proxy" ($api -match "ok") $api
$docs = curl.exe -sk -o NUL -w "%{http_code}" https://localhost:8443/api/v1/docs
Check "API docs disabled outside development" ($docs -ne "200") "HTTP $docs"
$tls10 = curl.exe -sk --tlsv1.0 --tls-max 1.1 -o NUL -w "%{http_code}" https://localhost:8443/ 2>&1
Check "TLS 1.0/1.1 refused" ("$tls10" -notmatch "^200") "$tls10"

$results | Format-Table -AutoSize -Wrap
$fails = @($results | Where-Object Result -eq "FAIL").Count
Write-Host "$($results.Count - $fails)/$($results.Count) checks passed"
$results | ConvertTo-Json | Out-File -Encoding utf8 security\reports\raw\staging-verify.json
