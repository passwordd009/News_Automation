#!/usr/bin/env bash
#
# Run the Supabase migrations against a throwaway local Postgres cluster and
# exercise every RLS policy per role.
#
# Supabase itself is not needed: the auth schema, auth.uid() and the
# anon/authenticated/service_role roles are shimmed by shim_local_auth.sql.
# This catches policy mistakes before they reach a real project.
#
#   ./supabase/tests/run_local_rls_tests.sh
#
# Requires the PostgreSQL 16 server binaries (Debian: postgresql-16).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-5433}"
PGHOST="${PGHOST:-/tmp}"
PGDATA="${PGDATA:-${TMPDIR:-/tmp}/hestia-rls-test-cluster}"
RUN_AS="${RUN_AS:-}"          # set to a non-root user when running as root

if [[ ! -x "$PGBIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found at $PGBIN" >&2
  echo "Install them (Debian/Ubuntu: sudo apt-get install postgresql-16) or set PGBIN." >&2
  exit 1
fi

# Postgres refuses to run as root.
if [[ -z "$RUN_AS" && "$(id -u)" -eq 0 ]]; then
  RUN_AS="postgres"
fi

run() {
  if [[ -n "$RUN_AS" ]]; then
    su "$RUN_AS" -c "$1"
  else
    bash -c "$1"
  fi
}

cleanup() {
  run "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

echo "Starting a throwaway PostgreSQL cluster..."
rm -rf "$PGDATA"; mkdir -p "$PGDATA"
[[ -n "$RUN_AS" ]] && chown -R "$RUN_AS" "$PGDATA"

run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGHOST' -l $PGDATA/server.log start" >/dev/null

for _ in {1..20}; do
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done

psql() { command psql -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "Applying the local auth shim (stands in for Supabase)..."
psql -q -f "$HERE/shim_local_auth.sql"

echo "Applying migrations..."
for migration in "$MIGRATIONS"/*.sql; do
  echo "  $(basename "$migration")"
  psql -q -f "$migration"
done

# The signup trigger belongs to Supabase's auth.users; wire it up locally so
# inserting a user creates a profile exactly as it will in production.
psql -q -c "create trigger on_auth_user_created after insert on auth.users
            for each row execute function public.handle_new_user();"

echo "Running policy tests..."
psql -q -f "$HERE/rls_test.sql"
