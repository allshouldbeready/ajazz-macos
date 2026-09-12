//! Feature-report framing used by the supplied AJAZZ Windows application.
//!
//! The collection has no HID report IDs. Windows therefore passes a leading
//! zero byte to `HidD_SetFeature`, followed by the 64-byte vendor payload. The
//! older Linux implementations incorrectly made `0x04` the report ID.

pub const FEATURE_REPORT_LEN: usize = 65;
pub const PAYLOAD_LEN: usize = FEATURE_REPORT_LEN - 1;

const PREFIX: u8 = 0x04;
const START: u8 = 0x18;
const SAVE: u8 = 0x02;
const FINISH: u8 = 0xF0;
const LIGHTING: u8 = 0x13;
const CLOCK: u8 = 0x28;

fn control_payload(command: u8, byte2: u8, byte8: u8) -> [u8; PAYLOAD_LEN] {
    let mut payload = [0u8; PAYLOAD_LEN];
    payload[0] = PREFIX;
    payload[1] = command;
    payload[2] = byte2;
    payload[8] = byte8;
    payload
}

pub fn start_payload() -> [u8; PAYLOAD_LEN] {
    control_payload(START, 0, 1)
}

pub fn finish_payload() -> [u8; PAYLOAD_LEN] {
    control_payload(FINISH, 0, 1)
}

pub fn save_payload() -> [u8; PAYLOAD_LEN] {
    control_payload(SAVE, 0, 0)
}

pub fn lighting_preamble() -> [u8; PAYLOAD_LEN] {
    control_payload(LIGHTING, 0, 1)
}

pub fn clock_preamble() -> [u8; PAYLOAD_LEN] {
    control_payload(CLOCK, 0, 1)
}

pub fn clock_data(
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    weekday: u8,
) -> [u8; PAYLOAD_LEN] {
    let mut payload = [0u8; PAYLOAD_LEN];
    payload[0] = 0;
    payload[1] = 1;
    payload[2] = 0x5A;
    payload[3] = year.saturating_sub(2000).min(u8::MAX as u16) as u8;
    payload[4] = month;
    payload[5] = day;
    payload[6] = hour;
    payload[7] = minute;
    payload[8] = second;
    payload[10] = weekday;
    payload[PAYLOAD_LEN - 2] = 0xAA;
    payload[PAYLOAD_LEN - 1] = 0x55;
    payload
}

#[allow(clippy::too_many_arguments)]
pub fn lighting_data(
    mode: u8,
    red: u8,
    green: u8,
    blue: u8,
    color_mode: u8,
    brightness: u8,
    speed: u8,
    direction: u8,
) -> [u8; PAYLOAD_LEN] {
    let mut payload = [0u8; PAYLOAD_LEN];
    payload[0] = mode;
    payload[1] = red;
    payload[2] = green;
    payload[3] = blue;
    payload[8] = color_mode;
    payload[9] = brightness.min(5);
    payload[10] = speed.min(5);
    payload[11] = direction;
    payload[14] = 0x55;
    payload[15] = 0xAA;
    payload
}

pub fn feature_report(payload: &[u8; PAYLOAD_LEN]) -> [u8; FEATURE_REPORT_LEN] {
    let mut report = [0u8; FEATURE_REPORT_LEN];
    report[1..].copy_from_slice(payload);
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_report_matches_supplied_installer() {
        let report = feature_report(&start_payload());
        assert_eq!(&report[..4], &[0x00, 0x04, 0x18, 0x00]);
        assert_eq!(report[9], 1);
        assert!(report[10..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn finish_report_matches_supplied_installer() {
        let report = feature_report(&finish_payload());
        assert_eq!(&report[..4], &[0x00, 0x04, 0xF0, 0x00]);
        assert_eq!(report[9], 1);
    }

    #[test]
    fn save_report_matches_supplied_installer() {
        let report = feature_report(&save_payload());
        assert_eq!(&report[..4], &[0x00, 0x04, 0x02, 0x00]);
        assert_eq!(report[9], 0);
        assert!(report[10..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn lighting_transaction_matches_supplied_installer() {
        let preamble = feature_report(&lighting_preamble());
        assert_eq!(&preamble[..4], &[0x00, 0x04, 0x13, 0x00]);
        assert_eq!(preamble[9], 1);

        let data = feature_report(&lighting_data(7, 0x11, 0x22, 0x33, 2, 4, 5, 3));
        assert_eq!(&data[..5], &[0x00, 7, 0x11, 0x22, 0x33]);
        assert_eq!(&data[9..13], &[2, 4, 5, 3]);
        assert_eq!(&data[15..17], &[0x55, 0xAA]);
    }

    #[test]
    fn clock_packets_match_supplied_installer() {
        let preamble = feature_report(&clock_preamble());
        assert_eq!(&preamble[..4], &[0x00, 0x04, 0x28, 0x00]);
        assert_eq!(preamble[9], 1);

        let data = feature_report(&clock_data(2026, 9, 12, 19, 7, 45, 6));
        assert_eq!(&data[..12], &[0, 0, 1, 0x5A, 26, 9, 12, 19, 7, 45, 0, 6]);
        assert_eq!(&data[63..], &[0xAA, 0x55]);
    }
}
