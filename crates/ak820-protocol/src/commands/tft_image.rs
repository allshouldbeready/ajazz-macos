//! Image upload pipeline for the TFT panel.
//!
//! Reads a PNG / JPEG / GIF byte buffer, fits it to the AK820 Pro's
//! 128 × 128 panel, quantises to RGB565, and produces a [`TftAnimation`]
//! the device's `SET_TFT_USER_ANIMATION` path can ingest.
//!
//! **MP4 / video** is out of scope for this iteration — pulling in
//! ffmpeg-like deps would more than double the binary, and a user with
//! an mp4 can decimate it to a GIF via ffmpeg / Gifski / native Photos
//! before importing.
//!
//! ## Fit modes
//!
//! See [`FitMode`]. The web driver implicitly uses **Fill** (resize so
//! the shorter side matches, crop centred on the longer side) — pictures
//! always come out edge-to-edge. We expose the three common options so
//! a contributor doesn't have to crop their image first.

use super::tft::{TftAnimation, TftFrame, FRAME_BYTES, TFT_HEIGHT, TFT_WIDTH};
use crate::error::{Error, Result};
use image::imageops::{overlay, FilterType};
use image::{AnimationDecoder, GenericImageView, ImageBuffer, ImageDecoder, ImageReader, Rgba};
use serde::{Deserialize, Serialize};

/// How to fit an arbitrary-aspect source into the 128 × 128 target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FitMode {
    /// Resize so the shorter side matches 128, crop the longer side
    /// equally on both ends to a 128 × 128 square. Picture goes
    /// edge-to-edge. **Default** — matches what the AJAZZ web tool does
    /// for stills.
    Fill,
    /// Resize so the longer side matches 128, letterbox the shorter
    /// side with black bars. Preserves the entire image content.
    Contain,
    /// Stretch each axis to 128 independently. Distorts non-square
    /// sources; only useful when you already cropped to a square.
    Stretch,
}

impl Default for FitMode {
    fn default() -> Self {
        Self::Fill
    }
}

impl FitMode {
    /// Parse from a lowercase string. Named `parse_lenient` rather than
    /// `from_str` so it doesn't clash with `std::str::FromStr` — we want
    /// to forgive unknown values (fall back to `Fill`) rather than error,
    /// and that conflicts with `FromStr`'s `Result` contract.
    pub fn parse_lenient(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "contain" => Self::Contain,
            "stretch" => Self::Stretch,
            _ => Self::Fill,
        }
    }
}

/// User-controlled framing applied before RGB565 conversion.
///
/// Positions are percentages: `0` anchors the source at the left/top edge,
/// `50` centres it, and `100` anchors it at the right/bottom edge. Values are
/// clamped at decode time so malformed IPC input cannot create huge images.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImageTransform {
    pub fit: FitMode,
    pub zoom_percent: u16,
    pub position_x: u8,
    pub position_y: u8,
    pub background: String,
    pub speed_percent: u16,
    pub max_frames: usize,
}

impl Default for ImageTransform {
    fn default() -> Self {
        Self {
            fit: FitMode::Fill,
            zoom_percent: 100,
            position_x: 50,
            position_y: 50,
            background: "000000".into(),
            speed_percent: 100,
            max_frames: MAX_FRAMES_FOR_GIF,
        }
    }
}

/// Frame-delay caps. The protocol allows up to 255 × 5 ms = 1275 ms per
/// frame slot, and `MAX_FRAMES` total — we mirror those for GIFs but
/// also clamp ridiculously short delays (e.g. 0 ms or 10 ms) to a sane
/// minimum so the panel isn't asked to refresh faster than it can.
const MIN_FRAME_DELAY_MS: u16 = 40; // 25 fps ceiling
const MAX_FRAMES_FOR_GIF: usize = 30; // device-reported `tftMaxFrames` ≈ 30
const MAX_SOURCE_DIMENSION: u32 = 8192;
const MAX_DECODE_ALLOC: u64 = 128 * 1024 * 1024;
const MAX_INTERMEDIATE_DIMENSION: u32 = 4096;

/// Decode an image byte buffer and turn it into a [`TftAnimation`].
/// Auto-detects format from the byte signature (PNG / JPEG / GIF). For
/// GIFs, every frame is decoded, fitted, and quantised in turn. For
/// stills, the result is a single-frame animation.
pub fn animation_from_bytes(bytes: &[u8], fit: FitMode) -> Result<TftAnimation> {
    animation_from_bytes_with_transform(
        bytes,
        &ImageTransform {
            fit,
            ..ImageTransform::default()
        },
    )
}

