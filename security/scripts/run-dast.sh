#!/bin/sh
# Phase 3 DAST: OWASP ZAP against an AUTHORISED TEST environment only (never production).
#   TARGET=https://bess-staging.skjenergy.com sh security/scripts/run-dast.sh
# For an authenticated scan, create a dedicated test user and pass a short-lived bearer token:
#   ZAP_AUTH_TOKEN=<access token of a test user> TARGET=... sh security/scripts/run-dast.sh
set -eu
TARGET="${TARGET:?set TARGET to the staging/test URL}"
case "$TARGET" in *bess.skjenergy.com*) echo "Refusing to scan production"; exit 1;; esac
OUT="$(cd "$(dirname "$0")/../reports/raw" && pwd)"
AUTH_ARGS=""
if [ -n "${ZAP_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS="-z -config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true \
-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization \
-config replacer.full_list(0).replacement=Bearer\ ${ZAP_AUTH_TOKEN}"
fi

# 1. Passive baseline of the web app
docker run --rm -v "$OUT:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t "$TARGET" -r zap-baseline.html -J zap-baseline.json || true

# 2. Active API scan driven by the OpenAPI spec (staging keeps /api/v1/openapi.json enabled)
docker run --rm -v "$OUT:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py \
  -t "$TARGET/api/v1/openapi.json" -f openapi -r zap-api.html -J zap-api.json $AUTH_ARGS || true

# 3. TLS configuration
docker run --rm drwetter/testssl.sh --quiet --severity MEDIUM "$TARGET" | tee "$OUT/testssl.txt" || true

echo "Reports written to $OUT. Triage each alert into security/findings.md."
