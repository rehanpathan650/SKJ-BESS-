# Security assessment report — SKJ BESS Platform v1.0.0

**Date:** 22 Nov 2026 · **Environment:** local development (Windows 10, SQLite, no Docker) · **Assessor:** automated
tooling + developer review during build.

> **Status: NOT production-ready from a security-assurance standpoint.** Security controls are implemented and the
> tests below passed, but this is **not a penetration test**, the app has **not** been deployed to a staging
> environment, and several planned test phases could not run here (see §3). Do not describe the system as
> "penetration-tested", "OWASP-compliant" or "secure" on the basis of this report.

## 1. Tests performed and results

| Phase | Tool / method | Scope | Result |
|---|---|---|---|
| 1 SAST | Bandit 1.8 | `apps/api/app` (4,105 lines) | 1 High (fixed, F-01), 5 Low reviewed as false positives/by design → **0 open** |
| 1 SAST | Ruff security rules (S, B) | `apps/api/app` | 7 → 1 fixed (unused import), 6 reviewed (same as Bandit + `subprocess` with fixed argv) → **0 open** |
| 1 SAST | TypeScript strict typecheck | web, mobile, shared | **Pass** |
| 1 Secrets | Regex scan for keys/tokens/private keys | whole repo (excl. dependencies) | Only the test-suite fixture password → **0 real secrets** |
| 2 SCA | pip-audit | Python dependencies | **103 known vulnerabilities in 5 packages** (F-02) → upgraded → **0** |
| 2 SCA | npm audit | web + shared (prod & dev) | **0** |
| 2 SCA | npm audit | Android app | 3 Moderate, build tooling only (F-05) → accepted |
| 2 SCA | expo-doctor | Android app | 1 issue (duplicate React) → fixed → **20/20 checks pass** |
| 4 API tests | pytest (43 tests) | API, run against upgraded deps | **43/43 pass**. Covers the items below |
| 7 AI | pytest + unit tests | injection screening, output validation, budget cap | **Pass** (offline only, see §3) |
| Functional | Manual browser test (built-in browser) | sign-up → verify → pending → admin MFA → approve; customer create; calculator; security dashboard | **Pass** after fixing F-03, F-04 |

**API attack tests that passed (automated, repeatable — `apps/api/tests`)**
* IDOR: another salesperson gets 404 on a customer's record, bills, and edit; IT admin sees no customer data.
* Privilege escalation: IT admin cannot create roles with permissions it lacks, grant `*`, assign Super Admin or
  Finance roles, disable the Super Admin, or change itself. Sales cannot list users.
* Authentication: generic errors for unknown user vs bad password; lockout after 5 failures; MFA enforced for admin
  roles; wrong MFA code rejected; email verification required; outside-domain and weak passwords refused.
* Tokens: `alg=none`, forged subject with original signature and garbage tokens rejected; logout, password reset,
  role change, disable and admin revocation all invalidate live tokens; refresh-token replay kills the session.
* CSRF: cookie-authenticated POST without/with wrong CSRF header rejected.
* Rate limiting: login limit returns 429.
* Confidential data: sales responses contain no vendor/margin fields; pricing settings blocked for sales.
* Input handling: over-long fields and script content rejected without echoing; SQL-like search strings harmless.
* Files: disguised executable, `.xlsm/.exe/.html/.svg`, macro workbook renamed `.xlsx`, oversize upload rejected;
  `../../etc/passwd.pdf` stored as `passwd.pdf`; files verified encrypted on disk; infected file quarantined and
  download blocked.
* Workflow: proposal needs engineer validation; engineer can't validate own config; author can't approve own
  proposal; drafts can't be shared; revoked share link returns 404; audit chain verifies and detects tampering.
* Headers/CORS: security headers present; foreign origin not allowed.

## 2. Findings register

| ID | Finding | Component | Severity (CVSS 3.1) | Status |
|---|---|---|---|---|
| F-01 | Invisible bidirectional Unicode characters in source (Trojan Source, CWE-1007) | `extraction.py` | Low (no exploit path; flagged High by Bandit) | **Fixed, retested** |
| F-02 | Outdated dependencies with 103 known CVEs (pypdf ×67 — parses untrusted bills; PyJWT ×17; Starlette ×7; cryptography ×6; python-multipart ×6) | API | **High** (7.5, AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H for parser DoS class) | **Fixed, retested** (pip-audit 0, 43/43 tests) |
| F-03 | Web logout ended the session on the server but the page kept showing the user's screen until reload | Web | Low (3.1) | **Fixed, retested in browser** |
| F-04 | MFA setup could display a different key than the one saved (double request in dev mode) → admin lock-out risk | Web | Low | **Fixed** (single request guard) |
| F-05 | `minimatch` ReDoS (GHSA-g3hv-75wg-m249) via Expo build tooling | Android build | Moderate per npm; **Low in context** (build-time only, not in APK) | **Accepted** — recheck at next Expo SDK |
| F-06 | No TLS certificate pinning in the Android app | Android | Medium (5.9) | **Open** — decide before production; needs a pin-rotation plan |
| F-07 | No rooted/jailbroken device detection | Android | Low | **Accepted** (data is server-side; tokens in Keystore) — revisit if MDM is not used |
| F-08 | Document parser runs as a subprocess in the worker container, not in its own network-less container | Worker | Medium (5.3) | **Open** — recommended: separate `parser` service with `network_mode: none` |
| F-09 | Automatic deletion of bills after the retention period not yet implemented | Data | Low | **Open** — awaiting SKJ retention decision |
| F-10 | Microsoft Entra ID SSO not implemented (optional requirement) | Auth | Info | Open |

No Critical or High findings are open. F-06 and F-08 (Medium) need an SKJ decision or a fix before production.

## 3. Not performed (limitations)

| Phase | Why not run | How to run |
|---|---|---|
| 1 Semgrep, Gitleaks (git history) | Docker not running on this PC | CI workflow `.github/workflows/security.yml`, or `security/scripts/run-all-local.ps1` with Docker |
| 3 DAST (OWASP ZAP), TLS testing | No staging environment exists yet | `security/scripts/run-dast.sh` against staging |
| 5 Android (MobSF + MASTG manual) | No APK built (needs SKJ's Expo account) and no test device | `docs/android-build.md`, then `security/scripts/run-mobile.sh` + `security/android-masvs-checklist.md` |
| 6 Infrastructure (port scan, firewall, DB exposure, container scan, backup restore) | No server provisioned | `nmap -Pn -p- <host>` from outside (expect only 80/443), Trivy in CI, `infra/backup/restore-test.sh` |
| 7 Live AI tests (real Claude calls with injected bills, cost limits under load) | No API key configured | Add `ANTHROPIC_API_KEY` on staging, upload the injection samples, confirm flags and that values still need review |
| 8 Authorised penetration test | Requires an independent tester and SKJ's written authorisation | Commission after staging is live; scope: web, API, Android, infrastructure. No destructive tests on production |
| PostgreSQL-specific controls (audit trigger, least-privilege roles, TLS) | Tests ran on SQLite | Verify on staging: `UPDATE audit_log ...` as `skj_app` must fail; `sslmode=disable` must be refused |

## 4. Release gate
Production release requires: all phases in §3 run on staging; no open Critical/High; F-06 and F-08 fixed or
risk-accepted in writing by authorised SKJ management; restore test recorded in `docs/backup-restore.md`.

Raw tool output: `security/reports/raw/` (git-ignored; may contain environment details).
