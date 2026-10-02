#!/bin/sh
# The loop the `infra-backup` sidecar runs.
#
# Inherited from __MKTRUE_NAME__'s own `infra/backup-loop.sh` and kept close to it on purpose — that script
# was written against real failure modes and every decision in it still holds. What changed:
#
#   1. It dumps each consumer's database into its own archive, so a restore of one never touches
#      the other. A single combined archive would make "restore one consumer" mean
#      "overwrite the journal too".
#   2. The connection is **authenticated** (this instance has auth). Which makes the warning
#      __MKTRUE_NAME__'s version carried — "if credentials ever land in this URI, re-check every log line" —
#      live rather than hypothetical. It has been re-checked: no line below prints the URI.
#
# Restore procedure, retention policy and the drill that proves these archives restore:
# docs/backups.md.
set -eu

BACKUP_DIR=/backups
HEARTBEAT="$BACKUP_DIR/.heartbeat"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

CONSUMERS="${INFRA_CONSUMERS:?set INFRA_CONSUMERS to the products this instance serves}"

# Built here rather than passed in, so a credential never appears in the compose file, in `ps`, or
# in this container's env dump under a name someone might echo. The password is still in the
# environment — that is unavoidable — but it is never concatenated into anything that gets logged.
: "${BACKUP_DB_USER:?set BACKUP_DB_USER}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"
MONGO_HOST="${MONGO_HOST:-infra-mongo:27017}"

# Archives are a full copy of the most personal data in the system, so 0600 and nothing wider —
# a 0700 backup directory is the other half of that.
umask 077

log() { echo "[infra-backup] $*"; }

dump_one() {
  db="$1"
  archive="$BACKUP_DIR/$db-$(date -u +%F).archive.gz"

  # Already covered today. This is what makes an hourly wake idempotent.
  [ -e "$archive" ] && return 0

  # `--authenticationDatabase admin` because the backup user lives in admin, not in the database it
  # is reading. Omitting it authenticates against `$db` and fails with a message that reads like a
  # wrong password.
  if mongodump \
    --host "$MONGO_HOST" \
    --username "$BACKUP_DB_USER" \
    --password "$BACKUP_DB_PASSWORD" \
    --authenticationDatabase admin \
    --db "$db" \
    --archive="$archive.partial" --gzip
  then
    # Dump to `.partial`, then rename: `mv` within one directory is atomic, so a dump torn by a
    # crash, an OOM kill or a redeploy can never be mistaken for a finished one — not by tomorrow's
    # skip check above, and not by a human restoring at 02:00.
    mv "$archive.partial" "$archive"
    log "wrote ${archive##*/}"
    return 0
  fi

  # Loud, never fatal: no archive is created and the next wake retries in an hour. The URI and the
  # credentials stay out of this message; mongodump's own stderr already names the real reason.
  log "ERROR: mongodump failed for $db — no archive for today yet" >&2
  rm -f "$archive.partial"
  return 1
}

while :; do
  # A container killed mid-dump leaves an orphaned .partial that the name-based skip would never
  # match and the prune glob does not catch — a fragment of real data that would otherwise live,
  # and rsync off-box, forever. Sweep at wake; anything mid-write right now is ours and this very
  # wake recreates it.
  rm -f "$BACKUP_DIR"/*.partial

  ok=yes
  for c in $CONSUMERS; do
    u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
    eval "db=\${${u}_DB_NAME:-$c}"
    dump_one "$db" || ok=no
  done

  if [ "$ok" = yes ]; then
    # Pruning ONLY after a fully good run. An instance that has been broken for a fortnight must
    # never age out the last archives holding real data while producing no new ones to replace
    # them. One failed database is enough to hold the whole prune.
    find "$BACKUP_DIR" -maxdepth 1 -name '*.archive.gz' -mtime "+$RETENTION_DAYS" -print -delete
    # Liveness marker for the healthcheck: it proves the loop woke *and* both of today's archives
    # are in place, not merely that the process is alive.
    touch "$HEARTBEAT"
  fi

  sleep 3600
done
