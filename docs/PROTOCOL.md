# AK820 Pro Wire Protocol

Living document. Every decoded command lands here with byte layout, semantics, and a reference to the pcap capture it was derived from.

## Transport

Two firmware families are now confirmed. Selection must be based on the HID
collections rather than the USB product ID, which is shared.

- The supplied ANSI driver and the connected bcdDevice `0x0114` keyboard use
  **feature reports** on interface 3 / usage page `0xFF13` for control and a
  4096-byte output report on interface 2 / usage page `0xFF68` for TFT data.
- The previously tested firmware 1.07 uses the AJAZZ online-driver framing on
  `0xFF68`, with a separate `0xFF67` TFT collection.
- **VID `0x0C45`** (Sonix Technology Co. Ltd.) — confirmed against the live device on macOS 2026-05-13. Earlier upstream notes that listed `0x8009` as the VID had it swapped with the PID.
- Known PIDs:
  - `0x8009` — wired and 2.4 GHz dongle modes (shares HID stack)
  - `0xFEFE` — Bluetooth 5.1 mode (separate HID stack, surfaces only when the BT side is paired and active)
  - `0x7140` — ISP/bootloader mode, deliberately excluded from discovery and all operations
- Live enumeration on a wired AK820 Pro returns **9 HID interfaces**: 6× iface 1 (standard keyboard / consumer / system-control endpoints), 1× iface 2, 1× iface 3 (control), 1× iface 0.
- Legacy control calls pass 65 bytes to hidapi: a leading zero required by the
  API for an unnumbered report, followed by the driver's 64-byte payload.

## Known feature families

| Family | Phase | Status | Source |
|---|---|---|---|
| Lighting (20 modes) | 1 | **Decoded; legacy write hardware-tested** | supplied installer + online driver |
| Sleep timer | 2 | Partially decoded | gohv (likely also wrong layout) |
| Clock sync | 2 | **Decoded** | official online driver (`setTftDateTime`) |
| Battery status | 2 | **Decoded** (read) | online-driver (GET_DEVICE_INFO) |
| Onboard profile switch | 2 | **Not decoded** | needs RE |
| Keymap / layers | 3 | **Decoded** (read+write) | online-driver (GET_KEY / SET_KEY) |
| Macros (512 B/slot) | 4 | **Decoded** | online-driver (GET_MACRO / SET_MACRO) |
| TFT display upload | 5 | **Decoded** | online-driver (SET_TFT_USER_ANIMATION) |
| Now-playing / audio-reactive | 6 | Not applicable (host-side) | — |

## Legacy feature-report transport (supplied ANSI installer)

The older Linux projects had the right vendor payload family but treated
`0x04` as the HID report ID. The connected macOS collection has no report IDs;
hidapi therefore needs an extra leading zero. On the wire, `0x04` remains byte
zero of the 64-byte vendor payload.

Lighting writes use this complete transaction:

```text
START  [04 18 ... byte8=01]  -> response
MODE   [04 13 ... byte8=01]  -> response
DATA   [mode R G B ... color brightness speed direction .. 55 AA]
SAVE   [04 02 ...]
FINISH [04 F0 ...]
```

The supplied application waits for START, MODE, and SAVE responses but not for
DATA or FINISH. The macOS implementation always attempts FINISH after an error
so a failed operation does not strand the device transaction state.

### Supplied-driver TFT upload (`0x72`)

The supplied driver uses interface 3 / `0xFF13` for transaction control and
interface 2 / `0xFF68` for 4096-byte image reports. Its sequence is:

1. feature exchange `START` (`04 18`);
2. feature exchange `IMAGE` (`04 72`), with user slot `2` at byte 2 and the
   little-endian 4096-byte report count at bytes 8–9;
3. write every 4096-byte report on `0xFF68`, non-blockingly draining any
   optional input acknowledgement while relying on synchronous HID writes for
   USB backpressure; and
4. feature exchange `SAVE` (`04 02`); and
5. send `FINISH` (`04 F0`) without waiting for a response, closing the device
   transaction so the keyboard's own TFT menu remains responsive.

The animation body begins with a **256-byte** metadata header filled with `FF`:
byte 0 is the frame count and bytes `1..=N` hold each frame delay in 2-ms units,
clamped to `1..=255`. RGB565-LE frames immediately follow at 32768 bytes per
frame, and the tail is padded with `FF` to a 4096-byte report boundary.
Therefore an N-frame transfer is exactly `1 + 8N` reports. The supplied
installer declares `gif_headlength="256"`; disassembly confirms image data is
written at that configured offset. Treating the allocation's extra 4096 bytes
as the header caused 15 white rows to precede every image on hardware.

