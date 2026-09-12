# Installing AK820 Pro Control

`AK820 Pro Control` is currently distributed as source. There are no official public
binaries. A future release must be signed, notarized, hardware-tested, and
include complete third-party license notices.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Rust** | 1.90 | Pinned by `rust-toolchain.toml`. |
| **Node.js** | 24 | pnpm requires Node.js 22.13 or later. |
| **pnpm** | 11.19.0 | Pinned by `package.json`. |
| **macOS** | 11+ (Big Sur) | The Tauri shell ships with this minimum target. |

```bash
# macOS (Homebrew):
brew install rustup-init pnpm
rustup-init -y --default-toolchain stable
nvm install 24  # or any Node 24 source you trust

# Verify
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version    # → rustc 1.90.x …
node --version     # → v24.x.x
pnpm --version     # → 11.19.x
```

## Build the desktop app

```bash
git clone https://github.com/allshouldbeready/ak820-pro-macos.git
cd ak820-pro-macos
pnpm install --frozen-lockfile

# Production-style bundle (creates target/release/bundle/dmg/*.dmg)
pnpm tauri:build

# Or just the .app for quick testing
pnpm tauri:build --bundles app
```

Open your locally built `.dmg`, drag **AK820 Pro Control.app** into Applications, and launch.

> The local build is unsigned and not notarized. macOS may require you to
> control-click the app, choose **Open**, and confirm. Only bypass Gatekeeper
> for a build you produced from a revision you inspected.

## Build just the CLI

If you don't need the GUI:

```bash
cargo build -p ak820-cli --release
./target/release/ak820 --help
```

This produces a single statically-linked binary (~3 MB) you can copy into `/usr/local/bin` if you like:

```bash
cp ./target/release/ak820 /usr/local/bin/
ak820 list
```

## Development mode

For frontend / app iteration:

```bash
pnpm tauri:dev
```

This runs `pnpm build` first (static frontend → `dist/`) and then launches Tauri pointed at the static dist. **Do not** try to wire Tauri at `pnpm dev` (the Vite dev server) — WKWebView consistently hangs on the dev-server's HMR socket. See [`HANDOFF.md`](HANDOFF.md) § 6.2 for the gory details.

For just the React frontend (no live device — useful for layout / styling work):

```bash
pnpm dev   # serves at http://localhost:5173, but Tauri APIs won't be available
```

## Tests

```bash
# Rust unit tests across the workspace
cargo test --workspace

# TypeScript typecheck
pnpm tsc --noEmit

# Frontend production build (catches JSX runtime errors)
pnpm build
```

## Hardware-in-the-loop verification

Plug in the AK820 Pro and run:

```bash
./target/release/ak820 list           # Should list 9 HID interfaces
./target/release/ak820 probe          # "Connected: true"
./target/release/ak820 info           # Firmware, battery, profile
```

If `list` returns nothing, the device isn't connected on USB / 2.4 GHz / BT. If it returns 9 interfaces but `probe` errors with "Device not found", check that another app (the official AJAZZ tool, another instance of this app, etc.) isn't holding the HID handle exclusively.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cargo build` fails on `hidapi` | Missing libusb headers on Linux | `sudo apt install libusb-1.0-0-dev libudev-dev` |
| `pnpm tauri:dev` shows a black window | Hit Vite-dev-server hang | Make sure `tauri.conf.json` has `"frontendDist": "../dist"` (it does, by default) |
| `⌘+R` doesn't reload | Tauri 2 ships no menu by default | Already wired in `src-tauri/src/lib.rs::setup()` — your build is stale, rerun `pnpm tauri:dev` |
| `Error: hid_open_path: exclusive access` | Another process owns the HID handle | Quit any other AK820 controller, close other instances of this app |
| App freezes when clicking certain tabs | `std::sync::Mutex` deadlock pattern | Already fixed in 0.5.0-beta+. If you see this on a recent build, file a bug. |
| Macros don't fire on F-row keys | macOS hardware switch on the back is set to "Mac" — firmware preempts the F-row with media keys | Use the **Fn** layer in the Keymap view (Fn + F-key triggers your macro), or switch the back of the keyboard to "Win" mode |

For anything not covered above, see [`docs/HANDOFF.md`](HANDOFF.md) for the full foot-gun catalogue or open an [issue](https://github.com/allshouldbeready/ak820-pro-macos/issues/new/choose).
