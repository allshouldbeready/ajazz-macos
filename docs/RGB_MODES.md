# AK820 Pro RGB modes

The [official AJAZZ manual](https://ajazzstore.com/blogs/manual/ajazz-ak820-pro-manual)
documents 20 onboard lighting effects, six brightness levels, six speed levels,
direction control, eight fixed colours plus RGB cycling, and backlight on/off.
The [official product page](https://ajazzstore.com/products/ajazz-ak820-pro)
describes the south-facing RGB array as supporting 1.6 million colours.

The manual does not name all 20 effects. Their exact names and byte values were
recovered from the supplied local driver (English locale and lighting command),
without copying any proprietary material into this repository:

| Byte | Driver name | App label |
|---:|---|---|
| `00` | LED Off | LED Off |
| `01` | Static | Static |
| `02` | SingleOn | Single On (reactive) |
| `03` | SingleOff | Single Off (inverse reactive) |
| `04` | Glittering | Glittering |
| `05` | Falling | Falling |
| `06` | Colourful | Colourful |
| `07` | Breath | Breathing |
| `08` | Spectrum | Spectrum |
| `09` | Outward | Outward |
| `0A` | Scrolling | Scrolling |
| `0B` | Rolling | Rolling |
| `0C` | Rotating | Rotating |
| `0D` | Explode | Explode |
| `0E` | Launch | Launch |
| `0F` | Ripples | Ripples |
| `10` | Flowing | Flowing |
| `11` | Pulsating | Pulsating |
| `12` | Tilt | Tilt |
| `13` | Shuttle | Shuttle |

`80` is the separate per-key custom buffer mode and is therefore presented in
addition to the 20 vendor effects. Behaviour descriptions are concise UI aids;
the driver names and bytes are authoritative, while the exact animation motion
still needs visual confirmation per mode on hardware.
