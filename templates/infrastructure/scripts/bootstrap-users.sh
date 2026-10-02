#!/bin/sh
# Creates or repairs the instance's users, in either state it can be in.
#
# Runs from anywhere on the box — it finds the container by label rather than assuming your shell is
# in the compose directory (see _mongo.sh). Under Dokploy, nobody's shell is.
#
# It uses `docker exec` rather than a network connection because on a virgin instance the only way
# in is MongoDB's localhost exception, which is granted only to a connection arriving on the
# container's own loopback.
#
# No credentials on the mongosh command line: the script authenticates itself from the environment.
# An argument list is visible in `ps` to anything else on the box, and these are the instance's root
# credentials.
#
# The script knows no product names: every consumer's three variables are forwarded by reading
# INFRA_CONSUMERS, the same list bootstrap-users.js reads to build its own user list.
set -eu
# shellcheck source=scripts/_mongo.sh
. "$(dirname "$0")/_mongo.sh"

CONSUMERS="${INFRA_CONSUMERS:?set INFRA_CONSUMERS to the products this instance serves}"
: "${MONGO_ADMIN_PASSWORD:?set MONGO_ADMIN_PASSWORD}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"

container=$(mongo_container)

set -- -e MONGO_ADMIN_USER -e MONGO_ADMIN_PASSWORD -e BACKUP_DB_USER -e BACKUP_DB_PASSWORD \
  -e INFRA_CONSUMERS -e ROTATE_PASSWORDS
for c in $CONSUMERS; do
  u=$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')
  set -- "$@" -e "${u}_DB_NAME" -e "${u}_DB_USER" -e "${u}_DB_PASSWORD"
done

docker exec -i "$@" "$container" mongosh --quiet --file /scripts/bootstrap-users.js
