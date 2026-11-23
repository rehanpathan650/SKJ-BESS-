# Deployment

Target: one Linux server (Ubuntu 24.04 LTS, 4 vCPU / 8 GB RAM / 100 GB SSD is enough to start) with Docker,
reachable at a hostname such as `bess.skjenergy.com`. Use a **separate staging server** for testing and security scans.

## 1. Prepare the server
```sh
sudo apt update && sudo apt full-upgrade -y && sudo apt install -y docker.io docker-compose-v2 ufw unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades          # automatic security patches
sudo ufw default deny incoming && sudo ufw allow 443/tcp && sudo ufw allow 80/tcp
sudo ufw allow from <SKJ office/VPN range> to any port 22 proto tcp   # SSH only from SKJ
sudo ufw enable
```
SSH: key-based login only (`PasswordAuthentication no`, `PermitRootLogin no`), named admin accounts.
Docker publishes ports by editing iptables directly; only the proxy publishes ports in `docker-compose.yml`, so
PostgreSQL/Redis/ClamAV are never exposed. Verify with `sudo ss -tlnp` and an external `nmap` (see report, Phase 6).

## 2. Configure
```sh
git clone <repo> /opt/skj && cd /opt/skj
cp .env.example .env && chmod 600 .env     # fill in every value (generation commands are in the file)
sh infra/postgres/gen-certs.sh             # DB TLS certificates
```
Keep a copy of `DATA_ENCRYPTION_KEY` in SKJ's password manager/vault: **without it, stored files cannot be decrypted.**

## 3. Build the web app and start
```sh
docker run --rm -v "$PWD":/app -w /app node:22 sh -c "npm ci && npm run web:build"
docker compose up -d --build
docker compose run --rm api alembic upgrade head
docker compose run --rm api python -m app.cli seed
docker compose run --rm api python -m app.cli create-superadmin --email admin@skjenergy.com --name "Name"
```
The Super Administrator must set up MFA at first login. After that, everyone else signs up and is approved in
**Users & approvals**.

Before quoting customers, Finance must replace the placeholder vendor costs in **Pricing & assumptions**.

## 4. Updates
```sh
git pull && docker compose build --pull && docker compose up -d && docker compose run --rm api alembic upgrade head
```
Run the security workflow (CI) on every change; do not deploy with open High/Critical findings unless SKJ
management has signed a risk acceptance.

## 5. Monitoring
* `docker compose logs -f api worker` (JSON access logs from Caddy, request IDs from the API).
* Ship logs to SKJ's log platform (e.g. Azure Monitor, Grafana Loki) and alert on: API 5xx rate, `account.locked`,
  `refresh.reuse_detected`, `privilege_escalation.blocked`, `file.infected`, failed backups.
* Check the in-app **Security** page daily; run "Verify audit integrity" weekly.

## 6. Optional: Microsoft Entra ID SSO
Not built yet. The design fits: add an OIDC login endpoint that maps a verified Entra user to an existing approved
account (keeping the approval step), and disable password login for those users.
