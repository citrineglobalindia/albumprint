#!/usr/bin/env bash
# Runs migrations + rule tests against a scratch Postgres. Usage: PGHOST=/var/tmp PGPORT=5433 PGUSER=postgres ./tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -v ON_ERROR_STOP=1 -q -t -A"
psql -qc "drop database if exists albumprint_test" -c "create database albumprint_test" 2>/dev/null
for f in tests/00_supabase_shim.sql migrations/*.sql; do $P -d albumprint_test -f "$f" >/dev/null; done
for t in tests/[1-9]*_*.sql; do $P -d albumprint_test -f "$t" 2>&1 | sed -n 's/.*NOTICE:  //p;/ERROR/p;/PASSED/p'; done
