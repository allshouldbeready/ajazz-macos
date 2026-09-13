//! Local display preview, made from the exact prepared upload frames.
//! This cache never queries or writes the keyboard.

use std::{fs, io::Read, path::Path};

use ak820_protocol::commands::tft::{TftAnimation, FRAME_BYTES};
use tauri::{AppHandle, Emitter, Manager};

const FILE_NAME: &str = "last-display-preview.bin";
const MAGIC: &[u8; 4] = b"TFT1";
const MAX_FRAMES: usize = 255;
const MAX_BYTES: usize = 6 + MAX_FRAMES * (2 + FRAME_BYTES);

pub fn encode(animation: &TftAnimation) -> Result<Vec<u8>, String> {
    if animation.frames.is_empty() || animation.frames.len() > MAX_FRAMES {
        return Err("Invalid display preview frame count".into());
    }
    let mut bytes = Vec::with_capacity(6 + animation.frames.len() * (2 + FRAME_BYTES));
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&(animation.frames.len() as u16).to_le_bytes());
    for frame in &animation.frames {
        if frame.pixels.len() != FRAME_BYTES {
            return Err("Invalid display preview frame size".into());
        }
        bytes.extend_from_slice(&frame.delay_ms.to_le_bytes());
        bytes.extend_from_slice(&frame.pixels);
    }
    Ok(bytes)
}

fn valid(bytes: &[u8]) -> bool {
    if bytes.len() < 6 || &bytes[..4] != MAGIC {
        return false;
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    count > 0 && count <= MAX_FRAMES && bytes.len() == 6 + count * (2 + FRAME_BYTES)
}

fn save(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, path)
}

/// Called only after a successful transfer. Cache failure must not turn a
/// successful keyboard operation into a failed upload.
pub fn remember(app: &AppHandle, animation: &TftAnimation) {
    let result = (|| {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(FILE_NAME);
        let bytes = encode(animation)?;
        save(&path, &bytes).map_err(|e| e.to_string())
    })();
    if let Err(error) = result {
        clear(app);
        tracing::warn!("Display preview could not be saved: {error}");
    }
    let _ = app.emit("tft-preview-changed", ());
}

pub fn clear(app: &AppHandle) {
    if let Ok(directory) = app.path().app_data_dir() {
        let _ = fs::remove_file(directory.join(FILE_NAME));
    }
    let _ = app.emit("tft-preview-changed", ());
}

#[tauri::command]
pub async fn get_tft_preview(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE_NAME);
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.to_string()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if !valid(&bytes) {
            return Err("Saved display preview is unavailable".into());
        }
        Ok(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ak820_protocol::commands::tft::TftFrame;

    #[test]
    fn preview_keeps_frames_pixels_and_timing() {
        let animation = TftAnimation {
            frames: vec![
                TftFrame {
                    pixels: [0, 248].repeat(FRAME_BYTES / 2),
                    delay_ms: 75,
                },
                TftFrame {
                    pixels: [31, 0].repeat(FRAME_BYTES / 2),
                    delay_ms: 240,
                },
            ],
        };
        let bytes = encode(&animation).unwrap();
        assert!(valid(&bytes));
        assert_eq!(&bytes[..8], &[b'T', b'F', b'T', b'1', 2, 0, 75, 0]);
        assert_eq!(&bytes[8..10], &[0, 248]);
        assert_eq!(&bytes[8 + FRAME_BYTES..12 + FRAME_BYTES], &[240, 0, 31, 0]);
    }

    #[test]
    fn rejects_truncation_empty_and_oversized_previews() {
        assert!(!valid(b"TFT1"));
        assert!(!valid(b"TFT1\0\0"));
        assert!(encode(&TftAnimation::default()).is_err());
        let bad = TftAnimation {
            frames: vec![TftFrame {
                pixels: vec![0],
                delay_ms: 40,
            }],
        };
        assert!(encode(&bad).is_err());
        assert!(!valid(&[b'T', b'F', b'T', b'1', 0, 1]));
    }
}
