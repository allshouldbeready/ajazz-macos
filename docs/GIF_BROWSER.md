# Online GIF browser and TFT editor

The TFT page can search GIPHY or Tenor without an AJAZZ macOS proxy. Search
requests originate in the desktop client, and the selected provider receives
the API key and search term directly.

## Provider setup

- GIPHY requires an API key from the
  [GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Its
  API documentation requires client-side search and visible "Powered by
  GIPHY" attribution, both of which the app preserves.
- Tenor v2 requires an existing Google Cloud Tenor API key and a stable
  `client_key`. Google states that new Tenor API clients have not been
  accepted since January 2026, so this option is retained for people who
  already have a key.

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
- a 1–30 frame budget. Longer GIFs are sampled across their complete timeline,
  including the final frame, rather than truncating the animation's ending.

The animated browser preview retains the provider's original playback speed.
Cropping, scaling, and background placement match the Rust conversion model;
speed and frame limits take effect during conversion.

Only HTTPS media URLs on the selected provider's domains are accepted. The
selected rendition is capped at 15 MiB before IPC, source dimensions and
decoder allocation are bounded, and image data is converted to 128 × 128
RGB565 by the reusable protocol crate. The normal session-scoped hardware
confirmation, serialized HID upload, progress reporting, and cancellation
remain in force.
