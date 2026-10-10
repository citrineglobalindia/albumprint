#!/usr/bin/env bash
# Local backend for development/testing without Supabase: Postgres + the same migrations + PostgREST + a GoTrue-compatible auth stub.
#   PGHOST=/var/tmp PGPORT=5433 PGUSER=postgres supabase/local/start.sh      (needs a running Postgres 15+ and curl)
# Then run the app with:  VITE_USE_SUPABASE=true VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local npm run dev
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=supabase/local/.bin; mkdir -p $BIN
if [ ! -x $BIN/postgrest ]; then
  curl -sSL -o $BIN/pgrst.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xf $BIN/pgrst.tar.xz -C $BIN && rm $BIN/pgrst.tar.xz
fi
DB=${LOCAL_DB:-albumprint_local}; API_PORT=${API_PORT:-54321}; PGRST_PORT=${PGRST_PORT:-3000}   # override all three to run several backends side by side
P="psql -v ON_ERROR_STOP=1 -q -t -A"
psql -qc "drop database if exists $DB" -c "create database $DB" 2>/dev/null
for f in supabase/tests/00_supabase_shim.sql supabase/migrations/*.sql; do $P -d $DB -f "$f" >/dev/null; done
$P -d $DB -f supabase/local/seed.sql >/dev/null
$P -d $DB -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated to authenticator; grant usage on schema public to anon;" >/dev/null
export PGRST_DB_URI="postgres://authenticator@/$DB?host=${PGHOST:-/var/tmp}&port=${PGPORT:-5433}"
export PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="local-dev-secret-local-dev-secret-0123456789" PGRST_SERVER_PORT=$PGRST_PORT
$BIN/postgrest > supabase/local/.postgrest-$API_PORT.log 2>&1 &
echo $! > supabase/local/.postgrest-$API_PORT.pid
PORT=$API_PORT POSTGREST_URL=http://127.0.0.1:$PGRST_PORT DATABASE_URL="postgres://postgres@/$DB?host=${PGHOST:-/var/tmp}&port=${PGPORT:-5433}" node supabase/local/auth-server.mjs > supabase/local/.auth-$API_PORT.log 2>&1 &
echo $! > supabase/local/.auth-$API_PORT.pid
sleep 2; echo "local backend up: http://localhost:$API_PORT  (admin: admin@albumpro.local / AlbumPro-Local-1)"
