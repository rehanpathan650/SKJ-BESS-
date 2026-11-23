# Data retention and deletion (proposed — SKJ management to confirm)

| Data | Retention | Mechanism |
|---|---|---|
| Customers, projects, calculations, proposals | Life of customer relationship + 8 years (Indian tax/commercial records) | Manual delete by `customers.delete` (cascades) |
| Electricity bills (files + extracted data) | 7 years (`RETENTION_BILLS_DAYS`) | Purge job to be scheduled after SKJ confirms the period |
| Audit log | 7 years minimum; never edited | Append-only; archive yearly to cold storage |
| Login sessions | 30 days after expiry | Worker clean-up (hourly) |
| Email/reset tokens | 1 day after expiry | Worker clean-up |
| In-app notifications | 180 days | Worker clean-up |
| Temporary parser/download files | Deleted immediately; anything left > 1 h removed | Worker / app start-up |
| Proposal share links | Expire after 1–30 days or N downloads; revocable | API |
| Backups | 30 days | `backup.sh` |
| AI usage records | 2 years (cost and abuse review) | Manual |

Personal data requests (DPDP Act 2023): export via the API/DB; deletion via customer delete, then the next backup
cycle removes it from backups after 30 days.
