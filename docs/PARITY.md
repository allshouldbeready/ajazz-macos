# Windows Driver Parity

The supplied ANSI installer is the reference for the first product milestone.
The proprietary installer and extracted files are intentionally not included.

| Feature family | Implementation | Automated verification | Hardware verification |
|---|---|---|---|
| Wired discovery and device information | Transport detection implemented; legacy info read pending | Rust tests and CLI probe | 9 collections enumerated; legacy control selected |
| Bluetooth-only guidance | Implemented | Frontend build | Pending Bluetooth-to-wired transition |
| Clock, sleep, and game settings | Clock implemented on both transports; remaining legacy mappings pending | Clock golden packets and encoder/parser tests | Legacy clock visibly confirmed correct on ANSI hardware |
| 20 global RGB effects | Legacy and online writes implemented | Golden payload tests | Static-green legacy write visibly confirmed on ANSI hardware |
| Per-key RGB | Implemented | Encode/decode tests | Pending ANSI wired device |
| Base and Fn keymaps | Implemented | Round-trip codec tests | Pending ANSI wired device |
| Macros | Implemented | Bounds and codec tests | Pending ANSI wired device |
| TFT built-in/default selection | Implemented | Command tests | Pending visible confirmation |
| PNG/JPEG TFT upload | Implemented | Decode/fit/RGB565 tests | Pending visible confirmation |
| Animated GIF TFT upload | Implemented; full-timeline sampling replaces first-N truncation | Decode, frame-budget, final-frame, and duration tests | Corrected 30-frame transfer completed; visible full-loop playback pending confirmation |
| TFT progress and cancellation | Implemented | State and cancellation tests | Pending interrupted upload test |

Full parity must not be claimed until still-image and animated-GIF uploads are
visibly confirmed on the physical display and the original keyboard state can
be restored afterward.
