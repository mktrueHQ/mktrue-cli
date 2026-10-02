#!/bin/sh
# Restores ONE database from ONE archive.
#
#   ./scripts/restore.sh __MKTRUE_NAME__ /volumes-__MKTRUE_NAME__/infra/backups/__MKTRUE_NAME__-2026-09-10.archive.gz
#
# **Refuses to run without --confirm.** A restore overwrites live data, and the moment you need one
# is the moment you are least able to double-check a command line. Run it once to see what it would
# do, then again with --confirm.
#
# Restoring into a *scratch* database first is almost always the right move — it proves the archive
# is good without betting the live one on it. `--into` does that:
#
#   ./scripts/restore.sh __MKTRUE_NAME__ <archive> --into __MKTRUE_NAME___restore_test
set -eu
# shellcheck source=scripts/_mongo.sh
. "$(dirname "$0")/_mongo.sh"

DB="${1:?usage: restore.sh <db> <archive> [--into <db>] [--confirm]}"
ARCHIVE="${2:?usage: restore.sh <db> <archive> [--into <db>] [--confirm]}"
shift 2

TARGET="$DB"
CONFIRM=no
while [ $# -gt 0 ]; do
  case "$1" in
    --into) TARGET="${2:?--into needs a database name}"; shift 2 ;;
    --confirm) CONFIRM=yes; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RESTORE_DIR="${INFRA_BACKUP_MOUNT:-/backups}"
: "${MONGO_ADMIN_USER:?set MONGO_ADMIN_USER}"
: "${MONGO_ADMIN_PASSWORD:?set MONGO_ADMIN_PASSWORD}"

echo "restore plan"
echo "  archive : $ARCHIVE"
echo "  from db : $DB"
echo "  into db : $TARGET"
[ "$TARGET" = "$DB" ] && echo "  ** this OVERWRITES the live database **"

if [ "$CONFIRM" != yes ]; then
  echo
  echo "dry run. re-run with --confirm to actually restore."
  exit 0
fi

# `--drop` drops each collection as it restores it, so the result is the archive's contents rather
# than a merge of the archive over whatever is there. A merge is almost never what someone means by
# "restore", and finding out afterwards is expensive.
docker exec -i \
  -e MONGO_ADMIN_USER -e MONGO_ADMIN_PASSWORD "$(mongo_container)" \
  mongorestore \
    --username "$MONGO_ADMIN_USER" --password "$MONGO_ADMIN_PASSWORD" \
    --authenticationDatabase admin \
    --archive="$RESTORE_DIR/$(basename "$ARCHIVE")" --gzip \
    --nsFrom "$DB.*" --nsTo "$TARGET.*" \
    --drop

echo "restored into $TARGET"
