#!/bin/sh
# Run BEFORE the first infra deploy. Every check here guards a way the migration can lose data or
# fail in a confusing way.
#
# It changes nothing. Read the output, fix what it names, run it again.
set -eu

DATA_DIR="${MONGO_DATA_DIR:?set MONGO_DATA_DIR to the existing mongo data path}"
KEYFILE="${MONGO_KEYFILE:-/volumes-__MKTRUE_NAME__/infra/keyfile}"
fail=0
note() { echo "  $*"; }
bad()  { echo "FAIL  $*"; fail=1; }
ok()   { echo "ok    $*"; }

echo "── preflight ─────────────────────────────────────────────"

# 1. THE ONE THAT MATTERS MOST. Two mongod processes writing one data directory corrupts it, and
# the corruption is not always immediate or obvious. Any other mongod must be stopped before
# this instance is allowed near its files.
if docker ps --format '{{.Names}}' | grep -qi '__MKTRUE_NAME__.*mongo'; then
  bad "a __MKTRUE_NAME__ mongo container is still running — stop the __MKTRUE_NAME__ stack first"
  note "docker ps --format '{{.Names}}' | grep mongo"
  note "two mongods on one data directory is the one mistake with no clean recovery"
else
  ok "no other mongo container is running"
fi

# 2. The data directory has to be the real one. A typo here silently starts an EMPTY instance, the
# apps connect, and it looks like every journal entry is gone.
if [ ! -d "$DATA_DIR" ]; then
  bad "MONGO_DATA_DIR does not exist: $DATA_DIR"
elif [ ! -f "$DATA_DIR/WiredTiger" ]; then
  bad "$DATA_DIR exists but holds no WiredTiger database"
  note "this is either the wrong path, or a genuinely empty directory — do not proceed on a guess"
else
  ok "data directory looks like a live mongod dbPath"
  note "$(find "$DATA_DIR" -maxdepth 1 -name 'collection-*' | wc -l) collection files present"
fi

# 3. The replica set identity lives in `local`. Its presence is what lets this instance adopt the
# data with no dump and no restore.
if [ -d "$DATA_DIR" ] && find "$DATA_DIR" -maxdepth 1 -name '*.wt' -print -quit | grep -q .; then
  ok "storage files present — rs0's configuration should come with them"
else
  note "could not confirm replica set files; check the mongod log on first boot"
fi

# 4. A backup taken before the migration is the only thing that makes any of this reversible.
LATEST=$(find "${BACKUP_DIR:-/volumes-__MKTRUE_NAME__/backups}" -name '*.archive.gz' -mtime -1 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  bad "no archive from the last 24h under ${BACKUP_DIR:-/volumes-__MKTRUE_NAME__/backups}"
  note "take one from the RUNNING __MKTRUE_NAME__ mongo, and copy it off this box, before going further"
else
  ok "recent backup present: $(basename "$LATEST")"
fi

# 5. mongod refuses to start on a keyfile it considers too readable, and the error reads like
# corruption rather than permissions.
if [ ! -f "$KEYFILE" ]; then
  bad "keyfile missing: $KEYFILE — run scripts/generate-keyfile.sh"
else
  mode=$(stat -c '%a' "$KEYFILE" 2>/dev/null || echo "?")
  owner=$(stat -c '%u:%g' "$KEYFILE" 2>/dev/null || echo "?")
  if [ "$mode" = "400" ]; then ok "keyfile mode 400"; else bad "keyfile mode is $mode, must be 400"; fi
  if [ "$owner" = "999:999" ]; then
    ok "keyfile owned by 999:999"
  else
    bad "keyfile owner is $owner, must be 999:999"
  fi
fi

# 6. Passwords must exist before bootstrap, not be discovered missing halfway through it.
for v in MONGO_ADMIN_PASSWORD BACKUP_DB_PASSWORD; do
  eval "value=\${$v:-}"
  if [ -n "$value" ]; then ok "$v is set"; else bad "$v is blank"; fi
done
for c in ${INFRA_CONSUMERS:-}; do
  u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
  eval "value=\${${u}_DB_PASSWORD:-}"
  if [ -n "$value" ]; then ok "${u}_DB_PASSWORD is set"; else bad "${u}_DB_PASSWORD is blank"; fi
done

echo "──────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  echo "preflight passed — safe to bring the infra stack up"
else
  echo "preflight FAILED — fix the above before deploying"
  exit 1
fi
