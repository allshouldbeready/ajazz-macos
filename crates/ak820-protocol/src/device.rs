use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, trace};

use crate::commands::clock::TftDateTime;
use crate::commands::keymap::{Keymap, KEYMAP_BYTES};
use crate::commands::lighting::{self, LightingConfig};
use crate::commands::macros::{
    self as macro_cmds, IndexEntry, Macro, MACRO_DATA_ADDR, MACRO_INDEX_BYTES,
};
use crate::commands::per_key_rgb::{CustomLedMap, CUSTOM_LED_BYTES};
use crate::commands::system::{DeviceInfoReport, GameMode, LegacySystemSettings};
use crate::commands::tft::{build_tft_header, TftAnimation};
use crate::legacy_protocol::{
    clock_data, clock_preamble, feature_report, finish_payload, lighting_data, lighting_preamble,
    save_payload, start_payload, system_data, system_preamble, tft_image_preamble,
    FEATURE_REPORT_LEN,
};
use crate::protocol::{
    build_frame, cmd, HEADER_LEN, MAGIC_INCOMING, PACKET_LEN, PAYLOAD_PER_PACKET, REPORT_ID,
};
use crate::{error::*, CONTROL_INTERFACE, LEGACY_RECEIVER_PRODUCT_ID, PRODUCT_IDS, VENDOR_ID};

/// Default response timeout (ms) for non-streaming GET/SET commands.
const DEFAULT_TIMEOUT_MS: i32 = 500;
const LEGACY_BATTERY_COMMAND: u8 = 0x20;
const LEGACY_BATTERY_SUBCOMMAND: u8 = 0x01;
const LEGACY_BATTERY_CHECKSUM_OFFSET: usize = 32;
const LEGACY_BATTERY_REPORT_LEN: usize = 33;
const LEGACY_BATTERY_TIMEOUT_MS: i32 = 750;

fn remaining_timeout_ms(deadline: std::time::Instant, now: std::time::Instant) -> Option<i32> {
    let millis = deadline
        .saturating_duration_since(now)
        .as_millis()
        .min(i32::MAX as u128) as i32;
    (millis > 0).then_some(millis)
}

fn matching_response_payload(buf: &[u8], expected_cmd: u8) -> Result<Option<Vec<u8>>> {
    if buf.first() != Some(&MAGIC_INCOMING) {
        return Ok(None);
    }
    if buf.len() < HEADER_LEN {
        return Err(Error::UnexpectedResponse(format!(
            "short response for cmd 0x{expected_cmd:02x}: {} bytes",
            buf.len()
        )));
    }
    if buf[1] != expected_cmd {
        return Ok(None);
    }
    Ok(Some(buf[HEADER_LEN..].to_vec()))
}

fn legacy_battery_request() -> Vec<u8> {
    // hidapi expects the unnumbered report ID as byte zero. Although the
    // Windows application allocates a 65-byte work buffer, its transport layer
    // passes exactly 0x21 bytes to WriteFile: report ID + 32-byte payload.
    let mut request = vec![0u8; LEGACY_BATTERY_REPORT_LEN];
    request[1] = LEGACY_BATTERY_COMMAND;
    request[2] = LEGACY_BATTERY_SUBCOMMAND;
    request[LEGACY_BATTERY_CHECKSUM_OFFSET] = request
        .iter()
        .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    request
}

fn parse_legacy_battery_response(response: &[u8]) -> Result<Option<u8>> {
    let payload = if response.starts_with(&[0, LEGACY_BATTERY_COMMAND]) {
        &response[1..]
    } else {
        response
    };
    if payload.len() < 4 || payload[..3] != [LEGACY_BATTERY_COMMAND, LEGACY_BATTERY_SUBCOMMAND, 0] {
        return Ok(None);
    }
    let level = payload[3];
    // The supplied driver treats zero as "no reading" and leaves its battery
    // control unchanged. Preserve that distinction instead of presenting an
    // absent receiver value as an authoritative 0% charge.
    if level == 0 {
        return Ok(None);
    }
    if level > 100 {
        return Err(Error::UnexpectedResponse(format!(
            "invalid battery percentage {level}"
        )));
    }
    Ok(Some(level))
}

fn query_legacy_battery_device(device: &HidDevice, source: &'static str) -> Result<BatteryStatus> {
    let request = legacy_battery_request();
    device.write(&request)?;

    let deadline = std::time::Instant::now()
        + std::time::Duration::from_millis(LEGACY_BATTERY_TIMEOUT_MS as u64);
    let mut response = [0u8; 4096];
    loop {
        let Some(remaining) = remaining_timeout_ms(deadline, std::time::Instant::now()) else {
            let detail = if source == "wired-bypass" {
                "wired endpoint did not answer the receiver-only battery query; changing the host mode does not emulate the 2.4 GHz radio bridge"
            } else {
                "timeout waiting for the 2.4 GHz receiver battery response"
            };
            return Err(Error::UnexpectedResponse(detail.into()));
        };
        let read = device.read_timeout(&mut response, remaining)?;
        if read == 0 {
            continue;
        }
        if let Some(level) = parse_legacy_battery_response(&response[..read])? {
            return Ok(BatteryStatus {
                battery_level: level,
                charging: None,
                source: source.to_owned(),
            });
        }
    }
}

/// Query the supplied ANSI driver's 2.4 GHz receiver battery endpoint.
///
/// This sends one non-persistent query and never enters a configuration or
/// firmware transaction. The receiver must be physically present and linked.
pub fn query_receiver_battery() -> Result<BatteryStatus> {
    let candidates = enumerate()?;
    let receiver = candidates
        .iter()
        .find(|candidate| candidate.pid == LEGACY_RECEIVER_PRODUCT_ID && candidate.interface == 3)
        .or_else(|| {
            candidates
                .iter()
                .find(|candidate| candidate.pid == LEGACY_RECEIVER_PRODUCT_ID)
        })
        .ok_or(Error::DeviceNotFound {
            vid: VENDOR_ID,
            interface: 3,
        })?;
    let api = HidApi::new()?;
    let device = api.open_path(&std::ffi::CString::new(receiver.path.clone()).unwrap())?;
    query_legacy_battery_device(&device, "2.4g-receiver")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub vid: u16,
    pub pid: u16,
    pub interface: i32,
    pub usage_page: u16,
    pub usage: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub path: String,
}

