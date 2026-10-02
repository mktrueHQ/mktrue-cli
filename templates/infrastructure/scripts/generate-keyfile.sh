#!/bin/sh
# Generates the replica-set internal-authentication keyfile.
#
# Run ONCE, on the host, before the first deploy. The keyfile is a shared secret between replica
# set members — with one member it is still required, because `authorization: enabled` on a replica
# set demands internal auth.
#
# **It is not committed and not in Dokploy's env.** It is a file on the box, mounted read-only. A
# 1024-character secret does not belong in an env editor's textarea, and mongod wants a file
# regardless.
set -eu

KEYFILE="${1:-/volumes-__MKTRUE_NAME__/infra/keyfile}"

if [ -e "$KEYFILE" ]; then
  echo "refusing: $KEYFILE already exists — rotating it needs every member restarted together" >&2
  echo "if you really mean to rotate, move the old one aside first and read docs/security.md" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYFILE")"
# 756 bytes of base64 lands comfortably inside mongod's 6–1024 character window.
openssl rand -base64 756 > "$KEYFILE"

# mongod refuses to start if the keyfile is group- or world-readable. 400 and the container's
# mongodb user (uid 999 in the official image) are both required — getting either wrong produces
# a boot failure that reads like a corruption problem.
chmod 400 "$KEYFILE"
chown 999:999 "$KEYFILE" 2>/dev/null || {
  echo "note: could not chown to 999:999 — run this as root, or mongod will refuse the keyfile" >&2
}

echo "wrote $KEYFILE (mode 400, owner 999:999)"
echo "back it up somewhere you can reach without this box: a lost keyfile means a replica set that"
echo "cannot authenticate its own members."
