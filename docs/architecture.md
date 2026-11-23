# Architecture and security design

## Components

```
 Browser (React) ─┐                      ┌── PostgreSQL 17  (internal network, TLS, least-privilege roles)
                  ├─ HTTPS ─ Caddy ─ API ┼── Redis          (rate limits; internal network)
 Android (Expo) ──┘    (TLS, headers)    └── File store     (Fernet-encrypted files, random names)
                                    │
                                 Worker ── ClamAV (malware scan)
                                    ├──── sandboxed parser subprocess (PDF / XLSX / CSV, timeouts, rlimits)
                                    ├──── Claude API (bill extraction, strict JSON schema, no tools)
                                    └──── SMTP / Expo push
```

* One backend, one database. Web and Android call the same versioned API (`/api/v1`).
* The backend enforces every rule. The apps only decide what to *show*.
* Long or risky work (malware scan, parsing, AI, email, push) runs in the worker, never in a web request.
* Web and Android share one design system and chart geometry (`packages/shared/src/design.ts`).

## Scaling (sized for ~500 users, built to grow)
```
                    ┌─ API instance 1 ─┐            ┌─ PostgreSQL (pooled connections, indexed queries)
 Load balancer ─────┼─ API instance 2 ─┼── shared ──┼─ Redis (rate limits, dashboard cache, cache version)
 (/health, /ready)  └─ API instance N ─┘            └─ S3-compatible object store (encrypted files)
                    Worker 1..N  (jobs claimed with SELECT … FOR UPDATE SKIP LOCKED, so workers never collide)
```
* **Stateless API servers.** No session, cache or file lives in a process: sessions in PostgreSQL, rate limits and
  cache in Redis, files in object storage. Add instances behind the load balancer to scale. Production refuses to
  start without `REDIS_URL`, so limits stay correct across instances.
* **Database.** Indexes on every filter/sort column (owner, department, stage, status, engineer, updated_at…),
  migration `0003`. Lists are paged (`limit`/`offset`, `X-Total-Count`) with a hard cap of 500. Related rows are loaded
  in the same query (no N+1). Pool per process: `DB_POOL_SIZE` (10) + `DB_MAX_OVERFLOW` (10).
* **Dashboard.** Counts and sums are done by the database (GROUP BY), not by loading rows: 12.5× faster on 2,400
  projects. Results cached 20 s per user and permission set; any successful change bumps a cache version, so no one
  sees stale numbers after an edit.
* **Files.** `STORAGE_BACKEND=s3` switches to any S3-compatible store (AWS S3, MinIO, Cloudflare R2) with no code
  changes. Files are still Fernet-encrypted before upload, and server-side encryption is requested as well.
* **Web.** Every page is its own lazily-loaded file (1–4 KB gzipped); libraries in separate long-cached files; data
  reused for 30 s between pages.
* **Android.** Virtualized lists with endless scrolling, in-memory cache for offline viewing of screens already opened
  in the session (cleared on logout; nothing confidential written to the phone).

## Monitoring
* `GET /api/v1/health`: liveness (no I/O). `GET /api/v1/health/ready`: database, Redis and file storage reachable
  (503 if not; details only in logs).
* `GET /api/v1/metrics`: Prometheus format (request counts, latency histograms per route template, uptime). Requires
  `METRICS_TOKEN` as a bearer token; disabled in production without it.
* `LOG_FORMAT=json`: one JSON object per line (request ID, route template, status, duration, user ID). No query
  strings, bodies or IDs from URLs.
* `SENTRY_DSN`: optional error tracking. Bodies, cookies, query strings, auth headers and user details are stripped.