/// Summary of one HID interface's report-descriptor properties.
///
/// We use this to find the right interface for chunked TFT uploads: the
/// `SET_TFT_USER_ANIMATION` path needs an output-report payload of ~4096
/// bytes, which is wildly different from the 64-byte control interface.
/// Opening the wrong interface and writing big chunks ends with cryptic
/// "frame too long" / IOHIDDevice errors on macOS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceProbe {
    /// Per-interface DeviceInfo (path, usage_page, product, …).
    pub info: DeviceInfo,
    /// Largest output-report size observed in the descriptor, in bytes
    /// (excluding the report-ID prefix). `None` means we couldn't open the
    /// device or the descriptor was empty.
    pub max_output_report_bytes: Option<usize>,
    /// Raw report descriptor bytes for the curious / for future RE.
    pub raw_descriptor_hex: Option<String>,
}

/// Open every AK820 candidate, read its report descriptor, and return a
/// summary used by RE / interface-selection logic.
///
/// **Caveat**: this acquires an exclusive HID handle for each interface in
/// turn. Don't call it while the Tauri shell already holds a connection.
pub fn probe_interfaces() -> Result<Vec<InterfaceProbe>> {
    let api = HidApi::new()?;
    let infos = enumerate()?;
    let mut out = Vec::with_capacity(infos.len());
    for info in infos {
        let opened = api.open_path(&std::ffi::CString::new(info.path.clone()).unwrap());
        let mut probe = InterfaceProbe {
            info: info.clone(),
            max_output_report_bytes: None,
            raw_descriptor_hex: None,
        };
        if let Ok(dev) = opened {
            let mut buf = vec![0u8; 4096];
            if let Ok(n) = dev.get_report_descriptor(&mut buf) {
                let desc = &buf[..n];
                probe.raw_descriptor_hex = Some(hex::encode(desc));
                probe.max_output_report_bytes = parse_max_output_report_size(desc);
            }
        }
        out.push(probe);
    }
    Ok(out)
}

/// Minimal HID-descriptor walker: returns the largest payload size (in bytes)
/// of any Output (= 0x91) report defined in the descriptor.
///
/// HID descriptors are a stream of variable-length items. Each item starts
/// with a 1-byte tag that encodes (size, type, tag). We only care about the
/// **Global** items `Report Size` (0x75) and `Report Count` (0x95), plus the
/// **Main** item `Output` (0x91). Whenever an `Output` is emitted, the most
/// recent Report Size × Report Count gives that report's payload bit-width;
/// we round up to bytes and take the max across all such Output emissions.
///
/// Not a full parser — but good enough to identify the "big report"
/// interface used for TFT uploads on the AK820 Pro.
fn parse_max_output_report_size(desc: &[u8]) -> Option<usize> {
    let mut i = 0;
    let mut report_size_bits: u32 = 0;
    let mut report_count: u32 = 0;
    let mut max_bytes: usize = 0;
    while i < desc.len() {
        let head = desc[i];
        let size_code = head & 0x03;
        let size = match size_code {
            0 => 0,
            1 => 1,
            2 => 2,
            3 => 4,
            _ => 0,
        };
        let tag = head & 0xFC;
        if i + 1 + size > desc.len() {
            break;
        }
        let data: u32 = match size {
            0 => 0,
            1 => desc[i + 1] as u32,
            2 => (desc[i + 1] as u32) | ((desc[i + 2] as u32) << 8),
            4 => {
                (desc[i + 1] as u32)
                    | ((desc[i + 2] as u32) << 8)
                    | ((desc[i + 3] as u32) << 16)
                    | ((desc[i + 4] as u32) << 24)
            }
            _ => 0,
        };
        match tag {
            // Global: Report Size (bits per field)
            0x74 => report_size_bits = data,
            // Global: Report Count (number of fields)
            0x94 => report_count = data,
            // Main: Output
            0x90 => {
                let bits = report_size_bits.saturating_mul(report_count);
                let bytes = bits.div_ceil(8) as usize;
                if bytes > max_bytes {
                    max_bytes = bytes;
                }
            }
            _ => {}
        }
        i += 1 + size;
    }
    if max_bytes == 0 {
        None
    } else {
        Some(max_bytes)
    }
}

pub fn enumerate() -> Result<Vec<DeviceInfo>> {
    let api = HidApi::new()?;
    let mut found = Vec::new();
    for d in api.device_list() {
        if d.vendor_id() != VENDOR_ID || !PRODUCT_IDS.contains(&d.product_id()) {
            continue;
        }
        let info = DeviceInfo {
            vid: d.vendor_id(),
            pid: d.product_id(),
            interface: d.interface_number(),
            usage_page: d.usage_page(),
            usage: d.usage(),
            manufacturer: d.manufacturer_string().map(str::to_owned),
            product: d.product_string().map(str::to_owned),
            serial: d.serial_number().map(str::to_owned),
            path: d.path().to_string_lossy().into_owned(),
        };
        debug!(?info, "candidate HID device");
        found.push(info);
    }
    info!(count = found.len(), "enumerated AK820 candidates");
    Ok(found)
}

