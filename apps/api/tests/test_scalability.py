"""Tests for the scalability/monitoring changes: dashboard aggregates + cache invalidation, paging,
readiness/metrics endpoints, S3 storage backend, and the production config guard."""
import pytest

from app.config import Settings
from app.services import storage

from .conftest import make_user, login


def _customer_with_project(client, h, name="Acme", value=5_000_000, stage=None):
    c = client.post("/api/v1/customers", json={"name": name}, headers=h).json()
    p = client.post("/api/v1/projects", json={"customer_id": c["id"], "name": f"{name} BESS",
                                              "estimated_value_inr": value, "target_capacity_kwh": 500}, headers=h).json()
    if stage:
        client.patch(f"/api/v1/projects/{p['id']}", json={"stage": stage}, headers=h)
    return c, p


def test_dashboard_aggregates_and_cache_invalidation(client, team):
    h = team["sales"]["h"]
    first = client.get("/api/v1/dashboard", headers=h).json()
    assert first["kpis"]["customers"] == 0
    _customer_with_project(client, h, "Acme", 5_000_000)
    _customer_with_project(client, h, "Beta", 3_000_000)
    d = client.get("/api/v1/dashboard", headers=h).json()  # must not be the cached "0 customers" answer
    assert d["kpis"]["customers"] == 2
    assert d["kpis"]["active_projects"] == 2
    assert d["kpis"]["pipeline_value_inr"] == 8_000_000
    assert d["projects_by_stage"] == {"lead": 2}
    assert len(d["pipeline_by_month"]) == 12 and d["pipeline_by_month"][-1]["projects"] == 2  # all months, zeros included
    assert sum(m["projects"] for m in d["pipeline_by_month"]) == 2
    assert [o["customer_name"] for o in d["opportunities"]] == ["Acme", "Beta"]
    # Another sales user sees none of it (scoping still applies inside the aggregates).
    other = client.get("/api/v1/dashboard", headers=team["sales2"]["h"]).json()
    assert other["kpis"]["customers"] == 0 and other["kpis"]["pipeline_value_inr"] == 0


def test_dashboard_confidential_kpi_only_for_permitted_roles(client, team):
    _customer_with_project(client, team["sales"]["h"])
    assert "gross_margin_in_open_proposals_inr" not in client.get("/api/v1/dashboard", headers=team["sales"]["h"]).json()["kpis"]
    assert "gross_margin_in_open_proposals_inr" in client.get("/api/v1/dashboard", headers=team["mgmt"]["h"]).json()["kpis"]


def test_project_and_proposal_lists_are_paged(client, team):
    h = team["sales"]["h"]
    for i in range(3):
        _customer_with_project(client, h, f"Cust{i}")
    r = client.get("/api/v1/projects?limit=2", headers=h)
    assert r.status_code == 200 and len(r.json()) == 2 and r.headers["X-Total-Count"] == "3"
    r = client.get("/api/v1/projects?limit=2&offset=2", headers=h)
    assert len(r.json()) == 1
    assert client.get("/api/v1/projects?limit=5000", headers=h).status_code == 422  # hard cap
    r = client.get("/api/v1/proposals?limit=10", headers=h)
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "0"


def test_health_ready_and_metrics(client, team):
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 200 and r.json()["checks"]["database"] == "ok" and r.json()["checks"]["storage"] == "ok"
    client.get("/api/v1/customers/does-not-exist", headers=team["sales"]["h"])
    m = client.get("/api/v1/metrics").text
    assert 'route="/customers/{customer_id}"' in m  # route template, never the real ID
    assert "does-not-exist" not in m


def test_metrics_require_token_when_configured(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "metrics_token", "s3cret-token-value")
    assert client.get("/api/v1/metrics").status_code == 404
    assert client.get("/api/v1/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 404
    assert client.get("/api/v1/metrics", headers={"Authorization": "Bearer s3cret-token-value"}).status_code == 200


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, **kw):
        assert kw.get("ServerSideEncryption") == "AES256"
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        import io
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)

    def head_bucket(self, Bucket):
        return {}


def test_s3_backend_stores_only_encrypted_bytes(monkeypatch):
    from app.db import SessionLocal

    fake = FakeS3()
    s3 = storage._S3.__new__(storage._S3)
    s3.bucket, s3.prefix, s3.client = "skj-files", "files/", fake
    monkeypatch.setattr(storage, "_backend", s3)
    db = SessionLocal()
    try:
        secret = b"%PDF-1.4 consumer number 123456789"
        f = storage.save(db, secret, "bill.pdf", "application/pdf", None)
        (bucket, key), blob = next(iter(fake.objects.items()))
        assert bucket == "skj-files" and key == f"files/{f.stored_name[:2]}/{f.stored_name}"
        assert b"123456789" not in blob  # encrypted before it leaves the server
        assert storage.load(f) == secret
        storage.delete(f)
        assert not fake.objects
        with pytest.raises(ValueError):
            s3._key("../../etc/passwd")
    finally:
        db.rollback()
        db.close()


def test_production_requires_redis_and_valid_storage():
    base = dict(environment="production", jwt_secret="x" * 40, data_encryption_key="k",
                database_url="postgresql+psycopg://u:p@db/skj?sslmode=require", cookie_secure=True,
                require_malware_scan=True, clamav_host="clamav", cors_origins="https://bess.skjenergy.com")
    with pytest.raises(ValueError, match="REDIS_URL"):
        Settings(**base)
    with pytest.raises(ValueError, match="S3_BUCKET"):
        Settings(**base, redis_url="redis://r", storage_backend="s3")
    assert Settings(**base, redis_url="redis://r").storage_backend == "local"


def test_bill_upload_is_fast_and_audited(client, team):
    """Regression: the audit entry used to be written mid-request on a second connection and, on SQLite,
    waited for the request's own lock until it timed out (slow upload, lost audit entry)."""
    import time

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import AuditLog

    h = team["sales"]["h"]
    c = client.post("/api/v1/customers", json={"name": "Audit Co"}, headers=h).json()
    t0 = time.perf_counter()
    r = client.post(f"/api/v1/customers/{c['id']}/bills", headers=h, files={"files": ("bill.csv", b"a,b\n1,2\n", "text/csv")})
    assert r.status_code == 201
    assert time.perf_counter() - t0 < 5
    db = SessionLocal()
    try:
        actions = db.execute(select(AuditLog.action)).scalars().all()
    finally:
        db.close()
    assert "bill.uploaded" in actions


def test_jobs_left_running_by_a_stopped_worker_are_requeued():
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import Job
    from app.worker import MAX_ATTEMPTS, requeue_stuck

    db = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(minutes=30)
        stuck = Job(kind="email", payload={}, status="running", attempts=1)
        dead = Job(kind="email", payload={}, status="running", attempts=MAX_ATTEMPTS)
        busy = Job(kind="email", payload={}, status="running", attempts=1)  # just started by a live worker
        db.add_all([stuck, dead, busy])
        db.commit()
        db.execute(update(Job).where(Job.id.in_([stuck.id, dead.id])).values(updated_at=old))
        db.commit()
        assert requeue_stuck(db) == 2
        db.expire_all()
        assert (db.get(Job, stuck.id).status, db.get(Job, dead.id).status, db.get(Job, busy.id).status) == \
            ("pending", "failed", "running")
    finally:
        db.close()


def test_login_still_works_with_new_middleware(client):
    u = make_user("Sales Executive", "x@skjenergy.com", "Sales")
    assert client.get("/api/v1/auth/me", headers=login(client, u)).status_code == 200
