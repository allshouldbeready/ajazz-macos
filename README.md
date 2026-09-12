<div align="center">

# AJAZZ macOS

**A macOS-first control application for the ANSI AJAZZ AK820 Pro.**

Lighting, keymaps, macros, system settings, and TFT media through a native
Tauri shell and a reusable Rust HID protocol library.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](docs/PARITY.md)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

</div>

## Status

The official Windows-driver feature surface is implemented, but physical ANSI
verification is still required. In particular, TFT parity is not considered
complete until both a still image and an animated GIF are visibly confirmed on
the keyboard display. See [the parity matrix](docs/PARITY.md).

Configuration requires a wired USB-C data connection. A Bluetooth connection
can identify the keyboard but does not expose the vendor control endpoints.
Settings saved while wired remain in the keyboard's onboard storage for later
wireless use.

## Features

- Device information, battery state, active profile, and capacity reporting
- Clock, sleep timer, and game-mode settings with read-back where supported
- All 20 global RGB modes plus custom per-key RGB
- ANSI base and Fn-layer keymap editing with factory-default staging
- Macro recording, editing, capacity checks, and assignment
- TFT built-in selection, factory reset, PNG/JPEG upload, and animated GIF upload
- In-app GIPHY search with a 128 × 128 crop, resize, speed, and frame editor
- Session-scoped confirmation before the app performs its first hardware write
- CLI diagnostics backed by the same protocol library as the desktop app

Experimental upstream features are intentionally hidden from the first parity
milestone. They may return later after the official feature surface is verified.
The official controls and installer-derived effect catalogue are documented in
[RGB modes](docs/RGB_MODES.md).
How each page distinguishes device read-back from write-only remembered values
is documented in [current-state handling](docs/CURRENT_STATE.md).
Provider setup and media-safety limits are documented in the
[online GIF browser guide](docs/GIF_BROWSER.md).

## Build

Requirements:

- macOS 11 or later on Apple Silicon
- Rust 1.90 installed through Rustup
- Node.js 24 (pnpm 11 requires Node.js 22.13 or later)
- pnpm 11.19.0

Ensure the Rustup shims precede Homebrew's standalone Rust binaries:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version
```

Then install and build with locked dependencies:

```bash
pnpm install --frozen-lockfile
cargo +1.90.0 test --workspace --locked
pnpm build
pnpm tauri:build
```

The unsigned DMG is written beneath
`target/release/bundle/dmg/`. macOS may require a control-click and
Open for an unsigned local build.

## CLI

```bash
cargo +1.90.0 build -p ak820-cli --release --locked
./target/release/ak820 list
./target/release/ak820 probe
./target/release/ak820 info
./target/release/ak820 sync-clock
./target/release/ak820 tft probe
./target/release/ak820 lighting set --mode static --color FF00AA
./target/release/ak820 rgb fill --color 00FF80
./target/release/ak820 macros list
./target/release/ak820 hid-descriptors
```

CLI write commands are explicit user actions and are intended for diagnostics
and hardware verification. Never target firmware-update or bootloader devices.

## Architecture

```text
React UI -> Tauri commands -> ak820-protocol -> hidapi -> keyboard
                              ^
                              |
                           ak820 CLI
```

Protocol framing and device behavior stay in `crates/ak820-protocol`. The
desktop and CLI surfaces are clients of that crate. See
[architecture](docs/ARCHITECTURE.md) and the documented
[wire protocol](docs/PROTOCOL.md).

## Safety and proprietary artifacts

The AJAZZ Windows installer, extracted binaries, web-driver bundles, packet
captures, device identifiers, credentials, and signing material are not part of
this repository. Hardware writes are serialized, bounded, and limited to
configuration commands. This is experimental, unofficial software and can
alter or lose onboard settings. Read the [disclaimer](DISCLAIMER.md),
[security policy](SECURITY.md), and [privacy disclosure](PRIVACY.md) before use.

There are no official public binary releases yet. The package is intentionally
marked `private` in `package.json` to prevent accidental npm publication, and
CI does not publish its unsigned build output. A binary release must include a
complete dependency-license bundle and pass hardware acceptance testing.

## Attribution and license

This repository began as a squashed import of the MIT-licensed
[`wsclx/ak820pro-modder`](https://github.com/wsclx/ak820pro-modder). The
original copyright remains in [LICENSE](LICENSE); additional project and
protocol credits are recorded in [NOTICE.md](NOTICE.md),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and
[docs/PROTOCOL.md](docs/PROTOCOL.md).

AJAZZ macOS is independent and is not endorsed by AJAZZ or Epomaker.