pub struct Connection {
    device: HidDevice,
    legacy_control: Option<HidDevice>,
    info: DeviceInfo,
    transport: TransportKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TransportKind {
    OnlineOutput,
    LegacyFeature,
    LegacyTft,
}

impl TransportKind {
    fn ensure_online_output(self) -> Result<()> {
        match self {
            Self::OnlineOutput => Ok(()),
            Self::LegacyFeature | Self::LegacyTft => Err(Error::NotImplemented(
                "keymap, macro, and online-driver reports are unavailable on this keyboard firmware",
            )),
        }
    }
}

impl Connection {
    /// Open the AK820 control endpoint. Selection precedence:
    ///   1. `AK820_IFACE=N` → first device with `interface_number == N`
    ///   2. `AK820_USAGE_PAGE=0xFFXX` → first device with that usage page
    ///   3. default: vendor-specific usage page `0xFF68`
    pub fn open_control() -> Result<Self> {
        let candidates = enumerate()?;

        let by_iface_env = std::env::var("AK820_IFACE")
            .ok()
            .and_then(|v| v.parse::<i32>().ok());
        let by_usage_env = std::env::var("AK820_USAGE_PAGE")
            .ok()
            .and_then(|v| u16::from_str_radix(v.trim_start_matches("0x"), 16).ok());

        // The official AJAZZ online driver filters collections by usage page —
        // `q(x)` in the source accepts [0xFF68, 0xFF80, 0xFF60, 0xFF00, 0xFF01, 0xFF1B].
        // On the AK820 Pro that's interface 2 (0xFF68), not interface 3 (0xFF67).
        const PREFERRED_USAGE_PAGES: &[u16] = &[0xFF68, 0xFF80, 0xFF60, 0xFF00, 0xFF01, 0xFF1B];

        let pick = if let Some(want) = by_iface_env {
            candidates.iter().find(|d| d.interface == want).cloned()
        } else if let Some(want) = by_usage_env {
            candidates.iter().find(|d| d.usage_page == want).cloned()
        } else {
            candidates
                .iter()
                .find(|d| PREFERRED_USAGE_PAGES.contains(&d.usage_page))
                .or_else(|| candidates.iter().find(|d| d.interface == CONTROL_INTERFACE))
                .cloned()
        };

        let control = pick.ok_or(Error::DeviceNotFound {
            vid: VENDOR_ID,
            interface: CONTROL_INTERFACE,
        })?;

        let protocol_override = std::env::var("AK820_PROTOCOL").ok();
        let has_legacy_control = candidates
            .iter()
            .any(|candidate| candidate.usage_page == 0xFF13);
        let has_online_tft = candidates
            .iter()
            .any(|candidate| candidate.usage_page == 0xFF67);
        if protocol_override.as_deref() == Some("legacy")
            || (protocol_override.is_none() && has_legacy_control && !has_online_tft)
        {
            return Self::open_legacy_from_candidates(&candidates);
        }

        let api = HidApi::new()?;
        let device = api.open_path(&std::ffi::CString::new(control.path.clone()).unwrap())?;
        device.set_blocking_mode(true)?;
        info!(
            path = %control.path,
            interface = control.interface,
            usage_page = format!("0x{:04x}", control.usage_page),
            "opened control interface"
        );
        Ok(Self {
            device,
            legacy_control: None,
            info: control,
            transport: TransportKind::OnlineOutput,
        })
    }

    fn open_legacy_from_candidates(candidates: &[DeviceInfo]) -> Result<Self> {
        const LEGACY_USAGE_PAGE: u16 = 0xFF13;
        let info = candidates
            .iter()
            .find(|candidate| candidate.usage_page == LEGACY_USAGE_PAGE)
            .cloned()
            .ok_or(Error::DeviceNotFound {
                vid: VENDOR_ID,
                interface: CONTROL_INTERFACE,
            })?;
        let api = HidApi::new()?;
        let device = api.open_path(&std::ffi::CString::new(info.path.clone()).unwrap())?;
        info!(
            interface = info.interface,
            usage_page = format!("0x{:04x}", info.usage_page),
            "opened supplied-driver feature transport"
        );
        Ok(Self {
            device,
            legacy_control: None,
            info,
            transport: TransportKind::LegacyFeature,
        })
    }

    pub fn info(&self) -> &DeviceInfo {
        &self.info
    }

    pub fn transport(&self) -> TransportKind {
        self.transport
    }

    pub fn raw(&self) -> &HidDevice {
        &self.device
    }

    /// Diagnostic-only bypass of the Windows driver's receiver-mode gate.
    /// The connected legacy wired firmware has been observed to time out; this
    /// remains available to test other hardware revisions without pretending a
    /// timeout is a battery value.
    pub fn query_legacy_battery_bypass(&self) -> Result<BatteryStatus> {
        if self.transport != TransportKind::LegacyFeature {
            return Err(Error::NotImplemented(
                "wired battery bypass requires supplied-driver firmware",
            ));
        }
        query_legacy_battery_device(&self.device, "wired-bypass")
    }

    pub fn probe(&self) -> Result<ProbeReport> {
        Ok(ProbeReport {
            connected: true,
            interface: self.info.interface,
            product: self.info.product.clone(),
            firmware_version: None,
        })
    }

    /// Send one output report on this interface.
    fn write_output_report(&self, frame: &[u8; PACKET_LEN]) -> Result<()> {
        // Keep the guard at the lowest output-report layer. Keymap and macro
        // reads use chunked helpers and previously bypassed the higher-level
        // `get` guard, sending an incompatible frame that toggled Caps Lock.
        self.transport.ensure_online_output()?;
        let mut buf = [0u8; PACKET_LEN + 1];
        buf[0] = REPORT_ID;
        buf[1..].copy_from_slice(frame);
        trace!(report_id = REPORT_ID, hex = %hex::encode(&buf[1..16]), "TX");
        self.device.write(&buf)?;
        Ok(())
    }

    /// Read one input report until either it matches `expected_cmd` or the
    /// timeout elapses. Returns the payload (bytes 8…end of one frame).
    fn read_response(&self, expected_cmd: u8, timeout_ms: i32) -> Result<Vec<u8>> {
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms as u64);
        let mut buf = [0u8; PACKET_LEN];
        loop {
            let Some(remaining_ms) = remaining_timeout_ms(deadline, std::time::Instant::now())
            else {
                return Err(Error::UnexpectedResponse(format!(
                    "timeout waiting for cmd 0x{:02x}",
                    expected_cmd,
                )));
            };
            let n = self.device.read_timeout(&mut buf, remaining_ms)?;
            if n == 0 {
                continue;
            }
            if let Some(payload) = matching_response_payload(&buf[..n], expected_cmd)? {
                return Ok(payload);
            }
            trace!("ignoring unrelated input report");
        }
    }

    /// Run a single-chunk GET transaction: send request header, await response,
    /// return up to `content_size` payload bytes from the first response packet.
    fn get(&self, cmd_byte: u8, content_size: usize) -> Result<Vec<u8>> {
        if self.transport == TransportKind::LegacyFeature {
            return Err(Error::NotImplemented(
                "this firmware does not expose official online-driver reads",
            ));
        }
        if content_size > PAYLOAD_PER_PACKET {
            // Multi-chunk responses are needed for things like custom-LED (512 bytes)
            // — implement when we reach Phase 4/5. For now we only need single packets.
            return Err(Error::NotImplemented("multi-chunk GET not yet supported"));
        }
        let frame = build_frame(cmd_byte, content_size as u8, 0, &[], true);
        trace!(cmd = cmd_byte, content_size, "GET");
        self.write_output_report(&frame)?;
        let payload = self.read_response(cmd_byte, DEFAULT_TIMEOUT_MS)?;
        Ok(payload.into_iter().take(content_size).collect())
    }

