# Contributing to AK820 Pro Control

Thank you for contributing. By submitting a contribution, you agree that it is
licensed under this repository's [MIT License](LICENSE) and that you have the
right to submit it. Do not copy proprietary vendor code, firmware, installers,
private captures, credentials, personal media, or material whose license is
incompatible with this project.

## Before opening a pull request

Every user-facing software update must increment the version consistently in
the workspace, frontend package, Tauri configuration, and UI version constant,
and must add a dated entry to `CHANGELOG.md`. Do not merge an application change
under a previously published version number.

- Read the [Code of Conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md),
  [disclaimer](DISCLAIMER.md), and protocol notes relevant to the change.
- Open an issue before a large feature or protocol change.
- Keep reverse-engineering contributions to independently observed facts and
  original implementations. Describe evidence without committing vendor
  binaries or decompiled source.
- Remove serial numbers, usernames, file paths, API keys, and personal media
  from logs and screenshots.
- Never test against firmware-update or bootloader devices. Do not submit
  flashing, pin-shorting, or physical repair procedures.
- Hardware-write changes need golden packet tests and real-device evidence when
  possible. State clearly when validation is simulation-only.

## Development setup

Requirements are Rust 1.90 through Rustup, Node.js 24, and pnpm 11.19.0.

```bash
git clone https://github.com/allshouldbeready/ak820-pro-macos.git
cd ak820-pro-macos
export PATH="$HOME/.cargo/bin:$PATH"
pnpm install --frozen-lockfile
cargo +1.90.0 test --workspace --locked
pnpm build
pnpm tauri:dev
```

Before submitting, run:

```bash
cargo +1.90.0 fmt --all -- --check
cargo +1.90.0 clippy --workspace --all-targets --locked -- -D warnings
cargo +1.90.0 test --workspace --locked
pnpm tsc --noEmit
pnpm build
```

Use one logical change per pull request and complete the pull request template.
If dependency changes affect a distributed binary, update
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and provide a complete
generated license bundle before publishing that binary.