## Identity and access
| Control | Implementation |
|---|---|
| Sign-up | Company-domain emails only, email verification, then admin approval with a role. Generic responses so outsiders can't tell which accounts exist. |
| Passwords | Argon2id (64 MiB, t=3, p=2), 12+ characters, common/personal passwords rejected, rehash on login when parameters change. |
| MFA | TOTP. Mandatory for any role with admin or pricing permissions (enforced server-side on every request). Secrets encrypted at rest. |
| Login protection | Per-IP and per-email rate limits; lockout after 5 failures with doubling lock time; identical error for unknown user / bad password / locked. |
| Sessions | 15-min JWT access token bound to a server-side session (revocable instantly); rotating refresh token (12 h idle, 7 days absolute), stored only as a SHA-256 hash; replaying an old refresh token kills the session. |
| Web tokens | httpOnly, `SameSite=Strict` cookies + double-submit CSRF token on every state-changing request. |
| Mobile tokens | Refresh token in Android Keystore-backed SecureStore; access token in memory only. |
| RBAC | 7 built-in roles, admin-defined custom roles, 27 permissions. Users can only grant permissions they hold (no privilege escalation), can't act on themselves or on more-privileged users. Role changes revoke the affected sessions. |
| Record-level access | Customers visible only if assigned/owned/engineer-on-project, same department (`view_department`) or `view_all`. Every lookup is scoped; out-of-scope IDs return the same 404 as missing ones (IDOR). |
| Confidential pricing | Vendor cost, installation, margin live only in the `commercial` block and settings. Returned only with `commercial.confidential.view`. Never in proposal PDFs. |
| Segregation of duties | Engineers can't validate their own configurations; proposal authors can't approve their own proposals. AI output can never approve anything. |

## Application and API security
* Pydantic validation of every input (types, lengths, ranges, patterns); validation errors never echo values.
* SQLAlchemy ORM only (parameterised queries). No raw SQL built from input.
* Security headers on every response (CSP, HSTS in production, `nosniff`, `DENY` framing, `no-store`).
* CORS limited to configured origins; credentials only for those origins.
* Global and per-endpoint rate limits; request-size cap; generic 500s with a request ID.
* No outbound requests built from user input (no SSRF surface). Push/SMTP/Claude hosts are fixed.
* API docs disabled in production.

## Files and documents
Extension allow-list → magic-byte check → size cap → macro/zip-bomb checks for XLSX → encrypted storage under a
random 48-hex name → ClamAV scan in the worker → text extraction in a separate Python process (isolated mode,
no environment, timeout, CPU/memory/file-handle limits on Linux) → temporary file deleted immediately.
Macro-enabled and legacy formats are refused. Downloads require the same record access, are audited, and are sent
with `Content-Disposition: attachment` and a sandbox CSP.

## AI (bill extraction)
* The model receives the document as data with a system prompt that tells it not to follow embedded instructions.
* No tools are given to the model, so it cannot take actions.
* Output is constrained to a JSON schema, then re-validated server-side (types, ranges, cross-checks, markup stripped).
* Text is screened for injection phrases, script-like content and hidden Unicode; flags are shown to reviewers and
  raise a security alert.
* A person must confirm every extracted value before it can feed a calculation; an engineer must validate every
  configuration; Finance/Management must approve every proposal.
* Per-user daily limit and a monthly USD budget; every call logged with tokens and cost (no document content).
* The API key lives only in the server environment.

## Audit and monitoring
* Hash-chained, append-only audit log (each entry includes the previous entry's hash). In PostgreSQL a trigger
  blocks UPDATE/DELETE/TRUNCATE and the app role lacks those privileges.
* Entries are written in their own transaction. During a web request they are collected and written right after the
  endpoint finishes (before the response is sent), so they never wait on the request's own transaction and are kept
  even when the request fails or is rolled back.
* Logged: logins and failures, lockouts, MFA changes, sign-ups and approvals, role/permission changes, session
  revocations, customer views/changes, file uploads/downloads, proposal lifecycle and share links, pricing changes,
  permission denials, CSRF/token failures, rate limiting, flagged documents.
* Security dashboard: KPIs, alerts (brute force, token reuse, escalation attempts, malware, probing), audit search,
  login activity, active sessions with revoke, AI usage, chain verification.

## Infrastructure
* Only the reverse proxy publishes ports (80/443). PostgreSQL, Redis and ClamAV sit on an `internal` Docker network
  with no internet route. PostgreSQL accepts TLS + SCRAM only.
* Containers run read-only, non-root, with all Linux capabilities dropped and `no-new-privileges`.
* Production refuses to start with weak/missing secrets, non-TLS DB URL, insecure cookies, http origins or
  without a malware scanner.
