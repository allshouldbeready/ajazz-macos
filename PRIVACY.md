# Privacy

AK820 Pro Control has no project-operated telemetry, analytics service, account
system, advertising service, or listening network port.

Most processing is local: keyboard settings are exchanged over USB HID and app
preferences are stored in the macOS webview profile. Optional features have the
following data flows:

- **Display preview:** the fitted frames from the last successful image or GIF
  upload are retained in `last-display-preview.bin` in the local app-data
  directory. This lets the miniature keyboard play the animation after restart.
  A subsequent successful upload replaces it; a successful display factory
  reset removes it. Preview playback makes no network or keyboard requests.

- **GIPHY search:** after the user supplies an API key and submits a search,
  the app sends that key and search terms directly to GIPHY and downloads the
  selected media from GIPHY-controlled hosts. The key is stored in localStorage
  on that Mac. GIPHY's terms and privacy policy apply.
- **iCloud Drive sync:** when the user enables it, automation data is copied to
  the legacy `ajazz-macos` folder in the user's iCloud Drive. The legacy folder
  name is retained so existing beta users do not lose sync continuity. Apple's
  iCloud terms and privacy practices apply.
- **Now Playing:** the app can query the local Music or Spotify desktop app
  through macOS automation APIs. The project does not receive that data.
- **Automations:** user-created AppleScript, Shortcuts, and shell commands run
  locally with the user's permissions. Their contents and effects are the
  user's responsibility.

The project maintainers do not receive any of the above data unless a user
chooses to include it in an issue, security report, or other communication.
Never post API keys, device serial numbers, personal media, packet captures, or
logs containing personal paths to a public issue.