    /// Run a single-chunk SET transaction.
    fn set(&self, cmd_byte: u8, payload: &[u8]) -> Result<()> {
        if self.transport == TransportKind::LegacyFeature {
            return Err(Error::NotImplemented(
                "command is not yet mapped for supplied-driver feature transport",
            ));
        }
        if payload.len() > PAYLOAD_PER_PACKET {
            return Err(Error::NotImplemented("multi-chunk SET not yet supported"));
        }
        let frame = build_frame(cmd_byte, payload.len() as u8, 0, payload, true);
        trace!(cmd = cmd_byte, len = payload.len(), "SET");
        self.write_output_report(&frame)?;
        // Set commands echo a response — drain it so it doesn't pollute the
        // next read. Ignore errors: some firmwares don't respond to SET ops.
        let _ = self.read_response(cmd_byte, DEFAULT_TIMEOUT_MS);
        Ok(())
    }

    /// Multi-chunk GET transaction. Sends one request per chunk and concatenates
    /// the responses. Mirrors the official driver's `C()` loop for content sizes
    /// that exceed a single packet's 56-byte payload (e.g. keymap reads at 512 B).
    fn get_many(&self, cmd_byte: u8, content_size: usize) -> Result<Vec<u8>> {
        let chunk = PAYLOAD_PER_PACKET;
        let num_chunks = content_size.div_ceil(chunk).max(1);
        let mut out = Vec::with_capacity(content_size);
        for i in 0..num_chunks {
            let addr = (i * chunk) as u16;
            let remaining = content_size - i * chunk;
            let this_size = remaining.min(chunk);
            let is_last = i == num_chunks - 1;
            let frame = build_frame(cmd_byte, this_size as u8, addr, &[], is_last);
            trace!(cmd = cmd_byte, chunk = i, addr, this_size, "GET chunk");
            self.write_output_report(&frame)?;
            let payload = self.read_response(cmd_byte, DEFAULT_TIMEOUT_MS)?;
            let take = payload.len().min(this_size);
            out.extend_from_slice(&payload[..take]);
        }
        out.truncate(content_size);
        Ok(out)
    }

    /// Multi-chunk SET transaction. Slices the payload into ≤56-byte chunks
    /// and sends one request per chunk; the firmware acks each.
    fn set_many(&self, cmd_byte: u8, payload: &[u8]) -> Result<()> {
        self.set_many_at(cmd_byte, 0, payload, true)
    }

    /// Multi-chunk GET starting at an arbitrary base address.
    ///
    /// Matches the official driver's `C()` semantics: addr per chunk is
    /// `addr_base + i * PAYLOAD_PER_PACKET`. The `last_packet` flag stays
    /// `false` for non-final chunks of a GET (the firmware ignores it for
    /// reads, so this only matters for paired SET writes — see `set_many_at`).
    fn get_many_at(&self, cmd_byte: u8, addr_base: u16, content_size: usize) -> Result<Vec<u8>> {
        let chunk = PAYLOAD_PER_PACKET;
        let num_chunks = content_size.div_ceil(chunk).max(1);
        let mut out = Vec::with_capacity(content_size);
        for i in 0..num_chunks {
            let addr = addr_base.wrapping_add((i * chunk) as u16);
            let remaining = content_size - i * chunk;
            let this_size = remaining.min(chunk);
            let is_last = i == num_chunks - 1;
            let frame = build_frame(cmd_byte, this_size as u8, addr, &[], is_last);
            trace!(cmd = cmd_byte, chunk = i, addr, this_size, "GET chunk");
            self.write_output_report(&frame)?;
            let payload = self.read_response(cmd_byte, DEFAULT_TIMEOUT_MS)?;
            let take = payload.len().min(this_size);
            out.extend_from_slice(&payload[..take]);
        }
        out.truncate(content_size);
        Ok(out)
    }

    /// Multi-chunk SET starting at an arbitrary base address with explicit
    /// commit semantics.
    ///
    /// - `addr_base`: bytes 3..4 of each frame increment from this base.
    /// - `commit_on_last`: if `true`, the final chunk sets the last-packet
    ///   flag (byte 6 = 1), telling the firmware to commit the transaction.
    ///   If `false`, *every* chunk has the flag cleared (used for two-phase
    ///   writes like `SET_MACRO` where the index page is written first with
    ///   `commit=false` and the data area follows with `commit=true`).
    fn set_many_at(
        &self,
        cmd_byte: u8,
        addr_base: u16,
        payload: &[u8],
        commit_on_last: bool,
    ) -> Result<()> {
        let chunk = PAYLOAD_PER_PACKET;
        let num_chunks = payload.len().div_ceil(chunk).max(1);
        for i in 0..num_chunks {
            let addr = addr_base.wrapping_add((i * chunk) as u16);
            let start = i * chunk;
            let this_size = (payload.len() - start).min(chunk);
            let is_final_chunk = i == num_chunks - 1;
            let last_flag = commit_on_last && is_final_chunk;
            let frame = build_frame(
                cmd_byte,
                this_size as u8,
                addr,
                &payload[start..start + this_size],
                last_flag,
            );
            trace!(
                cmd = cmd_byte,
                chunk = i,
                addr,
                this_size,
                last_flag,
                "SET chunk"
            );
            self.write_output_report(&frame)?;
            let _ = self.read_response(cmd_byte, DEFAULT_TIMEOUT_MS);
        }
        Ok(())
    }

    /// Read the full 128-slot keymap (one chunked GET_KEY transaction).
    pub fn get_keymap(&self) -> Result<Keymap> {
        let payload = self.get_many(cmd::GET_KEY, KEYMAP_BYTES)?;
        Ok(Keymap::decode(&payload))
    }

