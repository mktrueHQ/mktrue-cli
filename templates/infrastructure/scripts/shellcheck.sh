#!/bin/sh
set -eu

# decision 0021. Refresh with `docker pull koalaman/shellcheck:v0.10.0` and the
# new `RepoDigests` entry from `docker image inspect`.
IMAGE="koalaman/shellcheck:v0.10.0@sha256:2097951f02e735b613f4a34de20c40f937a6c8f18ecb170612c88c34517221fb"

docker run --rm --network none -v "$PWD:/mnt:ro" -w /mnt "$IMAGE" scripts/*.sh
