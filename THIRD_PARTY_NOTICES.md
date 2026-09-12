# Third-party notices

This source repository does not vendor dependency source trees or proprietary
AJAZZ software. `Cargo.lock` and `pnpm-lock.yaml` pin packages fetched from
their normal registries under each package's own license.

## Upstream project

AJAZZ macOS is derived from
[`wsclx/ak820pro-modder`](https://github.com/wsclx/ak820pro-modder), copyright
2026 wsclx, licensed under the MIT License. The required copyright and
permission notice is preserved in [LICENSE](LICENSE).

## Direct application dependencies

The locked direct runtime dependencies were reviewed on 13 September 2026.
Their declared licenses are:

| Component family | Declared license |
|---|---|
| Tauri and official Tauri plugins | Apache-2.0 OR MIT |
| React, React DOM, Scheduler | MIT |
| Lucide React | ISC |
| Geist variable fonts | OFL-1.1 |
| hidapi-rs | MIT |
| Tokio and Tracing | MIT |
| Serde, image-rs, clap, anyhow, thiserror, time, embedded-graphics | MIT OR Apache-2.0 (package-specific expression) |

Transitive dependencies include permissive and weak-copyleft license
expressions such as MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, MPL-2.0, and
CDLA-Permissive-2.0. Exact package versions and license expressions are
available from the lockfiles and package metadata. No dependency was found
with a declared GPL-only or AGPL license in the locked dependency graph.

This inventory is informational and is not a substitute for the license files
shipped by each dependency. Before publishing a compiled binary, maintainers
must generate and bundle the complete notices, copyright statements, and
license texts required by the exact resolved dependency graph. CI build
artifacts are therefore not published by this repository at present.