    /// Read the FN-layer keymap (same shape as the base layer).
    pub fn get_fn_keymap(&self) -> Result<Keymap> {
        let payload = self.get_many(cmd::GET_FN_KEY, KEYMAP_BYTES)?;
        Ok(Keymap::decode(&payload))
    }

    /// Read the firmware's **factory-default** base keymap — what the user
    /// would get after a full reset, without actually issuing the reset.
    /// Used by the UI's "Reset to factory" button: stage these slots into
    /// the draft so the user can review before saving.
    pub fn get_default_keymap(&self) -> Result<Keymap> {
        let payload = self.get_many(cmd::GET_DEFAULT_KEY_MATRIX, KEYMAP_BYTES)?;
        Ok(Keymap::decode(&payload))
    }

    /// Read the firmware's factory-default Fn-layer keymap.
    pub fn get_default_fn_keymap(&self) -> Result<Keymap> {
        let payload = self.get_many(cmd::GET_DEFAULT_FN_KEY_MATRIX, KEYMAP_BYTES)?;
        Ok(Keymap::decode(&payload))
    }

    /// Write the full 128-slot keymap.
    pub fn set_keymap(&self, km: &Keymap) -> Result<()> {
        let payload = km.encode();
        info!(bytes = payload.len(), "SET_KEY");
        self.set_many(cmd::SET_KEY, &payload)
    }

    /// Write the FN-layer keymap.
    pub fn set_fn_keymap(&self, km: &Keymap) -> Result<()> {
        let payload = km.encode();
        info!(bytes = payload.len(), "SET_FN_KEY");
        self.set_many(cmd::SET_FN_KEY, &payload)
    }

    /// Apply a complete lighting configuration.
    pub fn set_lighting(&self, cfg: &LightingConfig) -> Result<()> {
        if self.transport == TransportKind::LegacyFeature {
            let (red, green, blue) = cfg.rgb();
            let data = lighting_data(
                cfg.mode as u8,
                red,
                green,
                blue,
                cfg.color_mode,
                cfg.brightness,
                cfg.speed,
                cfg.direction as u8,
            );
            return self.set_legacy_transaction(&lighting_preamble(), &data);
        }
        let payload = lighting::led_effect_payload(cfg);
        let (r, g, b) = cfg.rgb();
        info!(
            mode = cfg.mode.name(),
            r, g, b,
            color_mode = cfg.color_mode,
            brightness = cfg.brightness,
            speed = cfg.speed,
            direction = ?cfg.direction,
            "SET_LED_EFFECT"
        );
        self.set(cmd::SET_LED_EFFECT, &payload)
    }

    /// Read the active global lighting configuration when the firmware exposes
    /// the online-driver GET command. Supplied-driver firmware is write-only.
    pub fn get_lighting(&self) -> Result<LightingConfig> {
        let payload = self.get(cmd::GET_LED_EFFECT, lighting::LED_EFFECT_LEN)?;
        LightingConfig::parse(&payload)
    }

    /// Read every defined macro from the device.
    ///
    /// Walks the 400-byte index page, then for each non-empty slot pulls the
    /// 4-byte header and the per-action stream. Returns an `actions`-free
    /// macro for every slot that holds zero events on the device — callers
    /// can filter on `actions.is_empty()` if they want the strict list.
    pub fn get_macros(&self) -> Result<Vec<Macro>> {
        let index = self.get_many_at(cmd::GET_MACRO, 0, MACRO_INDEX_BYTES)?;
        let entries = macro_cmds::parse_index(&index);
        info!(slots_used = entries.len(), "GET_MACRO index");

        let mut macros = Vec::with_capacity(entries.len());
        for IndexEntry { macro_id, addr } in entries {
            let header = self.get_many_at(cmd::GET_MACRO, addr as u16, 4)?;
            if header.len() < 4 {
                continue;
            }
            let action_count = macro_cmds::parse_block_header(&header);
            let actions = if action_count > 0 {
                let bytes = self.get_many_at(
                    cmd::GET_MACRO,
                    addr.wrapping_add(4) as u16,
                    action_count * 4,
                )?;
                macro_cmds::parse_actions(&bytes, action_count)
            } else {
                Vec::new()
            };
            macros.push(Macro {
                macro_id,
                name: None,
                actions,
            });
        }
        Ok(macros)
    }

    /// Write a complete macro list to the device.
    ///
    /// Two-phase transaction: first the 400-byte index (no commit), then the
    /// concatenated data area at `addr = MACRO_DATA_ADDR` with the
    /// `last_packet` flag set on its final chunk.
    ///
    /// NB. To erase all macros, pass an empty slice — but note that the
    /// firmware needs at least one committed write for the change to stick;
    /// the no-data branch matches the AJAZZ driver verbatim and silently
    /// no-ops if there's nothing to write. For an "erase everything" path
    /// use `SET_FACTORY_RESET` with `MACRO_RESET = 4` (future work).
    pub fn set_macros(&self, macros: &[Macro]) -> Result<()> {
        let (index, data) = macro_cmds::encode_macros(macros)?;
        info!(
            slots = macros.iter().filter(|m| !m.actions.is_empty()).count(),
            data_bytes = data.len(),
            "SET_MACRO"
        );

        // Phase 1: write index (no commit yet).
        self.set_many_at(cmd::SET_MACRO, 0, &index, false)?;

        // Phase 2: write data area (commits the transaction).
        if !data.is_empty() {
            self.set_many_at(cmd::SET_MACRO, MACRO_DATA_ADDR, &data, true)?;
        }
        Ok(())
    }

    /// Select a firmware-provided TFT animation on the control endpoint.
    /// Index zero is the factory default used by the official driver.
    pub fn set_tft_built_in_index(&self, index: u8) -> Result<()> {
        info!(index, "SET_TFT_BUILT_IN_INDEX");
        self.set(cmd::SET_TFT_BUILT_IN_INDEX, &[index])
    }

    /// Synchronise the TFT's onboard clock with the supplied host time.
    pub fn set_tft_datetime(&self, datetime: TftDateTime) -> Result<()> {
        if self.transport == TransportKind::LegacyFeature {
            datetime.encode()?;
            let data = clock_data(
                datetime.year,
                datetime.month,
                datetime.day,
                datetime.hour,
                datetime.minute,
                datetime.second,
                datetime.weekday,
            );
            return self.set_legacy_clock(&data);
        }
        let payload = datetime.encode()?;
        info!(?datetime, "SET_TFT_DATE_TIME");
        self.set(cmd::SET_TEMPORARY_COMMAND_DATA, &payload)
    }

