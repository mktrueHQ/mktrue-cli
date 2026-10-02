#!/bin/sh
# mktrue's installer (decision 0035). Every step runs inside main, which the
# last line calls, so a truncated download defines functions and runs nothing.
# Even set -eu waits for main: a script cut to "set" would print the environment.

say() {
  printf 'mktrue: %s\n' "$1"
}

refuse() {
  printf 'mktrue: ✗ install · %s\n  why   %s\n  fix   %s\n  exit  %s\n' \
    "$1" "$2" "$3" "$4" >&2
  exit "$4"
}

need() {
  command -v "$1" >/dev/null 2>&1 ||
    refuse "$1 is not installed" "$2" "install $1, then run this again" 3
}

fetch() {
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsL -o "$2" "$1"
}

is_musl() {
  for loader in /lib/ld-musl-*; do
    [ -e "$loader" ] && return 0
  done
  ldd --version 2>&1 | grep -qi musl
}

detect_platform() {
  kernel=$(uname -s)
  machine=$(uname -m)
  case $kernel in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) refuse "no binary for $kernel" "binaries are built for Linux and macOS only" \
      "install with npm i -g mktrue" 3 ;;
  esac
  case $machine in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) refuse "no binary for $machine" "binaries are built for x64 and arm64 only" \
      "install with npm i -g mktrue" 3 ;;
  esac
  if [ "$os" = darwin ] && [ "$arch" = x64 ] &&
    [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && is_musl; then
    refuse "musl libc is not supported" "the binary is built against glibc, as Node is" \
      "install with npm i -g mktrue" 3
  fi
}

check_tools() {
  need curl "it downloads the release over HTTPS"
  need tar "it unpacks the release"
  if [ "$os" = linux ]; then
    need xz "tar needs it to unpack the .tar.xz release"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest_tool=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    digest_tool=shasum
  else
    refuse "neither sha256sum nor shasum is installed" \
      "the release is never installed without its checksum" \
      "install coreutils or perl's shasum, then run this again" 3
  fi
}

digest() {
  if [ "$digest_tool" = sha256sum ]; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi | awk '{ print $1 }'
}

resolve_base() {
  repo=mktrueHQ/mktrue-cli
  base=${MKTRUE_TEST_BASE_URL:-https://github.com/$repo}
  case $base in
    https://*) ;;
    *) refuse "the release URL is not https" "a download over plain HTTP can be altered" \
      "unset MKTRUE_TEST_BASE_URL, or give it an https:// URL" 2 ;;
  esac
}

resolve_version() {
  if [ -n "${MKTRUE_VERSION:-}" ]; then
    version=${MKTRUE_VERSION#v}
  else
    case ${MKTRUE_CHANNEL:-latest} in
      latest)
        landed=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsLI \
          -o /dev/null -w '%{url_effective}' "$base/releases/latest") ||
          refuse "could not find the latest release" "the release page did not answer" \
            "check the network, or set MKTRUE_VERSION" 5
        ;;
      next)
        fetch "$base/releases.atom" "$tmp/releases.atom" ||
          refuse "could not list the releases" "the release feed did not answer" \
            "check the network, or set MKTRUE_VERSION" 5
        landed=$(sed -n 's|.*/releases/tag/\(v[^"<]*\)".*|/releases/tag/\1|p' \
          "$tmp/releases.atom" | head -n 1)
        ;;
      *) refuse "unknown channel ${MKTRUE_CHANNEL}" "the channels are latest and next" \
        "set MKTRUE_CHANNEL=next, or unset it" 2 ;;
    esac
    case $landed in
      */releases/tag/v*) version=${landed##*/releases/tag/v} ;;
      *) refuse "no release is published yet" "there is nothing to install" \
        "install with npm i -g mktrue" 5 ;;
    esac
  fi
  case $version in
    '' | *[!0-9A-Za-z.-]*) refuse "not a version" "a version is x.y.z, or x.y.z-pre" \
      "set MKTRUE_VERSION to a released version, such as 1.2.3" 2 ;;
  esac
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' ||
    refuse "not a version: $version" "a version is x.y.z, or x.y.z-pre" \
      "set MKTRUE_VERSION to a released version, such as 1.2.3" 2
}

download() {
  asset="mktrue-$os-$arch.tar.xz"
  url="$base/releases/download/v$version"
  say "install · v$version · $os-$arch"
  fetch "$url/$asset" "$tmp/$asset" ||
    refuse "could not download $asset" "v$version has no binary for $os-$arch here" \
      "check the network and the version, or install with npm i -g mktrue" 5
  fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS" ||
    refuse "could not download SHA256SUMS" "the release is never installed unchecked" \
      "check the network and the version" 5
}

verify_checksum() {
  expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' \
    "$tmp/SHA256SUMS")
  [ -n "$expected" ] ||
    refuse "SHA256SUMS has no line for $asset" "the download cannot be checked" \
      "do not install this release; report it" 1
  actual=$(digest "$tmp/$asset")
  [ "$actual" = "$expected" ] ||
    refuse "the checksum of $asset does not match" \
      "the file is not the one the release published" \
      "do not install this file; run this again, and report it if it repeats" 1
  say "checksum · ✓ · $asset"
}

verify_provenance() {
  if command -v gh >/dev/null 2>&1; then
    gh attestation verify "$tmp/$asset" --repo "$repo" >/dev/null 2>&1 ||
      refuse "the provenance check failed" \
        "gh found no attestation from $repo for this file" \
        "run gh auth login and try again; if it still fails, report it" 1
    say "provenance · ✓ · $repo"
  else
    say "provenance · skipped · gh is not installed; the checksum held"
  fi
}

unpack() {
  mkdir "$tmp/unpacked"
  tar -xJf "$tmp/$asset" -C "$tmp/unpacked" 2>/dev/null ||
    refuse "could not unpack $asset" "tar could not read the archive" \
      "run this again; report it if it repeats" 1
  if [ ! -f "$tmp/unpacked/mktrue" ] || [ -L "$tmp/unpacked/mktrue" ]; then
    refuse "$asset holds no mktrue binary" "the archive is not what a release ships" \
      "do not install this release; report it" 1
  fi
  chmod 0755 "$tmp/unpacked/mktrue"
}

place() {
  dir=${MKTRUE_INSTALL_DIR:-$HOME/.local/bin}
  mkdir -p "$dir" ||
    refuse "could not create $dir" "the binary needs a directory to live in" \
      "set MKTRUE_INSTALL_DIR to a directory you can write" 3
  mv -f "$tmp/unpacked/mktrue" "$dir/mktrue" ||
    refuse "could not write $dir/mktrue" "the directory is not writable" \
      "set MKTRUE_INSTALL_DIR to a directory you can write" 3
  say "installed · $dir/mktrue"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *)
      say "path · not on PATH · $dir"
      say "path · add it in your shell profile to run mktrue by name"
      ;;
  esac
}

main() {
  set -eu
  detect_platform
  check_tools
  resolve_base
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/mktrue-install.XXXXXX" 2>/dev/null) ||
    refuse "could not make a temporary directory" "downloads are checked there first" \
      "set TMPDIR to a directory you can write" 3
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' HUP INT TERM
  resolve_version
  download
  verify_checksum
  verify_provenance
  unpack
  place
}

main "$@"