/// Decode and frame an image using the complete TFT editor transform.
pub fn animation_from_bytes_with_transform(
    bytes: &[u8],
    transform: &ImageTransform,
) -> Result<TftAnimation> {
    if bytes.is_empty() {
        return Err(Error::UnexpectedResponse("empty image buffer".into()));
    }

    // GIF gets a dedicated decoder because we want per-frame delays.
    // PNG / JPEG go through the generic loader.
    if is_gif(bytes) {
        return animation_from_gif(bytes, transform);
    }

    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| Error::UnexpectedResponse(format!("image format: {e}")))?;
    reader.limits(decode_limits());
    let img = reader
        .decode()
        .map_err(|e| Error::UnexpectedResponse(format!("image decode: {e}")))?;
    let frame = transform_and_quantise(&img, transform, 200);
    Ok(TftAnimation {
        frames: vec![frame],
    })
}

fn is_gif(bytes: &[u8]) -> bool {
    bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"))
}

fn animation_from_gif(bytes: &[u8], transform: &ImageTransform) -> Result<TftAnimation> {
    let cursor = std::io::Cursor::new(bytes);
    let mut decoder = image::codecs::gif::GifDecoder::new(cursor)
        .map_err(|e| Error::UnexpectedResponse(format!("gif decode: {e}")))?;
    decoder
        .set_limits(decode_limits())
        .map_err(|e| Error::UnexpectedResponse(format!("gif limits: {e}")))?;
    let mut frames = Vec::new();
    for (i, raw) in decoder.into_frames().enumerate() {
        let raw = raw.map_err(|e| Error::UnexpectedResponse(format!("gif frame {i}: {e}")))?;
        let delay_ms = raw.delay().numer_denom_ms();
        // `delay()` is the per-frame display duration as a rational
        // (numer, denom) in milliseconds. Round to nearest whole ms,
        // then clamp to the protocol's representable range.
        let delay_ms = (delay_ms.0 as u64).saturating_div(delay_ms.1.max(1) as u64) as u16;
        let speed = transform.speed_percent.clamp(25, 400) as u32;
        let delay_ms =
            ((delay_ms as u32 * 100) / speed).clamp(MIN_FRAME_DELAY_MS as u32, 1275) as u16;
        let img = image::DynamicImage::ImageRgba8(raw.into_buffer());
        frames.push(transform_and_quantise(&img, transform, delay_ms));
        let frame_limit = transform.max_frames.clamp(1, MAX_FRAMES_FOR_GIF);
        if frames.len() >= frame_limit {
            tracing::warn!(
                limit = frame_limit,
                "GIF exceeds device frame budget; truncating"
            );
            break;
        }
    }
    if frames.is_empty() {
        return Err(Error::UnexpectedResponse("gif contained no frames".into()));
    }
    Ok(TftAnimation { frames })
}

fn decode_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_DIMENSION);
    limits.max_image_height = Some(MAX_SOURCE_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    limits
}

/// Apply the chosen fit mode to a source `DynamicImage`, then quantise to
/// RGB565 and pack into a [`TftFrame`] with the supplied delay.
fn transform_and_quantise(
    img: &image::DynamicImage,
    transform: &ImageTransform,
    delay_ms: u16,
) -> TftFrame {
    let target = render_transform(img, transform);
    let rgba = target.to_rgba8();
    debug_assert_eq!(rgba.width(), TFT_WIDTH);
    debug_assert_eq!(rgba.height(), TFT_HEIGHT);
    let mut pixels = Vec::with_capacity(FRAME_BYTES);
    for px in rgba.pixels() {
        let Rgba([r, g, b, _a]) = *px;
        let r5 = (r >> 3) as u16;
        let g6 = (g >> 2) as u16;
        let b5 = (b >> 3) as u16;
        let v = (r5 << 11) | (g6 << 5) | b5;
        pixels.extend_from_slice(&v.to_le_bytes());
    }
    TftFrame { pixels, delay_ms }
}

fn render_transform(img: &image::DynamicImage, transform: &ImageTransform) -> image::DynamicImage {
    let (w, h) = img.dimensions();
    let (resized_width, resized_height) = scaled_dimensions(w, h, transform);
    let resized = img.resize_exact(resized_width, resized_height, FilterType::Lanczos3);
    let (rw, rh) = resized.dimensions();
    let background = parse_background(&transform.background);
    let mut canvas: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_pixel(
        TFT_WIDTH,
        TFT_HEIGHT,
        Rgba([background.0, background.1, background.2, 255]),
    );
    let position_x = transform.position_x.min(100) as i64;
    let position_y = transform.position_y.min(100) as i64;
    let x = (TFT_WIDTH as i64 - rw as i64) * position_x / 100;
    let y = (TFT_HEIGHT as i64 - rh as i64) * position_y / 100;
    overlay(&mut canvas, &resized.to_rgba8(), x, y);
    image::DynamicImage::ImageRgba8(canvas)
}