On macOS, the application's ordinary cached `0xFF13` control handle must be
closed before opening the dedicated TFT data/control pair. Keeping two live
handles to that collection caused `IOHIDDeviceSetReport` to time out before the
first image block was sent. The implementation opens control before data and,
after any failed upload, closes both handles and sends a best-effort `FINISH`
through a newly opened control handle so recovery should not require a power
cycle.

Hardware verification on 2026-09-12 confirmed the control-before-data order:
a 16-frame GIPHY animation completed all 129 reports (`1 + 8 × 16`) and the
final `SAVE` without a transport error. Visual TFT confirmation is recorded
separately because successful HID completion alone does not prove rendering.
After full-timeline sampling and post-SAVE `FINISH` were added, a user-initiated
30-frame GIPHY transfer also completed successfully. The user then visibly
confirmed correct 128×128 alignment and complete-loop playback on the physical
TFT. The browser editor permits up to the supplied driver's declared
`gif_maxframes="140"`; 30 remains its faster default.
The subsequent Quadrants photograph identified the remaining spatial bug: a
15-row white band preceded the intended framebuffer because the encoder used a
4096-byte header instead of the installer's configured 256-byte header.

On 2026-09-12, the exact 65-byte framing and full lighting transaction were
accepted by the connected ANSI keyboard, and the requested static-green result
was visibly confirmed. The legacy clock transaction was also visibly confirmed
with the correct local time. The online-driver `0xAA` frames timed out on both
`0xFF68` and `0xFF13` on this firmware.

### Supplied-driver System settings (`0x17`)

The supplied application's System save path uses `START`, a `04 17` preamble,
one 64-byte settings payload, then `SAVE`. The data bytes are:

| Offset | Meaning |
|---:|---|
| 0 | `00` |
| 1 | `01` |
| 2 | disable Windows key (0/1) |
| 3 | disable Alt+F4 (0/1) |
| 4 | disable Alt+Tab (0/1) |
| 5 | Fn switch (0/1) |
| 6 | sleep preset (0 never, 1 one minute, 2 five minutes, 3 thirty minutes) |
| 8 | key response level (1–5) |
| 62–63 | check bytes `AA 55` |

This transport has no corresponding settings read in the supplied driver, so
the app presents vendor defaults and labels the operation as write-only.

## Online-driver transport (confirmed against AJAZZ firmware 1.07)

- **HID output reports** on a vendor-specific control endpoint (normally usage page `0xFF68`); the large TFT stream uses a separate `0xFF67` endpoint. Both use report ID `0`.
- Each outgoing packet is exactly `reportCount` bytes (64 for AK820 Pro). Multi-chunk transfers segment the payload across packets.
- Outgoing magic: byte 0 = `0xAA`. Incoming response magic: byte 0 = `0x55`.

### Outgoing frame layout (`P()` in the JS source)

```
offset | field
-------+----------------------------------------------
   0   | 0xAA          // magic
   1   | cmd           // E.* command byte (see table)
   2   | lenOrType     // payload byte count for SET ops
   3   | addr & 0xFF
   4   | (addr >> 8) & 0xFF
   5   | optional[0]
   6   | optional[1]   // or last-packet flag (1/0) if optional[1] absent
   7   | optional[2]
   8…N | payload (N = reportCount-1)
```

### Incoming frame layout (`Pe()`)

```
offset | field
-------+----------------------------------------------
   0   | 0x55          // response magic
   1   | cmd
   2   | lenOrType
   3   | addr lo
   4   | addr hi
   8…  | payload
```

## Command table (subset; see online-driver source for full list)

