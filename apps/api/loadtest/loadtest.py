"""API load test.

  python loadtest/loadtest.py seed               # create loadtest.db with realistic data
  python loadtest/loadtest.py run --base http://127.0.0.1:8010 --users 40 --seconds 30

Each virtual user logs in once (bearer token), then loops over the screens people actually use:
dashboard, customer list/search, customer detail, project list, notifications, calculator preview.
Reports requests/second and latency percentiles per endpoint. Run against a local server started
with ENVIRONMENT=test and a high RATE_LIMIT_PER_MINUTE so the rate limiter doesn't dominate the numbers.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "loadtest.db"
PASSWORD = "Loadtest-Password-2026"
USERS = 40
CUSTOMERS_PER_USER = 30


def seed() -> None:
    os.environ.update(ENVIRONMENT="test", DATABASE_URL=f"sqlite:///{DB.as_posix()}", STORAGE_DIR=str(HERE / "storage"))
    sys.path.insert(0, str(HERE.parent))
    if DB.exists():
        DB.unlink()
    from sqlalchemy import select

    from app.cli import seed as seed_roles
    from app.db import Base, SessionLocal, engine
    from app.models import Customer, CustomerAssignment, Department, Notification, Project, Role, User, UserStatus
    from app.security.passwords import hash_password

    Base.metadata.create_all(engine)
    seed_roles()
    db = SessionLocal()
    sales = db.execute(select(Role).where(Role.name == "Sales Executive")).scalar_one()
    dept = db.execute(select(Department).where(Department.name == "Sales")).scalar_one()
    pw_hash = hash_password(PASSWORD)
    stages = ["lead", "site_survey", "technical_validation", "proposal", "negotiation", "won", "lost"]
    for u in range(USERS):
        user = User(email=f"load{u}@skjenergy.com", full_name=f"Load User {u}", password_hash=pw_hash,
                    status=UserStatus.ACTIVE, role_id=sales.id, department_id=dept.id)
        db.add(user)
        db.flush()
        for c in range(CUSTOMERS_PER_USER):
            cust = Customer(name=f"Customer {u}-{c} Industries", company=f"Co {u}-{c}", state="Maharashtra",
                            discom="MSEDCL", owner_id=user.id, department_id=dept.id)
            db.add(cust)
            db.flush()
            db.add(CustomerAssignment(customer_id=cust.id, user_id=user.id))
            for p in range(2):
                db.add(Project(customer_id=cust.id, name=f"BESS {u}-{c}-{p}", stage=random.choice(stages),
                               estimated_value_inr=random.randint(5, 80) * 1e6, target_capacity_kwh=random.randint(2, 40) * 50,
                               owner_id=user.id, progress_pct=random.choice([0, 25, 50, 75])))
        for n in range(20):
            db.add(Notification(user_id=user.id, kind="customer_updated", title=f"Update {n}"))
        db.commit()
    db.close()
    print(f"Seeded {USERS} users, {USERS * CUSTOMERS_PER_USER} customers, {USERS * CUSTOMERS_PER_USER * 2} projects -> {DB}")


CALC = {"monthly_consumption_kwh": 150000, "peak_tariff_inr": 11, "offpeak_tariff_inr": 6.5, "battery_capacity_kwh": 1000,
        "battery_power_kw": 500, "recorded_max_demand_kva": 950, "contract_demand_kva": 1000, "demand_charge_inr_per_kva": 450}


async def login(client, idx: int, sem: asyncio.Semaphore) -> dict:
    # Logins are deliberately expensive (Argon2id, 64 MiB each), so they are done before the timed phase.
    async with sem:
        r = await client.post("/api/v1/auth/login", json={"email": f"load{idx % USERS}@skjenergy.com", "password": PASSWORD,
                                                          "client": "mobile"})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def vuser(client, h: dict, deadline: float, stats: dict) -> None:
    customer_ids: list[str] = []
    while time.perf_counter() < deadline:
        step = random.random()
        if step < 0.25:
            name, req = "GET /dashboard", client.get("/api/v1/dashboard", headers=h)
        elif step < 0.45:
            name, req = "GET /customers?q=", client.get("/api/v1/customers?q=Industries&limit=50", headers=h)
        elif step < 0.60 and customer_ids:
            name, req = "GET /customers/{id}", client.get(f"/api/v1/customers/{random.choice(customer_ids)}", headers=h)
        elif step < 0.75:
            name, req = "GET /projects", client.get("/api/v1/projects", headers=h)
        elif step < 0.90:
            name, req = "GET /notifications", client.get("/api/v1/notifications?unread=true", headers=h)
        else:
            name, req = "POST /calculator/preview", client.post("/api/v1/calculator/preview", json=CALC, headers=h)
        t0 = time.perf_counter()
        try:
            resp = await req
        except Exception as exc:  # timeouts count as errors, keep going
            stats[name].append((time.perf_counter() - t0) * 1000)
            stats["errors"].append(f"{name}: {exc.__class__.__name__}")
            continue
        stats[name].append((time.perf_counter() - t0) * 1000)
        if resp.status_code >= 400:
            stats["errors"].append(resp.status_code)
        elif name.startswith("GET /customers?q") and not customer_ids:
            body = resp.json()
            items = body["items"] if isinstance(body, dict) else body
            customer_ids = [c["id"] for c in items][:20]


async def run(base: str, users: int, seconds: int) -> None:
    import httpx

    stats: dict = defaultdict(list)
    limits = httpx.Limits(max_connections=users * 2)
    async with httpx.AsyncClient(base_url=base, timeout=30, limits=limits) as client:
        sem = asyncio.Semaphore(4)
        headers = await asyncio.gather(*(login(client, i, sem) for i in range(users)))
        deadline = time.perf_counter() + seconds
        start = time.perf_counter()
        await asyncio.gather(*(vuser(client, h, deadline, stats) for h in headers))
        elapsed = time.perf_counter() - start
    total = sum(len(v) for k, v in stats.items() if k != "errors")
    print(f"\n{users} virtual users for {seconds}s: {total} requests, {total / elapsed:.1f} req/s, errors: {len(stats['errors'])}")
    if stats["errors"]:
        from collections import Counter

        print("errors:", dict(Counter(str(e) for e in stats["errors"]).most_common(5)))
    print(f"{'endpoint':28} {'count':>6} {'p50 ms':>8} {'p95 ms':>8} {'max ms':>8}")
    every = []
    for k in sorted(k for k in stats if k != "errors"):
        v = sorted(stats[k])
        every += v
        print(f"{k:28} {len(v):6} {statistics.median(v):8.0f} {v[int(len(v) * 0.95) - 1]:8.0f} {v[-1]:8.0f}")
    every.sort()
    print(f"{'ALL':28} {len(every):6} {statistics.median(every):8.0f} {every[int(len(every) * 0.95) - 1]:8.0f} {every[-1]:8.0f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["seed", "run"])
    ap.add_argument("--base", default="http://127.0.0.1:8010")
    ap.add_argument("--users", type=int, default=40)
    ap.add_argument("--seconds", type=int, default=30)
    a = ap.parse_args()
    if a.cmd == "seed":
        seed()
    else:
        asyncio.run(run(a.base, a.users, a.seconds))
