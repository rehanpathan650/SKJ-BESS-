#!/bin/sh
# Generates a private CA and a server certificate for PostgreSQL TLS (internal network only).
# Run once on the server:  sh infra/postgres/gen-certs.sh
set -eu
cd "$(dirname "$0")"
mkdir -p certs && cd certs
[ -f server.crt ] && { echo "certs already exist"; exit 0; }
openssl req -new -x509 -days 3650 -nodes -subj "/CN=skj-db-ca" -keyout ca.key -out ca.crt
openssl req -new -nodes -subj "/CN=db" -keyout server.key -out server.csr
printf "subjectAltName=DNS:db\n" > san.ext
openssl x509 -req -in server.csr -days 825 -CA ca.crt -CAkey ca.key -CAcreateserial -extfile san.ext -out server.crt
rm -f server.csr san.ext
chmod 600 server.key ca.key
# postgres in the alpine image runs as uid 70
chown 70:70 server.key server.crt 2>/dev/null || true
echo "Created certs/ca.crt and certs/server.{crt,key}. Keep ca.key offline."
