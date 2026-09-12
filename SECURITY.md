# Security policy

## Supported versions

Pre-1.0 security fixes are made on the current `main` branch only.

| Version | Supported |
|---|---|
| 0.7.x beta / `main` | Yes |
| Older versions | No |

## Security and safety model

AJAZZ macOS controls a USB HID device and can run explicitly configured local
automations. Important boundaries are:

- Hardware writes require an in-app confirmation for the current connection,
  are serialized, and target configuration endpoints only.
- Firmware-update and bootloader devices are excluded from discovery and are
  never accessed.
- Built-in HTTP requests are allowlisted only to GIPHY-controlled hosts and
  occur after the user supplies a key and starts a search. Browser links and
  user-created automations can contact other services. See [PRIVACY.md](PRIVACY.md).
- AppleScript, Shortcuts, and shell automations run with the user's macOS
  permissions. Do not import or run commands you do not understand.
- Current builds are unsigned and not notarized. There are no official public
  binary releases yet; build from source and verify the repository revision.

If the keyboard behaves unexpectedly, stop writes, unplug and reconnect it,
then use the app-level factory-default action if appropriate. This project does
not provide firmware flashing, bootloader, pin-shorting, or physical repair
instructions. Use manufacturer support if normal reconnection and documented
configuration recovery do not work.

## Reporting a vulnerability

Please use a [private GitHub security advisory](https://github.com/allshouldbeready/ajazz-macos/security/advisories/new).
Do not publish credentials, serial numbers, private media, packet captures, or
exploitable details in a public issue.

Reports about unsafe hardware writes, command execution outside the user's
explicit automation, unintended file access, network access beyond the GIPHY
allowlist, or privilege escalation are in scope. Keyboard firmware defects are
outside this project's control and should also be reported to the manufacturer.

We aim to acknowledge reports within seven days. Response and remediation time
depends on severity, reproducibility, and access to affected hardware.
