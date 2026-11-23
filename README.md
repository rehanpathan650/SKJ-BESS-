# SKJ BESS Platform

Internal web and Android application for SKJ Energy Solutions: customers, electricity-bill analysis,
BESS sizing and savings, proposals and approvals. For authorised SKJ employees only.

```
apps/api      Python FastAPI backend + background worker (the only component that touches the database)
apps/web      React web app (Vite)
apps/mobile   Android app (Expo / React Native)
packages/shared  Types, API client, permissions and formatting shared by web and mobile
infra/        Reverse proxy, PostgreSQL roles/TLS, backup and restore scripts
security/     Security test scripts, Android checklist, findings register
docs/         Architecture, deployment, backup, Android build, security report, user guide
```

## How sign-up works
1. An employee signs up with their company email (only `ALLOWED_EMAIL_DOMAINS` are accepted).
2. They verify their email address, then their account is **Pending**: they can log in but see nothing.
3. Admins get a notification, pick a role and department, and approve.
4. The employee is emailed and now sees only what their role allows.

Admin and commercial roles must set up MFA (authenticator app) before they can do anything.

## Run locally (Windows)
Requirements: Python 3.12, Node 22. In PowerShell use `npm.cmd` instead of `npm` if script execution is disabled.

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\pip install -r requirements-dev.txt
Copy-Item .env.development .env
.\.venv\Scripts\python -m app.cli init-db
.\.venv\Scripts\python -m app.cli create-superadmin --email you@skjenergy.com --name "Your Name"
```

Then in three terminals:

```powershell
cd apps\api; .\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```
```powershell
cd apps\api; .\.venv\Scripts\python -m app.worker
```
```powershell
npm.cmd install; npm.cmd run web:dev
```

Open http://localhost:5173. In development, emails (verification links, password resets) are printed in the
worker's terminal instead of being sent.

## Tests and security checks
```powershell
cd apps\api; .\.venv\Scripts\python -m pytest -q
```
Website end-to-end tests (starts its own throwaway API and web app, uses the installed Microsoft Edge):
```powershell
npm --workspace apps/web run e2e
```
```powershell
powershell -ExecutionPolicy Bypass -File security\scripts\run-all-local.ps1
```

## Documentation
- [Architecture & security design](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Backup & disaster recovery](docs/backup-restore.md)
- [Android APK / AAB builds](docs/android-build.md)
- [Security assessment report](docs/security-assessment-report.md)
- [Roles & permissions](docs/roles-and-permissions.md)
- [Data retention](docs/data-retention.md)
- [UI and scalability report](docs/ui-and-scalability-report.md): design system, charts, scaling, load test, feature test status
- [Quotations from an electricity bill](docs/quotations.md): what is calculated, AI's role, single-login mode