    /// Open the **TFT upload** interface — a different HID endpoint than the
    /// one returned by `open_control()`. The TFT path uses 4096-byte payload
    /// chunks (vs 56-byte chunks elsewhere), so it has its own HID interface
    /// on the device (`usage_page = 0xFF67` on the AK820 Pro, confirmed by
    /// inspecting the report descriptor with `probe_interfaces()` — the
    /// `0xFF67` collection advertises a 4104-byte output report).
    ///
    /// Selection precedence: `AK820_TFT_USAGE_PAGE` env override, then
    /// `0xFF68` for supplied-driver firmware or `0xFF67` for online-driver
    /// firmware. The supplied-driver upload also opens its `0xFF13` control
    /// collection for the START / image-preamble / SAVE transaction.
    pub fn open_tft() -> Result<Self> {
        let candidates = enumerate()?;
        let has_legacy_control = candidates
            .iter()
            .any(|candidate| candidate.usage_page == 0xFF13);
        let has_online_tft = candidates
            .iter()
            .any(|candidate| candidate.usage_page == 0xFF67);
        let legacy = has_legacy_control && !has_online_tft;
        let want_usage_page = std::env::var("AK820_TFT_USAGE_PAGE")
            .ok()
            .and_then(|v| u16::from_str_radix(v.trim_start_matches("0x"), 16).ok())
            .unwrap_or(if legacy { 0xFF68 } else { 0xFF67 });
        let pick = candidates
            .iter()
            .find(|d| d.usage_page == want_usage_page)
            .cloned()
            .ok_or(Error::DeviceNotFound {
                vid: VENDOR_ID,
                interface: -1,
            })?;
        let api = HidApi::new()?;
        let legacy_control = if legacy {
            let control = candidates
                .iter()
                .find(|candidate| candidate.usage_page == 0xFF13)
                .ok_or(Error::DeviceNotFound {
                    vid: VENDOR_ID,
                    interface: CONTROL_INTERFACE,
                })?;
            let handle = api.open_path(&std::ffi::CString::new(control.path.clone()).unwrap())?;
            handle.set_blocking_mode(true)?;
            Some(handle)
        } else {
            None
        };
        // On macOS, acquire the 0xFF13 transaction endpoint before 0xFF68.
        // Opening them in the opposite order can make the first SetReport on
        // the control collection time out even though each endpoint opens.
        let device = api.open_path(&std::ffi::CString::new(pick.path.clone()).unwrap())?;
        device.set_blocking_mode(true)?;
        info!(
            path = %pick.path,
            interface = pick.interface,
            usage_page = format!("0x{:04x}", pick.usage_page),
            transport = if legacy { "supplied-driver" } else { "online-driver" },
            "opened TFT upload interface"
        );
        Ok(Self {
            device,
            legacy_control,
            info: pick,
            transport: if legacy {
                TransportKind::LegacyTft
            } else {
                TransportKind::OnlineOutput
            },
        })
    }

    /// Best-effort recovery for a supplied-driver TFT transaction after the
    /// data handle has been closed. This opens only 0xFF13 and sends FINISH so
    /// a failed image report cannot leave the keyboard UI/TFT state machine
    /// wedged until a physical power cycle.
    pub fn recover_legacy_tft_transaction() -> Result<()> {
        let candidates = enumerate()?;
        let control = candidates
            .iter()
            .find(|candidate| candidate.usage_page == 0xFF13)
            .ok_or(Error::DeviceNotFound {
                vid: VENDOR_ID,
                interface: CONTROL_INTERFACE,
            })?;
        let api = HidApi::new()?;
        let device = api.open_path(&std::ffi::CString::new(control.path.clone()).unwrap())?;
        device.set_blocking_mode(true)?;
        legacy_feature_send(&device, &finish_payload())?;
        Ok(())
    }

    /// Upload a TFT animation as a single chunked transaction. Re-uses our
    /// existing `TftAnimation::encode()` for the 256-B-header + RGB565 stream
    /// and applies the bespoke 8-B per-chunk header — both decoded from the
    /// AJAZZ online driver.
    ///
    /// The chunk payload size is read from the device's HID descriptor (the
    /// `Items.reportCount` field in the JS source). For the AK820 Pro this
    /// is 4104 bytes per output report → 4096 bytes of payload after the
    /// 8-byte custom header.
    ///
    /// Must be called on a connection opened via `open_tft()` — the control
    /// interface's 64-byte report can't carry these chunks.
    pub fn upload_tft_animation(&self, anim: &TftAnimation) -> Result<()> {
        self.upload_tft_animation_with_progress(anim, |_, _| Ok(()))
    }

    /// Upload an animation while reporting completed and total chunks.
    /// Returning an error from `progress` stops before the next HID write,
    /// which gives callers a safe cancellation point between reports.
    pub fn upload_tft_animation_with_progress<F>(
        &self,
        anim: &TftAnimation,
        mut progress: F,
    ) -> Result<()>
    where
        F: FnMut(usize, usize) -> Result<()>,
    {
        if self.transport == TransportKind::LegacyTft {
            return self.upload_legacy_tft_animation(anim, progress);
        }
        // Sanity-check the interface — if we're on the wrong one the
        // hidapi write will quietly fail with a frame-too-long error on macOS.
        if self.info.usage_page == 0xFF68 {
            return Err(Error::UnexpectedResponse(
                "upload_tft_animation called on the 0xFF68 control interface; \
                 use Connection::open_tft() to get the 0xFF67 4 KB-report interface"
                    .into(),
            ));
        }

        let payload = anim.encode()?;
        const HEADER_LEN: usize = 8;
        const TFT_REPORT_LEN: usize = 4104;
        const TFT_PAYLOAD_LEN: usize = TFT_REPORT_LEN - HEADER_LEN; // 4096

        let total_chunks = payload.len().div_ceil(TFT_PAYLOAD_LEN).max(1);
        if total_chunks > u16::MAX as usize {
            return Err(Error::OutOfRange {
                field: "tft chunk count",
                value: total_chunks as i64,
                max: u16::MAX as i64,
            });
        }

        info!(
            bytes = payload.len(),
            chunks = total_chunks,
            "SET_TFT_USER_ANIMATION upload"
        );

        progress(0, total_chunks)?;

        // Pre-allocated per-chunk buffer: 1 report-id byte + 8 header + 4096 payload.
        let mut report = vec![0u8; 1 + TFT_REPORT_LEN];
        for i in 0..total_chunks {
            let start = i * TFT_PAYLOAD_LEN;
            let end = (start + TFT_PAYLOAD_LEN).min(payload.len());
            let header =
                build_tft_header(cmd::SET_TFT_USER_ANIMATION, i as u16, total_chunks as u16);

            // Reset payload region to zero (header overwrites bytes 1..9).
            for b in &mut report[1..] {
                *b = 0;
            }
            report[0] = REPORT_ID;
            report[1..1 + HEADER_LEN].copy_from_slice(&header);
            let dst = &mut report[1 + HEADER_LEN..1 + HEADER_LEN + (end - start)];
            dst.copy_from_slice(&payload[start..end]);

            trace!(chunk = i, total = total_chunks, "TFT TX");
            self.device.write(&report)?;
            progress(i + 1, total_chunks)?;
        }
        Ok(())
    }

