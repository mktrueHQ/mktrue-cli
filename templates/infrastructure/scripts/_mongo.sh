# shellcheck shell=sh
# Shared helper: find the running mongod container, from anywhere on the box.
#
# **Why this exists.** These scripts used to shell out to
# `docker compose -f docker-compose.prod.yml exec`, which only works if your shell happens to be
# sitting in the directory holding that compose file. Under Dokploy nobody's shell is: the repo is
# cloned to a path Dokploy chooses, and you reach the box over SSH in your own home directory. A
# runbook step that silently depends on an undocumented working directory is a step that fails at
# the worst moment.
#
# So the container is found by its **compose service label**, which Docker sets regardless of who
# started the stack or from where. `INFRA_MONGO_CONTAINER` overrides it when you already know the
# name.

mongo_container() {
  if [ -n "${INFRA_MONGO_CONTAINER:-}" ]; then
    printf '%s\n' "$INFRA_MONGO_CONTAINER"
    return 0
  fi

  service="${INFRA_MONGO_SERVICE:-infra-mongo}"
  found=$(docker ps --filter "label=com.docker.compose.service=$service" --format '{{.Names}}' | head -1)

  if [ -z "$found" ]; then
    echo "cannot find a running container for compose service '$service'." >&2
    echo "  is the stack up?   docker ps --format '{{.Names}}'" >&2
    echo "  or name it:        INFRA_MONGO_CONTAINER=<name> $0 ..." >&2
    return 1
  fi

  printf '%s\n' "$found"
}

# `docker exec` rather than `docker compose exec` for the same reason: it needs no compose file and
# no particular directory. The scripts the container runs are already inside it — the compose mounts
# ./scripts read-only at /scripts.
# Arguments go to MONGOSH, after the container name — not to `docker exec`.
#
# The first version had `"$@"` before the container, so `--username` was parsed by docker rather
# than mongosh: every unauthenticated call still worked and every authenticated one failed, which
# reads like wrong credentials rather than a wrong command line. Callers needing docker's own flags
# (`-e` to pass a secret without putting it in `ps`) call `docker exec` directly with
# `$(mongo_container)`.
mongo_exec() {
  container=$(mongo_container) || return 1
  docker exec -i "$container" mongosh --quiet "$@"
}
