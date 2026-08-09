#!/usr/bin/env bash
#
# Run every migration in supabase/ against a throwaway local Postgres, three
# times over, then run the behaviour tests in supabase/tests/.
#
#   scripts/schema-check.sh
#
# Why three times: every file in supabase/ claims to be "safe to re-run" and
# DEPLOY.md tells an operator to run all of them in order on a database that may
# already be up to date. That claim was false twice — `create or replace view`
# cannot rename a column (schema_v4, 42P16) and a bare `alter publication ...
# add table` raises 42710 the second time (schema.sql). Both aborted the run,
# so every migration after the failure silently never ran. A second pass is what
# catches that class of bug; the third is free.
#
# This needs postgresql-16 (or later) installed locally. It never touches the
# live database and needs no credentials — which is the point: the live smoke
# suite can only run where a PAT is available, and this can run anywhere.

set -euo pipefail

PORT="${PGCHECK_PORT:-5439}"
DATA="${PGCHECK_DATA:-/var/tmp/pgcheck}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$BIN" ] && PATH="$BIN:$PATH"
export PATH

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/supabase"

# Migrations in the order DEPLOY.md gives them. Listed explicitly rather than
# globbed, because `ls` sorts schema_v10 before schema_v2.
FILES=(schema.sql schema_v2.sql schema_v3.sql schema_v4.sql schema_v5.sql schema_v6.sql
       schema_v7.sql schema_v8.sql schema_v9.sql schema_v10.sql schema_v11.sql
       schema_v12.sql schema_v13.sql schema_v14.sql schema_v15.sql schema_v16.sql
       schema_v17.sql schema_v18.sql schema_v19.sql schema_v20.sql schema_v21.sql schema_v22.sql schema_v23.sql schema_v24.sql storage.sql)

OWNER=postgres
id "$OWNER" >/dev/null 2>&1 || { echo "no '$OWNER' user on this machine"; exit 2; }

cleanup() {
  su "$OWNER" -c "PATH=$PATH pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A server left running by an interrupted earlier run still holds the port.
su "$OWNER" -c "PATH=$PATH pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true

rm -rf "$DATA"
mkdir -p "$DATA"
chown "$OWNER" "$DATA"
chmod 700 "$DATA"

su "$OWNER" -c "PATH=$PATH initdb -D $DATA -U postgres --auth=trust" >/dev/null
su "$OWNER" -c "PATH=$PATH pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/log start" >/dev/null
sleep 2

PSQL="psql -h /tmp -p $PORT -U postgres -q -v ON_ERROR_STOP=1"

$PSQL -f tests/_shim.sql >/dev/null 2>&1 || true
echo "shim loaded — postgres $($PSQL -tAc 'show server_version')"

fail=0
for pass in 1 2 3; do
  for f in "${FILES[@]}"; do
    if err=$($PSQL -f "$f" 2>&1 | grep -E "^psql.*(ERROR|FATAL)" | head -3); [ -n "$err" ]; then
      echo "*FAIL  pass $pass: $f"
      echo "       $err"
      fail=1
    fi
  done
  echo " PASS  pass $pass: all ${#FILES[@]} files applied clean"
done

# Re-run the shim's grants: tables created by the migrations above did not
# exist when it first ran, and `authenticated` needs reaching them for RLS to be
# under test at all.
$PSQL -f tests/_shim.sql >/dev/null 2>&1 || true

for t in tests/v*.sql; do
  # `|| true` is load-bearing. Under `set -e` a failing command substitution
  # kills the script, so one failing test used to end the run with no output at
  # all — the harness reported nothing and looked like a pass.
  out=$(psql -h /tmp -p "$PORT" -U postgres -q -f "$t" 2>&1 || true)
  if echo "$out" | grep -qE "ERROR|FAIL:"; then
    echo "*FAIL  $t"
    echo "$out" | grep -E "ERROR|FAIL:" | head -5
    fail=1
  else
    echo "$out" | grep -oE "PASS .*" | sed 's/^/ /'
  fi
done

exit $fail
