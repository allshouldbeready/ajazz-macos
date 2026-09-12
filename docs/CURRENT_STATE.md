# Current-state model

Every configuration view identifies where its displayed state came from:

- **Read from keyboard** means the firmware returned the value in the current
  session. Online-output lighting, System, keymaps, macros, and per-key RGB use
  this path and re-read after writes.
- **Last applied by AK820 Pro Control** means the supplied-driver firmware or TFT
  protocol has no corresponding read command. The app persists only a
  configuration that it successfully wrote and restores that shadow on the
  next launch.
- No badge means the value is an editable default or selection, not a claim
  about the keyboard's current state.

The supplied-driver lighting selector (`04 13`) was tested as a read-only
query on the connected ANSI keyboard. Its feature response echoed the request
header and returned no lighting payload, matching the Windows utility's use of
a local profile database. Changes made with the keyboard's Fn shortcuts can
therefore make remembered values stale until the app applies a configuration
again.

Connectivity is always live enumeration. TFT diagnostics and custom uploads
are write-only and use the same explicitly labelled shadow. Host-only features
such as automations load from their own local data store.

Legacy battery percentage is a separate exception: the supplied driver exposes
it through the physical 2.4 GHz receiver, not through the wired configuration
endpoint. The app shows it as receiver-sourced and leaves charging status
unknown. Spoofing the driver's host-side connection-mode check does not emulate
the receiver's radio bridge. A zero response or wired query timeout remains
“unavailable”; neither is displayed as zero percent.

Connectivity also asks macOS for the paired AK820 Bluetooth identity. This is
an operating-system observation, not a vendor-protocol read: the app shows a
battery percentage only when macOS publishes one, otherwise it explicitly
distinguishes disconnected from connected-without-battery. It never fabricates
a Bluetooth value or charging state.
