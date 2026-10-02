# mktrue

## 0.3.1

### Patch Changes

- 7b40506: Your repository's `.github/workflows/mktrue.yml` now installs the exact mktrue version that rendered it from npm, checks its registry signature with `npm audit signatures`, and runs `mktrue check`. It no longer downloads a release with a `MKTRUE_TOKEN` secret. Run `mktrue sync --write`, merge the change, and then delete the `MKTRUE_TOKEN` secret from your repository.

## 0.3.0

### Minor Changes

- edd6e56: The implementer and the ui-engineer run on `opus` at `high` effort, where they ran on `sonnet` at `medium`. Measured on one milestone per tier, the cheaper tier took 3.4 times the calls and twice the agent runs per slice (decision 0037). Run `mktrue sync --write` to take the two agent files.
- f6a80d6: mktrue is released from `mktrueHQ/mktrue-cli`. Each release ships single executables for Linux and macOS, x64 and arm64, with `SHA256SUMS` and `install.sh`. The installer checks the checksum, then the build attestation when `gh` is present, and moves the binary last. The npm package is staged with provenance, and it reaches `latest` only after a device pass.
