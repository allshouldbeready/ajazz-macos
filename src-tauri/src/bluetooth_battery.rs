use serde::Serialize;
use serde_json::Value;

use crate::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BluetoothBatteryStatus {
    pub paired: bool,
    pub connected: bool,
    pub battery_level: Option<u8>,
    pub source: &'static str,
}

fn percentage(value: &Value) -> Option<u8> {
    let raw = value.as_str()?.trim().trim_end_matches('%');
    raw.parse::<u8>().ok().filter(|level| *level <= 100)
}

fn battery_from_details(details: &serde_json::Map<String, Value>) -> Option<u8> {
    details
        .get("device_batteryLevelMain")
        .and_then(percentage)
        .or_else(|| {
            details.iter().find_map(|(key, value)| {
                key.starts_with("device_batteryLevel")
                    .then(|| percentage(value))
                    .flatten()
            })
        })
}

fn find_in_bucket(value: &Value, bucket: &str, connected: bool) -> Option<BluetoothBatteryStatus> {
    match value {
        Value::Object(object) => {
            if let Some(Value::Array(devices)) = object.get(bucket) {
                for device in devices {
                    let Some(entries) = device.as_object() else {
                        continue;
                    };
                    for (name, details) in entries {
                        if !name.to_ascii_lowercase().contains("ak820") {
                            continue;
                        }
                        let battery_level = details.as_object().and_then(battery_from_details);
                        return Some(BluetoothBatteryStatus {
                            paired: true,
                            connected,
                            battery_level,
                            source: "macos-bluetooth",
                        });
                    }
                }
            }
            object
                .values()
                .find_map(|child| find_in_bucket(child, bucket, connected))
        }
        Value::Array(array) => array
            .iter()
            .find_map(|child| find_in_bucket(child, bucket, connected)),
        _ => None,
    }
}

fn parse_system_profiler(value: &Value) -> BluetoothBatteryStatus {
    find_in_bucket(value, "device_connected", true)
        .or_else(|| find_in_bucket(value, "device_not_connected", false))
        .unwrap_or(BluetoothBatteryStatus {
            paired: false,
            connected: false,
            battery_level: None,
            source: "macos-bluetooth",
        })
}

#[cfg(target_os = "macos")]
pub fn query() -> Result<BluetoothBatteryStatus, AppError> {
    let output = std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPBluetoothDataType", "-json", "-detailLevel", "mini"])
        .output()
        .map_err(|error| AppError::Protocol(format!("could not query macOS Bluetooth: {error}")))?;
    if !output.status.success() {
        return Err(AppError::Protocol(
            "macOS Bluetooth query did not complete successfully".into(),
        ));
    }
    let report: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| AppError::Protocol(format!("invalid macOS Bluetooth report: {error}")))?;
    Ok(parse_system_profiler(&report))
}

#[cfg(not(target_os = "macos"))]
pub fn query() -> Result<BluetoothBatteryStatus, AppError> {
    Err(AppError::Protocol(
        "Bluetooth battery discovery is available only on macOS".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_connected_keyboard_battery() {
        let report = json!({
            "SPBluetoothDataType": [{
                "device_connected": [{
                    "AK820 5.1-1": {
                        "device_minorType": "Keyboard",
                        "device_batteryLevelMain": "73%"
                    }
                }]
            }]
        });
        assert_eq!(
            parse_system_profiler(&report),
            BluetoothBatteryStatus {
                paired: true,
                connected: true,
                battery_level: Some(73),
                source: "macos-bluetooth",
            }
        );
    }

    #[test]
    fn distinguishes_paired_but_disconnected() {
        let report = json!({
            "SPBluetoothDataType": [{
                "device_not_connected": [{"AK820 5.1-1": {"device_minorType": "Keyboard"}}]
            }]
        });
        let status = parse_system_profiler(&report);
        assert!(status.paired);
        assert!(!status.connected);
        assert_eq!(status.battery_level, None);
    }

    #[test]
    fn ignores_other_bluetooth_batteries() {
        let report = json!({
            "SPBluetoothDataType": [{
                "device_connected": [{"Headphones": {"device_batteryLevelMain": "99%"}}]
            }]
        });
        let status = parse_system_profiler(&report);
        assert!(!status.paired);
        assert_eq!(status.battery_level, None);
    }
}
