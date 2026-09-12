# Windows Driver Parity

The supplied ANSI installer is the reference for the first product milestone.
The proprietary installer and extracted files are intentionally not included.

| Feature family | Implementation | Automated verification | Hardware verification |
|---|---|---|---|
| Wired discovery and device information | Transport detection implemented; legacy configuration read-back unavailable | Rust tests and CLI probe | 9 collections enumerated; legacy control selected |
| Battery | Online firmware read, supplied-driver 2.4 GHz receiver query, and read-only macOS Bluetooth status; wired legacy explicitly unavailable | Exact 33-byte receiver request/response golden tests, zero/unavailable handling, macOS report parser tests, and bounds checks | Corrected wired spoof timed out as expected; receiver and connected-Bluetooth percentages pending |
| Bluetooth-only guidance | Implemented, including paired/connected/battery provenance | Parser tests and frontend build | Paired/disconnected state confirmed; connected mode pending |
| Clock, sleep, and game settings | Clock implemented on both transports; remaining legacy mappings pending | Clock golden packets and encoder/parser tests | Legacy clock visibly confirmed correct on ANSI hardware |
| 20 global RGB effects | Legacy and online writes implemented | Golden payload tests | Static-green legacy write visibly confirmed on ANSI hardware |
| Per-key RGB | Implemented | Encode/decode tests | Pending ANSI wired device |
| Base and Fn keymaps | Implemented | Round-trip codec tests | Pending ANSI wired device |
| Macros | Implemented | Bounds and codec tests | Pending ANSI wired device |
| TFT built-in/default selection | Implemented | Command tests | Pending visible confirmation |
| PNG/JPEG TFT upload | Implemented | Decode/fit/RGB565 tests | Pending visible confirmation |
| Animated GIF TFT upload | Implemented; 1–140 frame budget, full-timeline sampling, and corrected 256-byte legacy header | Decode, frame-budget, final-frame, duration, header-offset, and padding tests | Correct spatial layout and full-loop playback visibly confirmed on wired ANSI hardware |
| TFT progress and cancellation | Implemented | State and cancellation tests | Pending interrupted upload test |

Full parity must not be claimed until the remaining pending hardware rows,
including still-image upload, are visibly confirmed and the original keyboard
state can be restored afterward.
