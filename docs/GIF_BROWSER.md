# Online GIF browser and TFT editor

The TFT page searches GIPHY without an AK820 Pro Control proxy. Search requests
originate in the desktop client, and GIPHY receives the API key and search term
directly.

## Provider setup

GIPHY requires an API key from the
[GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Its API
documentation requires client-side search and visible "Powered by GIPHY"
attribution, both of which the app preserves. Tenor is intentionally omitted
because it no longer accepts new API clients.

Keys are stored only in the app's local WebView storage on the current Mac.
They are not committed, synced, logged, or passed to the Rust/HID layer. Users
can clear a saved key by emptying its field.

## Editing and conversion

Selecting a result opens a live 128 × 128 preview. The editor supports:

- fill, contain, and stretch fitting;
- 25–400% zoom;
- horizontal and vertical crop anchoring;
- letterbox/background color;
- 25–400% playback-speed conversion; and
- a 1–140 frame budget, matching the supplied driver's `gif_maxframes="140"`;
  30 remains the fast default. Longer GIFs are sampled across their complete
  timeline, including the final frame, rather than truncating the ending.

Every numeric adjustment can be changed with either its slider or the compact
value field beside it. Typed values are rounded and clamped to the same safe
range on blur or Enter; Escape restores the current slider value.

The editor warns when the budget exceeds 30 frames because a 140-frame RGB565
transfer is approximately 4.4 MiB (1,121 HID reports) and can take several
minutes. The connected legacy firmware requires per-report pacing even when an
acknowledgement is absent; removing that wait made its loader stop at 71%.
Frontend progress events are limited to percentage changes, while cancellation
is checked after every report. Failure recovery and explicit hardware-write
confirmation apply at every budget.

The animated browser preview retains the provider's original playback speed.
Cropping, scaling, and background placement match the Rust conversion model;
speed and frame limits take effect during conversion.

Only HTTPS media URLs on the selected provider's domains are accepted. The
selected rendition is capped at 15 MiB before IPC, source dimensions and
decoder allocation are bounded, and image data is converted to 128 × 128
RGB565 by the reusable protocol crate. The normal session-scoped hardware
confirmation, serialized HID upload, progress reporting, and cancellation
remain in force.
