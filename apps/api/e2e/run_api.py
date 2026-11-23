"""Run the API against the throwaway e2e database on port 8020 (used by Playwright and for UI review).

  python e2e/run_api.py        (run from apps/api; seed first with e2e/seed_e2e.py)
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("SINGLE_USER_MODE", "false")  # set SINGLE_USER_MODE=true to try the single-login flow
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": f"sqlite:///{(HERE / 'e2e.db').as_posix()}",
    "STORAGE_DIR": str(HERE / "storage"),
    "AI_ENABLED": "false",
    "PUSH_ENABLED": "false",
    "RATE_LIMIT_PER_MINUTE": "100000",
    "LOGIN_RATE_LIMIT_PER_MINUTE": "10000",
    "CORS_ORIGINS": "http://localhost:5180",
    "PUBLIC_BASE_URL": "http://localhost:5180",
})
sys.path.insert(0, str(HERE.parent))
os.chdir(HERE.parent)

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8020, log_level="warning")
