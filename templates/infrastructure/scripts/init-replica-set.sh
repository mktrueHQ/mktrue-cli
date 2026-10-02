#!/bin/sh
# Initiates rs0 on a **fresh** instance — one with an empty data directory.
#
# The production migration does NOT need this: it adopts __MKTRUE_NAME__'s existing files, and rs0's
# configuration comes with them (docs/decisions.md I-002). This exists for the other two cases —
# local development, and a genuine from-scratch rebuild.
#
# Idempotent: if a configuration already exists it reports and exits 0 rather than reconfiguring,
# because `rs.initiate` on a live set is how you lose a replica set.
set -eu
# shellcheck source=scripts/_mongo.sh
. "$(dirname "$0")/_mongo.sh"

# Must match what the apps connect to. On a migrated instance this is already `__MKTRUE_NAME__-mongo:27017`
# and must not be changed here (I-003).
MEMBER_HOST="${RS_MEMBER_HOST:-infra-mongo:27017}"

# No credentials: on a fresh instance no users exist yet, so MongoDB's localhost exception grants
# this connection full access. After bootstrap-users has run, the exception is closed and this
# script's `rs.status()` simply reports that a configuration exists.
mongo_exec --eval "
  try {
    rs.status();
    print('replica set already configured — nothing to do');
    quit(0);
  } catch (e) {
    if (e.codeName !== 'NotYetInitialized') {
      print('cannot read replica set status: ' + e.codeName);
      quit(1);
    }
    printjson(rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '${MEMBER_HOST}' }] }));
  }
"