fn scaled_dimensions(w: u32, h: u32, transform: &ImageTransform) -> (u32, u32) {
    let zoom = transform.zoom_percent.clamp(25, 400) as f64 / 100.0;
    let (base_x, base_y) = match transform.fit {
        FitMode::Fill => {
            let scale = (TFT_WIDTH as f64 / w as f64).max(TFT_HEIGHT as f64 / h as f64);
            (scale, scale)
        }
        FitMode::Contain => {
            let scale = (TFT_WIDTH as f64 / w as f64).min(TFT_HEIGHT as f64 / h as f64);
            (scale, scale)
        }
        FitMode::Stretch => (TFT_WIDTH as f64 / w as f64, TFT_HEIGHT as f64 / h as f64),
    };
    let mut resized_width = (w as f64 * base_x * zoom).round().max(1.0);
    let mut resized_height = (h as f64 * base_y * zoom).round().max(1.0);
    let largest = resized_width.max(resized_height);
    if largest > MAX_INTERMEDIATE_DIMENSION as f64 {
        let safety_scale = MAX_INTERMEDIATE_DIMENSION as f64 / largest;
        resized_width *= safety_scale;
        resized_height *= safety_scale;
    }
    (
        resized_width.round().max(1.0) as u32,
        resized_height.round().max(1.0) as u32,
    )
}

fn parse_background(value: &str) -> (u8, u8, u8) {
    let value = value.trim().trim_start_matches('#');
    if value.len() != 6 {
        return (0, 0, 0);
    }
    let parse = |range| u8::from_str_radix(&value[range], 16).unwrap_or(0);
    (parse(0..2), parse(2..4), parse(4..6))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construct a 4 × 4 PNG with a known colour pattern, encode it,
    /// then round-trip through `animation_from_bytes`. Mostly a sanity
    /// gate so the dependency wiring doesn't silently regress.
    #[test]
    fn png_round_trip_produces_single_full_frame() {
        let img = image::ImageBuffer::from_fn(4, 4, |x, _y| {
            if x < 2 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 255, 0, 255])
            }
        });
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        let anim = animation_from_bytes(&bytes, FitMode::Fill).unwrap();
        assert_eq!(anim.frames.len(), 1);
        assert_eq!(anim.frames[0].pixels.len(), FRAME_BYTES);
    }

    #[test]
    fn fit_mode_parses_case_insensitively() {
        assert_eq!(FitMode::parse_lenient("fill"), FitMode::Fill);
        assert_eq!(FitMode::parse_lenient("FILL"), FitMode::Fill);
        assert_eq!(FitMode::parse_lenient("Contain"), FitMode::Contain);
        assert_eq!(FitMode::parse_lenient("stretch"), FitMode::Stretch);
        assert_eq!(FitMode::parse_lenient("nonsense"), FitMode::Fill); // safe fallback
    }

    #[test]
    fn empty_buffer_errors_out() {
        assert!(animation_from_bytes(&[], FitMode::Fill).is_err());
    }

    #[test]
    fn crop_position_selects_left_or_right_side() {
        let img = image::DynamicImage::ImageRgba8(image::ImageBuffer::from_fn(256, 128, |x, _| {
            if x < 128 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            }
        }));
        let left = transform_and_quantise(
            &img,
            &ImageTransform {
                position_x: 0,
                ..ImageTransform::default()
            },
            100,
        );
        let right = transform_and_quantise(
            &img,
            &ImageTransform {
                position_x: 100,
                ..ImageTransform::default()
            },
            100,
        );
        assert_eq!(&left.pixels[0..2], &0xF800_u16.to_le_bytes());
        assert_eq!(&right.pixels[0..2], &0x001F_u16.to_le_bytes());
    }

    #[test]
    fn contain_uses_configured_background() {
        let img = image::DynamicImage::new_rgba8(2, 1);
        let frame = transform_and_quantise(
            &img,
            &ImageTransform {
                fit: FitMode::Contain,
                background: "00FF00".into(),
                position_y: 0,
                ..ImageTransform::default()
            },
            100,
        );
        let bottom_left = ((TFT_HEIGHT - 1) * TFT_WIDTH * 2) as usize;
        assert_eq!(
            &frame.pixels[bottom_left..bottom_left + 2],
            &0x07E0_u16.to_le_bytes()
        );
    }

    #[test]
    fn extreme_aspect_ratio_has_bounded_intermediate_size() {
        let dimensions = scaled_dimensions(8192, 1, &ImageTransform::default());
        assert!(dimensions.0 <= MAX_INTERMEDIATE_DIMENSION);
        assert!(dimensions.1 <= MAX_INTERMEDIATE_DIMENSION);
    }
}
