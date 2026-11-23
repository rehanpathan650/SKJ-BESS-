"""Central configuration. Every secret comes from the environment; nothing is hardcoded."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "staging", "production"] = "development"
    app_name: str = "SKJ BESS Platform"

    # Database. Production must use PostgreSQL with sslmode=require (or verify-full).
    database_url: str = "sqlite:///./dev.db"
    db_pool_size: int = 10       # per API/worker process
    db_max_overflow: int = 10

    # Secrets
    jwt_secret: str = Field(default="", description="HS256 signing key for access tokens (>=32 bytes)")
    data_encryption_key: str = Field(default="", description="Fernet key for files and MFA secrets at rest")

    # Tokens and sessions
    access_token_minutes: int = 15
    refresh_token_idle_hours: int = 12
    refresh_token_absolute_days: int = 7
    mfa_ticket_minutes: int = 5

    # Login protection
    max_failed_logins: int = 5
    lockout_base_minutes: int = 15

    # Single-login mode: one account generates quotations end to end. Public sign-up is off, and saved
    # configurations and proposals skip the engineer-validation / approval chain (that needs several people).
    single_user_mode: bool = False

    # Sign-up rules
    allowed_email_domains: str = "skjenergy.com"  # comma separated
    require_email_verification: bool = True

    # Web
    cors_origins: str = "http://localhost:5173"
    public_base_url: str = "http://localhost:5173"
    cookie_secure: bool = False
    trusted_proxy_count: int = 0

    # Files. STORAGE_BACKEND=local (disk) or s3 (any S3-compatible store: AWS S3, MinIO, Cloudflare R2...).
    # Files are encrypted before upload either way, so the bucket never sees plaintext.
    storage_backend: str = "local"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""  # empty = AWS
    s3_region: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_prefix: str = "files/"
    storage_dir: Path = Path("./storage")
    max_upload_mb: int = 15
    clamav_host: str = ""
    clamav_port: int = 3310
    require_malware_scan: bool = False
    parser_timeout_seconds: int = 30

    # AI extraction
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    ai_enabled: bool = True
    ai_daily_limit_per_user: int = 50
    ai_monthly_budget_usd: float = 100.0

    # Email (SMTP). Empty host = emails are written to the console in development only.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@skjenergy.com"
    smtp_starttls: bool = True  # may only be false in staging (internal mail catcher)

    # Push notifications (Expo push service)
    push_enabled: bool = False

    # Rate limiting
    redis_url: str = ""
    rate_limit_per_minute: int = 300
    login_rate_limit_per_minute: int = 10

    # Observability
    log_format: str = "text"   # "json" for log collectors (one JSON object per line)
    sentry_dsn: str = ""       # optional error tracking; personal data is stripped before sending
    metrics_token: str = ""    # bearer token for /api/v1/metrics; empty = metrics disabled outside development

    # Retention (days)
    retention_bills_days: int = 2555  # ~7 years
    retention_sessions_days: int = 30
    retention_notifications_days: int = 180

    @field_validator("storage_dir", mode="before")
    @classmethod
    def _path(cls, v):
        return Path(v)

    @property
    def is_production(self) -> bool:
        return self.environment in ("production", "staging")

    @property
    def allowed_domains(self) -> list[str]:
        return [d.strip().lower() for d in self.allowed_email_domains.split(",") if d.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _check_production(self):
        if self.environment in ("development", "test"):
            return self
        problems = []
        if len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be at least 32 characters")
        if not self.data_encryption_key:
            problems.append("DATA_ENCRYPTION_KEY is required")
        if not self.database_url.startswith("postgresql"):
            problems.append("DATABASE_URL must be PostgreSQL")
        if "sslmode=" not in self.database_url:
            problems.append("DATABASE_URL must set sslmode (require or verify-full)")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true")
        if not self.require_malware_scan or not self.clamav_host:
            problems.append("REQUIRE_MALWARE_SCAN=true and CLAMAV_HOST are required")
        if any(o.startswith("http://") for o in self.cors_origin_list):
            problems.append("CORS_ORIGINS must be https")
        if not self.redis_url:
            problems.append("REDIS_URL is required (rate limits and cache must be shared between API servers)")
        if self.storage_backend not in ("local", "s3"):
            problems.append("STORAGE_BACKEND must be local or s3")
        if self.storage_backend == "s3" and not self.s3_bucket:
            problems.append("S3_BUCKET is required when STORAGE_BACKEND=s3")
        if self.environment == "production" and not self.smtp_starttls:
            problems.append("SMTP_STARTTLS must be true in production")
        if problems:
            raise ValueError("Insecure production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment in ("development", "test"):
        # Development-only fallbacks so the app starts without manual key setup.
        # They are random per process for JWT and persisted for the data key, never used in production.
        from app.security.devkeys import ensure_dev_keys

        ensure_dev_keys(s)
    return s