| Command | Value | Notes |
|---|---|---|
| `COMMUNICATION_START` | 1 | |
| `COMMUNICATION_END` | 2 | |
| `SET_FACTORY_RESET` | 15 | optional arg `0xFF` = full reset, etc. |
| `GET_DEVICE_INFO` | 16 | returns firmware, battery, profile, etc. |
| `GET_GAME_MODE` | 17 | |
| `GET_KEY` | 18 | per-key remap |
| **`GET_LED_EFFECT`** | **19 (0x13)** | global lighting (read) |
| `GET_CUSTOM_LED_DATA` | 20 | per-key RGB (read, 512 bytes) |
| `GET_MACRO` | 21 | |
| `GET_FN_KEY` | 22 | Fn-layer remap |
| `GET_DEFAULT_FN_KEY_MATRIX` | 28 | firmware-default Fn layer (read-only, same shape as `GET_FN_KEY`) |
| `GET_DEFAULT_KEY_MATRIX` | 31 | firmware-default base layer (read-only, same shape as `GET_KEY`). Used by the app's "Factory default" button — staged into the keymap draft for user review before write. |
| `SET_GAME_MODE` | 33 | |
| `SET_KEY` | 34 | |
| **`SET_LED_EFFECT`** | **35 (0x23)** | global lighting (write) |
| `SET_CUSTOM_LED_DATA` | 36 | per-key RGB (write) |
| `SET_MACRO` | 37 | |
| `SET_FN_KEY` | 38 | |
| `SET_TEMPORARY_COMMAND_DATA` | 52 | TFT clock and temporary status payloads |
| `SET_LED_BOOT_ANIMATION` | 64 | |
| `SET_TFT_USER_ANIMATION` | 80 | TFT frame upload |
| `SET_TFT_BUILT_IN_INDEX` | 81 | select pre-installed TFT animation |

## TFT clock payload (command 52)

The official online driver sends a ten-byte temporary-data payload:

`[0x5A, 0x01, 0x5A, year % 100, month, day, hour, minute, second, weekday]`

Month is 1–12 and weekday is Sunday = 0 through Saturday = 6. The macOS app
uses local time and validates every field before sending.

## `SET_LED_EFFECT` payload (16 bytes, official format)

```
offset | field          | notes
-------+----------------+-----------------------------------------
   0   | mode           | 0x00–0x13 (20 modes, same enum as gohv)
   1   | red            |
   2   | green          |
   3   | blue           |
   4   | driverSetting  | hardcoded to 0xFF by the official driver
   5   | secondaryRed   | for dual-colour effects
   6   | secondaryGreen |
   7   | secondaryBlue  |
   8   | colorMode      | 0 = mono, >0 = variants (e.g. rainbow)
   9   | brightness     | 0–5
  10   | speed          | 0–5
  11   | direction      | 0=L, 1=D, 2=U, 3=R (matches gohv enum)
  12   | effectModeType |
  13   | 0              | padding
  14   | 0xAA           | checkCodeL (note: high-byte FIRST, inverted vs gohv)
  15   | 0x55           | checkCodeH
```

This 16-byte payload sits at bytes 8–23 of the 64-byte outer frame; the rest is zero-padded.

## Reverse-engineering workflow

1. **Setup**: UTM with Win 11 ARM, AJAZZ AK820 Pro driver installed, USB passthrough enabled.
2. **Capture**: Wireshark + USBPcap, one pcap per atomic action ("set lighting to static red", "remap F1 to ESC", "upload single-frame TFT image").
3. **Diff**: `tools/pcap-parser` extracts feature-report writes only and renders them as a hex stream plus structural diff against the previous capture.
4. **Document here**: byte layout, semantics, edge cases, capture filename.
5. **Implement**: encoder in `crates/ak820-protocol/src/commands/<family>.rs`, decoder if round-trip is needed, unit test against the captured bytes as a fixture.
6. **Verify**: hardware-in-the-loop smoke test via CLI before exposing in UI.

## Capture filename convention

`docs/reverse-engineering/captures/<phase>-<family>-<action>-<seq>.pcapng`

e.g. `phase3-keymap-f1-to-esc-01.pcapng`

(Captures themselves are gitignored — they can be large and may contain irrelevant noise. Reference them by name here.)

## Decoded commands

### `SET_TFT_USER_ANIMATION` (cmd 80, 0x50)

Source: AJAZZ online driver `index-CGDyjcPg.js`, function `Rt()`.

**Per-frame format**: 128 × 128 pixels @ **RGB565 little-endian** = 32 768 bytes/frame. The GC9107 controller on the TFT-Display expects 16-bit colour (5R + 6G + 5B), packed as `[lo, hi]` (LE u16) per pixel in scan order, row-major.

**Animation payload** sent to the device (single concatenated buffer):

