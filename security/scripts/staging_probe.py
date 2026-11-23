"""End-to-end probes against local staging (https://localhost:8443).

  python security/scripts/staging_probe.py token  <email> <password>   -> prints a bearer token
  python security/scripts/staging_probe.py eicar  <email> <password>   -> uploads the EICAR test file, waits for ClamAV
  python security/scripts/staging_probe.py live   <email> <password>   -> live checks of rate limit, headers, cookies

Only for the authorised local staging environment. Uses the harmless industry-standard EICAR test string.
"""
import json
import sys
import time

import httpx

BASE = "https://localhost:8443/api/v1"
# Built from parts so this file itself is not flagged by antivirus.
EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def client() -> httpx.Client:
    # Staging uses Caddy's internal CA; certificate verification is intentionally off for this local probe only.
    return httpx.Client(base_url=BASE, verify=False, timeout=30)  # noqa: S501  # nosec B501


def login(c: httpx.Client, email: str, pw: str) -> dict:
    r = c.post("/auth/login", json={"email": email, "password": pw, "client": "mobile"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def eicar(c: httpx.Client, h: dict) -> dict:
    cust = c.post("/customers", json={"name": "EICAR Probe Co"}, headers=h).json()
    up = c.post(f"/customers/{cust['id']}/bills", headers=h,
                files=[("files", ("eicar-test.csv", EICAR.encode(), "text/csv"))])
    if up.status_code != 201:
        return {"upload_status": up.status_code, "detail": up.text[:200]}
    bid = up.json()[0]["id"]
    bill = {}
    for _ in range(60):
        bill = c.get(f"/bills/{bid}", headers=h).json()
        if bill["status"] not in ("queued", "scanning", "extracting"):
            break
        time.sleep(2)
    dl = c.get(f"/bills/{bid}/file", headers=h)
    return {"status": bill.get("status"), "scan_status": bill.get("scan_status"),
            "status_detail": bill.get("status_detail"), "download_http": dl.status_code}


def clean_upload(c: httpx.Client, h: dict) -> dict:
    cust = c.post("/customers", json={"name": "Clean Probe Co"}, headers=h).json()
    csv = "month,units_kwh,total_amount_inr\n2026-01,145000,1485000\n"
    bid = c.post(f"/customers/{cust['id']}/bills", headers=h,
                 files=[("files", ("bill.csv", csv.encode(), "text/csv"))]).json()[0]["id"]
    bill = {}
    for _ in range(60):
        bill = c.get(f"/bills/{bid}", headers=h).json()
        if bill["status"] not in ("queued", "scanning", "extracting"):
            break
        time.sleep(2)
    return {"status": bill.get("status"), "scan_status": bill.get("scan_status")}


def live(c: httpx.Client, email: str, pw: str) -> dict:
    out = {}
    web = c.post("/auth/login", json={"email": email, "password": pw, "client": "web"})
    cookies = web.headers.get_list("set-cookie")
    out["cookie_flags"] = {ck.split("=")[0]: {"secure": "Secure" in ck, "httponly": "HttpOnly" in ck,
                                              "samesite_strict": "SameSite=strict" in ck or "SameSite=Strict" in ck}
                           for ck in cookies}
    out["tokens_in_web_body"] = "access_token" in web.json()
    codes = [c.post("/auth/login", json={"email": email, "password": "wrong-password-xyz", "client": "mobile"}).status_code
             for _ in range(15)]
    out["login_burst_codes"] = sorted(set(codes))
    out["evil_origin_cors"] = c.options("/auth/login", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}).headers.get("access-control-allow-origin")
    return out


def main() -> None:
    cmd, email, pw = sys.argv[1], sys.argv[2], sys.argv[3]
    with client() as c:
        if cmd == "token":
            print(login(c, email, pw)["Authorization"].split()[1])
        elif cmd == "eicar":
            h = login(c, email, pw)
            print(json.dumps({"eicar": eicar(c, h), "clean_file": clean_upload(c, h)}, indent=2))
        elif cmd == "live":
            print(json.dumps(live(c, email, pw), indent=2))


if __name__ == "__main__":
    import warnings

    warnings.filterwarnings("ignore")
    main()
