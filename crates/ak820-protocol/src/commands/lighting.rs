//! Lighting commands. Wire format decoded from the official AJAZZ online
//! driver — see `docs/PROTOCOL.md`.
//!
//! A single `SET_LED_EFFECT` transaction is **one** output report:
//! a 64-byte outer frame (magic 0xAA + cmd 0x23 + 16 = len + addr 0 + flags)
//! that wraps a 16-byte payload starting at offset 8.

use serde::{Deserialize, Serialize};

use crate::protocol::PAYLOAD_PER_PACKET;

pub const MAX_BRIGHTNESS: u8 = 5;
pub const MAX_SPEED: u8 = 5;

/// 16-byte payload size for `SET_LED_EFFECT`.
pub const LED_EFFECT_LEN: usize = 16;
const _: () = assert!(LED_EFFECT_LEN <= PAYLOAD_PER_PACKET);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Off = 0x00,
    Static = 0x01,
    SingleOn = 0x02,
    SingleOff = 0x03,
    Glittering = 0x04,
    Falling = 0x05,
    Colourful = 0x06,
    Breath = 0x07,
    Spectrum = 0x08,
    Outward = 0x09,
    Scrolling = 0x0A,
    Rolling = 0x0B,
    Rotating = 0x0C,
    Explode = 0x0D,
    Launch = 0x0E,
    Ripples = 0x0F,
    Flowing = 0x10,
    Pulsating = 0x11,
    Tilt = 0x12,
    Shuttle = 0x13,
    /// Per-key custom RGB — the keyboard renders from the buffer written
    /// via `SET_CUSTOM_LED_DATA` (cmd 36). Default value 128 (0x80) per the
    /// AJAZZ online driver. Other effect parameters (brightness/speed/colour)
    /// are ignored in this mode; only the per-LED `(red, green, blue)`
    /// triples in the buffer matter.
    Custom = 0x80,
}

impl Mode {
    pub const ALL: &'static [Mode] = &[
        Self::Off,
        Self::Static,
        Self::SingleOn,
        Self::SingleOff,
        Self::Glittering,
        Self::Falling,
        Self::Colourful,
        Self::Breath,
        Self::Spectrum,
        Self::Outward,
        Self::Scrolling,
        Self::Rolling,
        Self::Rotating,
        Self::Explode,
        Self::Launch,
        Self::Ripples,
        Self::Flowing,
        Self::Pulsating,
        Self::Tilt,
        Self::Shuttle,
        Self::Custom,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Static => "static",
            Self::SingleOn => "single-on",
            Self::SingleOff => "single-off",
            Self::Glittering => "glittering",
            Self::Falling => "falling",
            Self::Colourful => "colourful",
            Self::Breath => "breath",
            Self::Spectrum => "spectrum",
            Self::Outward => "outward",
            Self::Scrolling => "scrolling",
            Self::Rolling => "rolling",
            Self::Rotating => "rotating",
            Self::Explode => "explode",
            Self::Launch => "launch",
            Self::Ripples => "ripples",
            Self::Flowing => "flowing",
            Self::Pulsating => "pulsating",
            Self::Tilt => "tilt",
            Self::Shuttle => "shuttle",
            Self::Custom => "custom",
        }
    }

    /// Human-readable names used by the supplied AJAZZ driver. The two
    /// single-key effects are annotated so their reactive behaviour is clear.
    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "LED Off",
            Self::Static => "Static",
            Self::SingleOn => "Single On (reactive)",
            Self::SingleOff => "Single Off (inverse reactive)",
            Self::Glittering => "Glittering",
            Self::Falling => "Falling",
            Self::Colourful => "Colourful",
            Self::Breath => "Breathing",
            Self::Spectrum => "Spectrum",
            Self::Outward => "Outward",
            Self::Scrolling => "Scrolling",
            Self::Rolling => "Rolling",
            Self::Rotating => "Rotating",
            Self::Explode => "Explode",
            Self::Launch => "Launch",
            Self::Ripples => "Ripples",
            Self::Flowing => "Flowing",
            Self::Pulsating => "Pulsating",
            Self::Tilt => "Tilt",
            Self::Shuttle => "Shuttle",
            Self::Custom => "Per-key custom",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Off => "Turn the keyboard backlight off.",
            Self::Static => "Keep every key steadily lit.",
            Self::SingleOn => "Light each key when it is pressed.",
            Self::SingleOff => "Dim each pressed key against the lit keyboard.",
            Self::Glittering => "Scatter sparkling points across the keyboard.",
            Self::Falling => "Move falling trails through the key grid.",
            Self::Colourful => "Cycle a multicolour pattern across the keyboard.",
            Self::Breath => "Fade the backlight smoothly in and out.",
            Self::Spectrum => "Sweep continuously through the RGB spectrum.",
            Self::Outward => "Expand light outward from the centre.",
            Self::Scrolling => "Scroll the effect vertically.",
            Self::Rolling => "Roll a band of light horizontally.",
            Self::Rotating => "Rotate the lighting pattern around the keyboard.",
            Self::Explode => "Burst light outward from each keypress.",
            Self::Launch => "Launch a moving trail from each keypress.",
            Self::Ripples => "Send ripples across nearby keys after a keypress.",
            Self::Flowing => "Flow a continuous band from side to side.",
            Self::Pulsating => "Pulse the lighting rhythmically.",
            Self::Tilt => "Shift the lighting field from side to side.",
            Self::Shuttle => "Move a light band back and forth.",
            Self::Custom => "Use the per-key colour canvas.",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .find(|m| m.name().eq_ignore_ascii_case(name))
            .copied()
    }

    pub fn supported_directions(self) -> &'static [Direction] {
        match self {
            Self::Scrolling => &[Direction::Up, Direction::Down],
            Self::Rolling | Self::Flowing | Self::Tilt => &[Direction::Left, Direction::Right],
            _ => &[],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Left = 0,
    Down = 1,
    Up = 2,
    Right = 3,
}