```
+-------------------------------------+
|  256-byte frame-delay header       |
|    byte 0     = frame count N      |
|    byte 1..N-1 = delay[i] * 5  ms  |   (per-frame delay, units of 5 ms)
|    byte N     = 0x00  (terminator) |
|    byte N+1..255 = 0xFF (pad)      |
+-------------------------------------+
|  Frame 0 pixels (32 768 bytes)     |
|  Frame 1 pixels (32 768 bytes)     |
|  …                                 |
|  Frame N-1 pixels (32 768 bytes)   |
+-------------------------------------+
```

**Transport — NOT the standard 0xAA frame**:
- Each chunk uses a **bespoke 8-byte header**, not `build_frame()`:

```
byte 0 = 0xAA
byte 1 = 0x50          // SET_TFT_USER_ANIMATION (= cmd 80)
byte 2 = chunkIndex & 0xFF
byte 3 = chunkIndex >> 8
byte 4 = totalChunks & 0xFF
byte 5 = totalChunks >> 8
byte 6 = 0x50          // payload-class magic — JS: (6619136/4096) & 0xFF = 0x50
byte 7 = 0x06          //                       (6619136/4096) >> 8   = 0x06
                        // i.e. constant 0x0650 = 1616 LE u16.
                        // **0.7.0-beta shipped 0x064F by mistake** — the
                        // firmware accepted the upload but never switched
                        // the display from its built-in animation. 0.8.x
                        // restores the correct magic. See HANDOFF § 6.9h.
```

- **Chunk payload size**: read from `device.collections[0].outputReports[0].items[0].reportCount` (the HID descriptor field). Defaults to **4104 bytes** if the descriptor is unavailable → payload = 4104 − 8 (header) = **4096 bytes** per chunk.
- The control interface we currently use (usage_page `0xFF68`) has a 64-byte report. The TFT path needs a different HID interface — likely one of the other 8 interfaces on the AK820 Pro exposes a bigger output-report definition.
- The firmware acks each chunk with **cmd 65 (`SET_LED_USER_ANIMATION`)**, not 80. A response listener must filter on cmd 65 for these uploads.

**Per-frame delay encoding**:
- `delay[i] * 5` means the source supplies an integer in 5-ms units. To replicate a GIF with 100 ms / frame, send `delay = 20` (because 20 × 5 = 100 ms). Max representable: 255 × 5 = 1 275 ms / frame.
- Only N−1 delays are sent in the header (one per transition between frames). The N-th slot is the terminator `0x00`.

**Capacity:** the supplied ANSI driver declares `gif_maxframes="140"`, which is
the editor ceiling. The one-byte wire count can represent up to 255 frames, but
that larger value is not treated as supported without hardware evidence.
Larger GIFs are decimated across the complete source timeline client-side.



### `GET_MACRO` / `SET_MACRO` (cmd 21 / 37)

Source: AJAZZ online driver bundle (functions `Ge` for GET, anonymous SET handler at line ~1370 of pretty-printed `default-protocol.js`).

**Macro storage is a two-tier layout:**

1. **Index page** at address `0`, exactly **400 bytes**, holds 100 slots × 4 bytes:
   - Each slot is a little-endian `u32` = byte offset where that macro's data block begins.
   - Offset `0` means "slot empty / no macro defined". Data offsets are relative to the start of macro storage and ≥ 400 (i.e. they point past the index itself).
2. **Data blocks** packed contiguously starting at offset 400:
   - **Block header (4 B)**:
     - `LE u16` at byte 0..1 = `actionCount * 2` (the driver halves it on read; the doubling likely preserves a legacy press/release pair count)
     - bytes 2..3: reserved, write `0`
   - **Per action (4 B)**:
     - `LE u16` `delay` (ms before *next* action, allowed up to 65535)
     - `u8` `keyCode` (HID usage code; interpretation depends on `actionType`)
     - `u8` `flags`:
       - bit 7 (`0x80`) = `isPress` (1 = key/button down, 0 = up)
       - bits 6..4 = `actionType` source value (`(flags >> 4) & 7`)
   - **`actionType` semantics** (confirmed by hardware test on AK820 Pro fw 1.07):
     - `3` ⇒ **keyboard** event (HID Keyboard Usage Page). Wire flags `0xB0` (press) / `0x30` (release). The AJAZZ recorder sets this when `recorderMode === "keyboard"`.
     - `1` ⇒ **mouse** event. `keyCode` is the button bitmask (1=L, 2=R, 4=M). Wire flags `0x90` (press) / `0x10` (release).
     - `2` ⇒ used internally for some consumer/text macros; collapsed onto wire flags `0x90`/`0x10` (i.e. shares wire bytes with `1`).
   - **Foot-gun**: it's tempting to assume `0x90/0x10` is "keyboard" because the high nibble starts at 1 — that's exactly what the first Phase-4 hardware test got wrong here. A keyboard macro with `keyCode = 11` (HID "H") then went out as a mouse event with button bitmask `0x0B` (left+right+button-4), which on macOS browsers visually surfaces as flickering right-click context menus. Always cross-check against the table above.