    fn upload_legacy_tft_animation<F>(&self, anim: &TftAnimation, mut progress: F) -> Result<()>
    where
        F: FnMut(usize, usize) -> Result<()>,
    {
        use crate::commands::tft::LEGACY_REPORT_BYTES;

        const USER_IMAGE_SLOT: u8 = 2;
        // The device can accept the host-side writes while still dropping
        // image blocks internally. Waiting for its optional response provides
        // the pacing required by the connected legacy firmware.
        const ACK_TIMEOUT_MS: i32 = 300;

        let control = self.legacy_control.as_ref().ok_or_else(|| {
            Error::UnexpectedResponse("legacy TFT control interface is not open".into())
        })?;
        let payload = anim.encode_legacy()?;
        let total_chunks = payload.len() / LEGACY_REPORT_BYTES;
        let chunk_count = u16::try_from(total_chunks).map_err(|_| Error::OutOfRange {
            field: "legacy TFT chunk count",
            value: total_chunks as i64,
            max: u16::MAX as i64,
        })?;

        info!(
            frames = anim.frames.len(),
            bytes = payload.len(),
            chunks = total_chunks,
            "supplied-driver TFT animation upload"
        );

        let result = (|| {
            legacy_feature_exchange(control, &start_payload())
                .map_err(|error| tft_stage_error("START", error))?;
            legacy_pause();
            legacy_feature_exchange(control, &tft_image_preamble(USER_IMAGE_SLOT, chunk_count))
                .map_err(|error| tft_stage_error("image preamble", error))?;
            legacy_pause();

            progress(0, total_chunks)?;
            let mut report = vec![0u8; LEGACY_REPORT_BYTES + 1];
            let mut response = vec![0u8; LEGACY_REPORT_BYTES];
            for (index, chunk) in payload.chunks_exact(LEGACY_REPORT_BYTES).enumerate() {
                report[0] = 0;
                report[1..].copy_from_slice(chunk);
                self.device
                    .write(&report)
                    .map_err(|error| tft_stage_error("image report", error.into()))?;
                // Do not remove this wait merely because the response is
                // optional. A non-blocking experiment completed every host
                // write but the keyboard stopped loading at 71%.
                let _ = self.device.read_timeout(&mut response, ACK_TIMEOUT_MS);
                progress(index + 1, total_chunks)?;
            }

            legacy_pause();
            legacy_feature_exchange(control, &save_payload())
                .map_err(|error| tft_stage_error("SAVE", error))?;
            // Close the transaction after SAVE. Without this, the image can
            // render while the keyboard's own TFT menu remains stuck until a
            // power cycle. No response is expected for FINISH.
            legacy_pause();
            legacy_feature_send(control, &finish_payload())
                .map_err(|error| tft_stage_error("FINISH", error))?;
            Ok(())
        })();

        if result.is_err() {
            let _ = legacy_feature_send(control, &finish_payload());
        }
        result
    }

    /// Read the 128-LED per-key colour map.
    pub fn get_custom_led(&self) -> Result<CustomLedMap> {
        let payload = self.get_many_at(cmd::GET_CUSTOM_LED_DATA, 0, CUSTOM_LED_BYTES)?;
        Ok(CustomLedMap::decode(&payload))
    }

    /// Write the 128-LED per-key colour map. Caller is responsible for
    /// switching the active lighting effect to one that reads from this
    /// buffer (the standard 20 modes ignore it).
    pub fn set_custom_led(&self, map: &CustomLedMap) -> Result<()> {
        let payload = map.encode();
        info!(bytes = payload.len(), "SET_CUSTOM_LED_DATA");
        self.set_many_at(cmd::SET_CUSTOM_LED_DATA, 0, &payload, true)
    }

    /// Read the device-info struct (firmware, battery, profile, …).
    pub fn get_device_info(&self) -> Result<DeviceInfoReport> {
        let payload = self.get(cmd::GET_DEVICE_INFO, 48)?;
        Ok(DeviceInfoReport::parse(&payload))
    }

    /// Read the game-mode struct (sleep timer, key delay, report rate, …).
    pub fn get_game_mode(&self) -> Result<GameMode> {
        let payload = self.get(cmd::GET_GAME_MODE, 56)?;
        Ok(GameMode::parse(&payload))
    }

    /// Write the game-mode struct. Sends all 56 bytes — callers should
    /// usually `get_game_mode` first, mutate one field, then `set_game_mode`.
    pub fn set_game_mode(&self, gm: &GameMode) -> Result<()> {
        let payload = gm.serialize();
        info!(
            sleep_time = gm.sleep_time,
            game_mode = gm.game_mode,
            "SET_GAME_MODE"
        );
        self.set(cmd::SET_GAME_MODE, &payload)
    }