impl Direction {
    pub const ALL: &'static [Direction] = &[Self::Left, Self::Down, Self::Up, Self::Right];

    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "left" | "l" => Some(Self::Left),
            "down" | "d" => Some(Self::Down),
            "up" | "u" => Some(Self::Up),
            "right" | "r" => Some(Self::Right),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingConfig {
    pub mode: Mode,
    /// RGB as 6-char hex, e.g. `"FF0000"`. Ignored when `colorMode != Mono`.
    pub color: String,
    /// Secondary RGB for dual-colour modes. Default zero.
    #[serde(default)]
    pub secondary: Option<String>,
    /// `colorMode = 0` (mono) by default. Set to non-zero for cycling
    /// modes — exact semantics per-mode, still being mapped.
    #[serde(default)]
    pub color_mode: u8,
    /// `effectModeType` byte at payload offset 12. Default zero.
    #[serde(default)]
    pub effect_mode_type: u8,
    pub brightness: u8,
    pub speed: u8,
    pub direction: Direction,
}

impl LightingConfig {
    pub fn rgb(&self) -> (u8, u8, u8) {
        parse_hex_rgb(&self.color).unwrap_or((0xFF, 0xFF, 0xFF))
    }

    pub fn secondary_rgb(&self) -> (u8, u8, u8) {
        self.secondary
            .as_deref()
            .and_then(parse_hex_rgb)
            .unwrap_or((0, 0, 0))
    }
}

pub fn parse_hex_rgb(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some((r, g, b))
}

/// Build the 16-byte `SET_LED_EFFECT` payload. Mirrors `mt()` in the
/// online driver's `default` protocol module.
pub fn led_effect_payload(cfg: &LightingConfig) -> [u8; LED_EFFECT_LEN] {
    let (r, g, b) = cfg.rgb();
    let (sr, sg, sb) = cfg.secondary_rgb();
    let mut p = [0u8; LED_EFFECT_LEN];
    p[0] = cfg.mode as u8;
    p[1] = r;
    p[2] = g;
    p[3] = b;
    p[4] = 0xFF; // driverSetting — hardcoded by the official driver
    p[5] = sr;
    p[6] = sg;
    p[7] = sb;
    p[8] = cfg.color_mode;
    p[9] = cfg.brightness.min(MAX_BRIGHTNESS);
    p[10] = cfg.speed.min(MAX_SPEED);
    p[11] = cfg.direction as u8;
    p[12] = cfg.effect_mode_type;
    // p[13] = 0 (padding)
    p[14] = 0xAA; // checkCodeL (high byte first vs upstream — non-obvious)
    p[15] = 0x55; // checkCodeH
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_rgb_parse() {
        assert_eq!(parse_hex_rgb("FF0000"), Some((0xFF, 0, 0)));
        assert_eq!(parse_hex_rgb("#7C5CFF"), Some((0x7C, 0x5C, 0xFF)));
        assert_eq!(parse_hex_rgb("nope"), None);
    }

    #[test]
    fn payload_matches_official_layout() {
        let cfg = LightingConfig {
            mode: Mode::Static,
            color: "FF0000".into(),
            secondary: None,
            color_mode: 0,
            effect_mode_type: 0,
            brightness: 3,
            speed: 5,
            direction: Direction::Left,
        };
        let p = led_effect_payload(&cfg);
        assert_eq!(p[0], 0x01);
        assert_eq!(p[1], 0xFF);
        assert_eq!(p[4], 0xFF); // driverSetting
        assert_eq!(p[8], 0); // colorMode
        assert_eq!(p[9], 3);
        assert_eq!(p[10], 5);
        assert_eq!(p[11], 0);
        assert_eq!(p[14], 0xAA);
        assert_eq!(p[15], 0x55);
    }

    #[test]
    fn brightness_and_speed_are_clamped() {
        let cfg = LightingConfig {
            mode: Mode::Glittering,
            color: "FFFFFF".into(),
            secondary: None,
            color_mode: 0,
            effect_mode_type: 0,
            brightness: 99,
            speed: 99,
            direction: Direction::Up,
        };
        let p = led_effect_payload(&cfg);
        assert_eq!(p[9], MAX_BRIGHTNESS);
        assert_eq!(p[10], MAX_SPEED);
    }

    #[test]
    fn exposes_all_twenty_vendor_modes_plus_custom() {
        assert_eq!(Mode::ALL.len(), 21);
        assert_eq!(Mode::Breath.label(), "Breathing");
        assert!(Mode::SingleOn.description().contains("pressed"));
        assert_eq!(Mode::Shuttle as u8, 0x13);
        assert_eq!(Mode::Custom as u8, 0x80);
    }
}