**Read path** (`Ge`):
1. `GET_MACRO contentSize=400 addr=0` → 400-byte index.
2. For each slot `u` (0..99) where `addr[u] != 0`:
   - `GET_MACRO contentSize=4 addr=addr[u]` → 4-byte header, derive `actionCount = (header[0]|header[1]<<8) / 2`.
   - `GET_MACRO contentSize=actionCount*4 addr=addr[u]+4` → action bytes.
3. Build `{ macroId, actions[] }`. The driver also stores user-supplied display names locally; the firmware does not persist them.

**Write path**:
1. Validate `0 ≤ macroId < 100` for every supplied macro.
2. Build a fresh 400-byte index (zero-filled). Walk the input list:
   - Skip macros with empty `actions`.
   - For each kept macro, encode its data block (`4 + N*4` bytes) into a working buffer at a running offset (starts at `400`, increments by block size).
   - Write the running offset into `index[macroId*4 .. +4]` as LE u32.
3. `SET_MACRO contentSize=400 addr=0 isNeedLastPacketFlag=false data=index` (first phase — index page).
4. `SET_MACRO contentSize=totalDataBytes addr=400 isNeedLastPacketFlag=true data=concatenatedBlocks` (second phase — data area). The `last_packet=true` flag on the final chunk commits the transaction.
5. If `totalDataBytes == 0` (all macros empty), skip step 4 — the index alone is enough to clear all slots.

**Capacity**:
- 100 macro IDs maximum.
- Total macro storage is `deviceInfo.macroSpaceSize` (typically 512 B by default; AK820 Pro firmware 1.07 reports **3072 B** in our Phase 2 probe, so we treat that field as the budget for index + data combined).
- Per-macro practical max: 320 B (per AJAZZ spec) ≈ ~79 actions.

**Address handling**:
- The `addr` parameter to `SET_MACRO` / `GET_MACRO` is a 16-bit address inside the macro storage region. The frame's bytes 3..4 carry the LE u16 directly; multi-chunk transfers increment `addr` per chunk (matches our existing `get_many` / `set_many` semantics).

### Triggering a stored macro from a key

Assigning a macro to a physical key is a separate operation from storing it — done via `SET_KEY` / `SET_FN_KEY` with a slot value whose first byte is the **page-type for MACRO**. Source: `layout-default-DElMT--A.js` constructs the action as:

```js
{ name: …, page: "MACRO", param1: macroId, param2: triggerMode, param3: triggerMode === 1 ? repeatCount : 0 }
```

which the slot encoder serialises as:

```
byte 0 = 6   // O.MACRO — see the full Page table below
byte 1 = macroId   (0..99)
byte 2 = triggerMode
byte 3 = repeatCount  (only meaningful when triggerMode == 1)
```

Trigger-mode values come from the recorder dropdown:

| `param2` | Label key | Meaning |
|---|---|---|
| 0 | `macro_mask_select1` | Play once on press (default) |
| 1 | `macro_mask_select3` | Repeat N times (N = `param3`, must be ≥1) |
| 2 | `macro_mask_select2` | Loop until pressed again / toggle |

### `O` enum (action page-types) — official AJAZZ values

```
0 DEFAULT      4 SYSTEM_KEY    8  DKS    12 RS
1 MOUSE        5 EXTRA_FUNCTION 9  MT    13 FUNC
2 KEYBOARD     6 MACRO         10 TGL    14 END
3 CONSUMER_KEY 7 CB            11 SOCD   15 MPT
```

> ⚠️ **Foot-gun**: the first Phase-4 hardware test silently no-op'd because an earlier draft of our Rust `Page` enum used `Macro = 4`. Byte 4 is `SYSTEM_KEY`, so the firmware accepted the slot but interpreted `macroId` as a system-key code (= 0 = no-op). Verify any new page-type against the table above before writing a value back to a key slot.
