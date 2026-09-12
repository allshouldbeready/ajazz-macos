//! Host-to-keyboard clock synchronisation for the onboard TFT.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{Error, Result};

/// Calendar fields accepted by the AK820 Pro TFT clock command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TftDateTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    /// Sunday = 0 through Saturday = 6, matching the official driver.
    pub weekday: u8,
}

impl TftDateTime {
    pub fn now_local() -> Self {
        let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
        Self {
            year: now.year() as u16,
            month: now.month() as u8,
            day: now.day(),
            hour: now.hour(),
            minute: now.minute(),
            second: now.second(),
            weekday: now.weekday().number_days_from_sunday(),
        }
    }

    /// Encode the 10-byte payload sent with `SET_TEMPORARY_COMMAND_DATA` (52).
    pub fn encode(self) -> Result<[u8; 10]> {
        if !(2000..=2099).contains(&self.year)
            || !(1..=12).contains(&self.month)
            || !(1..=31).contains(&self.day)
            || self.hour > 23
            || self.minute > 59
            || self.second > 59
            || self.weekday > 6
        {
            return Err(Error::UnexpectedResponse(
                "TFT clock fields are outside the supported range".into(),
            ));
        }

        Ok([
            0x5A,
            0x01,
            0x5A,
            (self.year % 100) as u8,
            self.month,
            self.day,
            self.hour,
            self.minute,
            self.second,
            self.weekday,
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_official_tft_clock_packet() {
        let clock = TftDateTime {
            year: 2026,
            month: 9,
            day: 12,
            hour: 19,
            minute: 7,
            second: 45,
            weekday: 6,
        };
        assert_eq!(
            clock.encode().unwrap(),
            [0x5A, 0x01, 0x5A, 26, 9, 12, 19, 7, 45, 6]
        );
    }

    #[test]
    fn rejects_invalid_clock_fields() {
        let invalid = TftDateTime {
            year: 2026,
            month: 13,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
            weekday: 0,
        };
        assert!(invalid.encode().is_err());
    }
}