    pub fn set_legacy_system_settings(&self, settings: &LegacySystemSettings) -> Result<()> {
        if self.transport != TransportKind::LegacyFeature {
            return Err(Error::NotImplemented(
                "legacy system settings require supplied-driver firmware",
            ));
        }
        settings.validate()?;
        let data = system_data(
            settings.disable_windows_key,
            settings.disable_alt_f4,
            settings.disable_alt_tab,
            settings.fn_switch,
            settings.sleep_time,
            settings.key_response_level,
        );
        // Exact supplied-driver sequence: START, 0x17 preamble, data, SAVE.
        // Unlike lighting, this command does not send a FINISH frame.
        legacy_feature_exchange(&self.device, &start_payload())?;
        legacy_pause();
        legacy_feature_exchange(&self.device, &system_preamble())?;
        legacy_pause();
        legacy_feature_send(&self.device, &data)?;
        legacy_pause();
        legacy_feature_exchange(&self.device, &save_payload())?;
        Ok(())
    }

    fn set_legacy_transaction(
        &self,
        preamble: &[u8; crate::legacy_protocol::PAYLOAD_LEN],
        data: &[u8; crate::legacy_protocol::PAYLOAD_LEN],
    ) -> Result<()> {
        let result = (|| {
            debug!("legacy transaction: START");
            legacy_feature_exchange(&self.device, &start_payload())?;
            legacy_pause();
            debug!(command = preamble[1], "legacy transaction: preamble");
            legacy_feature_exchange(&self.device, preamble)?;
            legacy_pause();
            debug!("legacy transaction: data");
            legacy_feature_send(&self.device, data)?;
            legacy_pause();
            debug!("legacy transaction: SAVE");
            legacy_feature_exchange(&self.device, &save_payload())?;
            Ok(())
        })();

        debug!("legacy transaction: FINISH");
        let finish_result = legacy_feature_send(&self.device, &finish_payload());
        result.and(finish_result.map(|_| ()))
    }

    fn set_legacy_clock(&self, data: &[u8; crate::legacy_protocol::PAYLOAD_LEN]) -> Result<()> {
        let result = (|| {
            debug!("legacy clock: START");
            legacy_feature_exchange(&self.device, &start_payload())?;
            legacy_pause();
            debug!("legacy clock: preamble");
            legacy_feature_exchange(&self.device, &clock_preamble())?;
            legacy_pause();
            debug!("legacy clock: data");
            legacy_feature_exchange(&self.device, data)?;
            legacy_pause();
            debug!("legacy clock: SAVE");
            legacy_feature_exchange(&self.device, &save_payload())?;
            Ok(())
        })();

        if result.is_err() {
            debug!("legacy clock: cleanup FINISH");
            let _ = legacy_feature_send(&self.device, &finish_payload());
        }
        result
    }
}

fn tft_stage_error(stage: &str, error: Error) -> Error {
    Error::UnexpectedResponse(format!("legacy TFT {stage} failed: {error}"))
}

fn legacy_pause() {
    std::thread::sleep(std::time::Duration::from_millis(10));
}

fn legacy_feature_send(
    device: &HidDevice,
    payload: &[u8; crate::legacy_protocol::PAYLOAD_LEN],
) -> Result<usize> {
    let report = feature_report(payload);
    device.send_feature_report(&report)?;
    Ok(report.len())
}

fn legacy_feature_read(device: &HidDevice) -> Result<Vec<u8>> {
    let mut response = [0u8; FEATURE_REPORT_LEN];
    response[0] = 0;
    let size = device.get_feature_report(&mut response)?;
    Ok(response[..size].to_vec())
}

fn legacy_feature_exchange(
    device: &HidDevice,
    payload: &[u8; crate::legacy_protocol::PAYLOAD_LEN],
) -> Result<Vec<u8>> {
    legacy_feature_send(device, payload)?;
    legacy_feature_read(device)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeReport {
    pub connected: bool,
    pub interface: i32,
    pub product: Option<String>,
    pub firmware_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BatteryStatus {
    pub battery_level: u8,
    /// The receiver protocol reports percentage only; it does not report
    /// whether the keyboard is charging.
    pub charging: Option<bool>,
    pub source: String,
}

#[cfg(test)]
mod device_tests {
    use super::*;

    #[test]
    fn malformed_matching_response_is_rejected() {
        let err = matching_response_payload(
            &[MAGIC_INCOMING, cmd::GET_DEVICE_INFO],
            cmd::GET_DEVICE_INFO,
        )
        .unwrap_err();
        assert!(matches!(err, Error::UnexpectedResponse(_)));
    }

    #[test]
    fn unrelated_input_report_is_ignored() {
        assert!(
            matching_response_payload(&[0; HEADER_LEN], cmd::GET_DEVICE_INFO)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn expired_deadline_has_no_remaining_timeout() {
        let now = std::time::Instant::now();
        assert_eq!(remaining_timeout_ms(now, now), None);
        assert_eq!(
            remaining_timeout_ms(now + std::time::Duration::from_millis(25), now),
            Some(25)
        );
    }

    #[test]
    fn legacy_transport_rejects_online_frames_before_hid_io() {
        assert!(TransportKind::OnlineOutput.ensure_online_output().is_ok());
        assert!(matches!(
            TransportKind::LegacyFeature.ensure_online_output(),
            Err(Error::NotImplemented(_))
        ));
    }

    #[test]
    fn legacy_battery_request_matches_supplied_driver() {
        let request = legacy_battery_request();
        assert_eq!(request.len(), 33);
        assert_eq!(&request[..4], &[0, 0x20, 0x01, 0]);
        assert_eq!(request[32], 0x21);
        assert!(request[3..32].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn legacy_battery_response_accepts_numbered_and_unnumbered_shapes() {
        assert_eq!(
            parse_legacy_battery_response(&[0x20, 0x01, 0, 73]).unwrap(),
            Some(73)
        );
        assert_eq!(
            parse_legacy_battery_response(&[0, 0x20, 0x01, 0, 64]).unwrap(),
            Some(64)
        );
    }

    #[test]
    fn legacy_battery_response_rejects_invalid_values() {
        assert_eq!(
            parse_legacy_battery_response(&[0x20, 0x01, 0, 0]).unwrap(),
            None
        );
        assert!(parse_legacy_battery_response(&[0x20, 0x01, 0, 101]).is_err());
        assert_eq!(
            parse_legacy_battery_response(&[0x04, 0x20, 0x01, 50]).unwrap(),
            None
        );
    }
}
