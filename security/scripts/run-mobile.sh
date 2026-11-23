#!/bin/sh
# Phase 5 Android: automated static analysis of a built APK with MobSF (OWASP MASVS-oriented).
#   APK=./skj-bess-preview.apk sh security/scripts/run-mobile.sh
# Then complete the manual MASTG checklist in security/android-masvs-checklist.md on a test device.
set -eu
APK="${APK:?path to the preview APK}"
OUT="$(cd "$(dirname "$0")/../reports/raw" && pwd)"
KEY="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
docker run -d --rm --name skj-mobsf -e MOBSF_API_KEY="$KEY" -p 127.0.0.1:8008:8000 opensecurity/mobile-security-framework-mobsf:latest
trap 'docker stop skj-mobsf >/dev/null' EXIT
sleep 40
HASH=$(curl -s -F "file=@$APK" -H "Authorization: $KEY" http://127.0.0.1:8008/api/v1/upload | sed 's/.*"hash": *"\([^"]*\)".*/\1/')
curl -s -X POST --form-string "hash=$HASH" -H "Authorization: $KEY" http://127.0.0.1:8008/api/v1/scan >/dev/null
curl -s -X POST --form-string "hash=$HASH" -H "Authorization: $KEY" http://127.0.0.1:8008/api/v1/report_json -o "$OUT/mobsf.json"
curl -s -X POST --form-string "hash=$HASH" -H "Authorization: $KEY" http://127.0.0.1:8008/api/v1/download_pdf -o "$OUT/mobsf.pdf"
echo "MobSF report: $OUT/mobsf.pdf"
