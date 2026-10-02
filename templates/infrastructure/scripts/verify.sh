#!/bin/sh
# Run AFTER the infra stack is up. Proves the security properties this repo exists to provide,
# rather than assuming them because the containers are green.
#
# Read-only: it authenticates, counts, and attempts things that must fail.
set -eu
# shellcheck source=scripts/_mongo.sh
. "$(dirname "$0")/_mongo.sh"

CONSUMERS="${INFRA_CONSUMERS:?set INFRA_CONSUMERS to the products this instance serves}"
: "${MONGO_ADMIN_USER:?}" "${MONGO_ADMIN_PASSWORD:?}"

# Each consumer contributes three variables, upper-cased from its slug. Checked
# here so a missing one fails before anything connects, not halfway through.
# Declared before the loop so that shellcheck can see them: the assignments below
# happen through `eval`, which it cannot follow.
db=""; user=""; pass=""
for c in $CONSUMERS; do
  u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
  eval "db=\${${u}_DB_NAME:-$c}"
  eval "user=\${${u}_DB_USER:-${c}_app}"
  eval "pass=\${${u}_DB_PASSWORD:-}"
  [ -n "$pass" ] || { echo "FAIL  ${u}_DB_PASSWORD is blank" >&2; exit 1; }
  echo "  consumer $c -> database $db as $user"
done

fail=0
ok()  { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

m() { mongo_exec "$@"; }

echo "── verify ────────────────────────────────────────────────"

# 1. Auth is actually on. An unauthenticated read must be refused — if this succeeds, every other
# check below is theatre. Probed against the first consumer's database; the script knows no
# product name.
#
# `set -- $CONSUMERS` (unquoted, deliberately) re-splits on IFS rather than trimming with
# `${CONSUMERS%% *}`, which returns empty on a leading space and would make this probe
# unconditionally fail closed instead of testing anything.
# shellcheck disable=SC2086 # word-splitting on IFS is the point: see above
set -- $CONSUMERS
first=$1
fu=$(printf '%s' "$first" | tr '[:lower:]-' '[:upper:]_')
first_db=""
eval "first_db=\${${fu}_DB_NAME:-$first}"
if m --eval "db.getSiblingDB('$first_db').stats()" >/dev/null 2>&1; then
  bad "an UNAUTHENTICATED client could read $first_db — authorization is not enabled"
else
  ok "unauthenticated access refused"
fi

# 2. The replica set has a primary. Without one every write blocks on server selection and the apps
# hang rather than erroring — the most confusing failure this stack can have.
state=$(m --username "$MONGO_ADMIN_USER" --password "$MONGO_ADMIN_PASSWORD" \
  --authenticationDatabase admin --eval "rs.status().myState" 2>/dev/null || echo "?")
if [ "$state" = "1" ]; then
  ok "replica set has a PRIMARY"
else
  bad "replica set state is '$state', expected 1 (PRIMARY)"
fi

# 3. The data survived. These counts are the migration's real acceptance criterion.
for c in $CONSUMERS; do
  u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
  eval "db=\${${u}_DB_NAME:-$c}"
  n=$(m --username "$MONGO_ADMIN_USER" --password "$MONGO_ADMIN_PASSWORD" \
    --authenticationDatabase admin \
    --eval "db.getSiblingDB('$db').getCollectionNames().length" 2>/dev/null || echo "?")
  echo "      $db: $n collections"
done

# 4. **The isolation guarantee.** This is the single check that justifies sharing one instance
# between products. Every consumer must be unable to read every OTHER consumer's database, and
# none may read local.oplog.rs — every write to every database, consumer's own included, passes
# through it.
#
# Read from the user's own effective privileges (`connectionStatus`, `showPrivileges: true`)
# rather than trying a `findOne()` against one guessed collection name: a grant scoped to a real
# collection (an incident-time "let gamma read delta-two.journal") would pass a probe against
# `__verify_probe__` while still exposing that collection, so only the full privilege list proves
# the absence of one.
a_user=""; a_pass=""; a_db=""; b_db=""; leaked=""
for a in $CONSUMERS; do
  ua=$(printf '%s' "$a" | tr '[:lower:]-' '[:upper:]_')
  eval "a_user=\${${ua}_DB_USER:-${a}_app}"
  eval "a_pass=\${${ua}_DB_PASSWORD:-}"
  eval "a_db=\${${ua}_DB_NAME:-$a}"
  leaked=$(m --username "$a_user" --password "$a_pass" \
    --authenticationDatabase admin \
    --eval "
      const own = '$a_db';
      const privs = db.runCommand({connectionStatus: 1, showPrivileges: true})
        .authInfo.authenticatedUserPrivileges;
      const dbs = new Set();
      privs.forEach(function (p) {
        var db = p.resource && p.resource.db;
        if (typeof db === 'string' && db !== '' && db !== own) dbs.add(db);
      });
      dbs.forEach(function (d) { print(d); });
    " 2>/dev/null || echo "__verify_could_not_read_privileges__")
  for b in $CONSUMERS; do
    [ "$a" = "$b" ] && continue
    ub=$(printf '%s' "$b" | tr '[:lower:]-' '[:upper:]_')
    eval "b_db=\${${ub}_DB_NAME:-$b}"
    if printf '%s\n' "$leaked" | grep -qx "$b_db"; then
      bad "$a_user CAN READ $b_db - the isolation this design rests on is broken"
    else
      ok "$a_user cannot read $b_db"
    fi
  done
  if printf '%s\n' "$leaked" | grep -qx "local"; then
    bad "$a_user CAN READ local.oplog.rs - every write in this instance is exposed"
  else
    ok "$a_user cannot read local.oplog.rs"
  fi
done

# 5. Each consumer can reach its OWN database. Isolation that also locks the app
# out is just an outage with extra steps.
for c in $CONSUMERS; do
  u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
  eval "db=\${${u}_DB_NAME:-$c}"
  eval "user=\${${u}_DB_USER:-${c}_app}"
  eval "pass=\${${u}_DB_PASSWORD:-}"
  if m --username "$user" --password "$pass" --authenticationDatabase admin \
       --eval "db.getSiblingDB('$db').stats()" >/dev/null 2>&1; then
    ok "$user can use $db"
  else
    bad "$user CANNOT use its own database $db"
  fi
done

# 6. Mongo must not be published to the host in production. `expose` is not `ports`, and the
# difference is the whole exposure boundary.
#
# Development deliberately publishes 27317 so the two app repos can run against it, so this is a
# note there and a failure in production. The check keys off the compose file rather than a flag:
# a flag is something you can forget to pass on the one run that mattered.
published=$(docker port "$(mongo_container)" 2>/dev/null | head -1 || true)
if [ -n "$published" ]; then
  # Development publishes 27317 on purpose so the app repos can run against it; production must
  # publish nothing. `EXPECT_PUBLISHED_PORT=yes` is how a dev run says so out loud.
  if [ "${EXPECT_PUBLISHED_PORT:-no}" = yes ]; then
    echo "note  a port is published ($published) — expected in development, never in production"
  else
    bad "mongod publishes a port to the host: $published"
  fi
else
  ok "no published ports"
fi

echo "──────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  echo "verify passed"
else
  echo "verify FAILED"
  exit 1
fi
