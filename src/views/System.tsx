import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge, BatteryBar, Button, Card, ErrorBanner, KVList, Mono, Toggle, formatInt, hex4 } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { invokeDeviceWrite } from "../device-write";
import { formatError } from "../errors";
import { loadLastApplied, saveLastApplied } from "../device-state";

interface DeviceInfoReport {
  rom_size: number;
  macro_space_size: number;
  vid: number;
  pid: number;
  firmware_version: number;
  sensor: number;
  manufacturer_id: number;
  product_id: number;
  work_mode: number;
  battery_level: number;
  charge_status: number;
  current_profile: number;
  axis_info: number;
  tft_max_frames: number;
  gif_max_frames: number;
  led_max_frames: number;
  tft_direction: number;
  rt_precision: number;
  frame_version: number;
  lighting_version: number;
}

interface GameMode {
  game_mode: number;
  fn_switch: number;
  sleep_time: number;
  key_delay: number;
  report_rate: number;
  system_mode: number;
  tft_display_time: number;
  top_dead_zone: number;
  bottom_dead_zone: number;
  stability_mode: number;
  auto_calibration: number;
  single_key_wakeup: number;
}

interface SleepPreset {
  value: number;
  label: string;
}

interface DeviceCandidate {
  pid: number;
}

interface BatteryStatus {
  battery_level: number;
  charging: boolean | null;
  source: string;
}

interface LegacySystemSettings {
  disable_windows_key: boolean;
  disable_alt_f4: boolean;
  disable_alt_tab: boolean;
  fn_switch: boolean;
  sleep_time: number;
  key_response_level: number;
}

const LEGACY_SLEEP_PRESETS: SleepPreset[] = [
  { value: 0, label: "never" },
  { value: 1, label: "1 minute" },
  { value: 2, label: "5 minutes" },
  { value: 3, label: "30 minutes" },
];

interface TftDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function System() {
  const [info, setInfo] = useState<DeviceInfoReport | null>(null);
  const [gm, setGm] = useState<GameMode | null>(null);
  const [draft, setDraft] = useState<GameMode | null>(null);
  const [presets, setPresets] = useState<SleepPreset[]>([]);
  const [transport, setTransport] = useState<"online-output" | "legacy-feature" | null>(null);
  const [legacySettings, setLegacySettings] = useState<LegacySystemSettings>(() =>
    loadLastApplied<LegacySystemSettings>("system")?.value ?? {
      disable_windows_key: false,
      disable_alt_f4: false,
      disable_alt_tab: false,
      fn_switch: false,
      sleep_time: 1,
      key_response_level: 1,
    },
  );
  const [legacySavedAt, setLegacySavedAt] = useState<string | null>(
    () => loadLastApplied<LegacySystemSettings>("system")?.savedAt ?? null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clockSync, setClockSync] = useState<TftDateTime | null>(null);
  const [receiverBattery, setReceiverBattery] = useState<BatteryStatus | null>(null);
  const [batteryNote, setBatteryNote] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const p = await invoke<SleepPreset[]>("list_sleep_presets");
      setPresets(p);
      const t = await invoke<"online-output" | "legacy-feature">("get_transport_kind");
      setTransport(t);
      if (t === "legacy-feature") {
        // This firmware uses the supplied Windows driver's feature reports.
        // Do not attempt incompatible online reads merely to populate cards.
        setInfo(null);
        setGm(null);
        setDraft(null);
        const devices = await invoke<DeviceCandidate[]>("list_devices");
        if (devices.some((device) => device.pid === 0xfdfd)) {
          try {
            const battery = await invoke<BatteryStatus>("get_receiver_battery");
            setReceiverBattery(battery);
            setBatteryNote("Read from the connected 2.4 GHz receiver. Charging state is not provided.");
          } catch (batteryError) {
            setReceiverBattery(null);
            setBatteryNote(`The receiver did not return a valid battery value: ${formatError(batteryError)}`);
          }
        } else {
          setReceiverBattery(null);
          setBatteryNote("Battery is unavailable over wired USB. Connect the 2.4 GHz receiver to read it without changing firmware.");
        }
        const remembered = loadLastApplied<LegacySystemSettings>("system");
        if (remembered) {
          setLegacySettings(remembered.value);
          setLegacySavedAt(remembered.savedAt);
        }
        return;
      }
      // Sequential because both reads hold the persistent HID mutex.
      const i = await invoke<DeviceInfoReport>("get_device_info");
      setInfo(i);
      const g = await invoke<GameMode>("get_game_mode");
      setGm(g);
      setDraft(g);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveSystemSettings() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await invokeDeviceWrite(
        "set_game_mode",
        { mode: draft },
        "Save the sleep, response, game, and onboard system settings shown on this page.",
      );
      const readback = await invoke<GameMode>("get_game_mode");
      setGm(readback);
      setDraft(readback);
      if (JSON.stringify(readback) !== JSON.stringify(draft)) {
        setErr("The keyboard read-back differs from the requested settings. Displaying the values it accepted.");
      }
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveLegacySystemSettings() {
    setBusy(true);
    setErr(null);
    try {
      await invokeDeviceWrite(
        "set_legacy_system_settings",
        { settings: legacySettings },
        "Save Windows-key, shortcut-lock, Fn, sleep, and key-response settings. This firmware cannot read the previous values back.",
      );
      setLegacySavedAt(saveLastApplied("system", legacySettings).savedAt);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  function updateLegacy<K extends keyof LegacySystemSettings>(key: K, value: LegacySystemSettings[K]) {
    setLegacySavedAt(null);
    setLegacySettings((current) => ({ ...current, [key]: value }));
  }

  function updateDraft<K extends keyof GameMode>(key: K, value: GameMode[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  const hasChanges = gm !== null && draft !== null && JSON.stringify(gm) !== JSON.stringify(draft);

  async function syncClock() {
    setBusy(true);
    setErr(null);
    try {
      const synced = await invokeDeviceWrite<TftDateTime>(
        "sync_clock",
        undefined,
        "Synchronise the keyboard TFT clock with this Mac's local time.",
      );
      setClockSync(synced);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="System"
        description="Firmware information and safe onboard controls."
        action={
          <Button variant="primary" onClick={refresh} disabled={busy}>
            {busy ? "Reading…" : "Refresh"}
          </Button>
        }
      />

      <ErrorBanner>{err}</ErrorBanner>

      <div className="grid gap-6">
        {transport === "legacy-feature" && (
          <Card title="Connected with supplied-driver firmware" kicker="Compatibility mode">
            <p className="text-sm leading-relaxed text-fg-2">
              Lighting, TFT clock sync, and the official System settings block are available.
              This firmware cannot report its current System values. The controls below show the
              last settings applied by AK820 Pro Control when available; otherwise they begin with the
              vendor defaults and only change the keyboard when you press Save.
            </p>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Device" action={info && <Badge tone="good">Read from keyboard</Badge>}>
            {info === null ? (
              transport === "legacy-feature" ? (
                <div className="space-y-3">
                  {receiverBattery && (
                    <BatteryBar
                      level={receiverBattery.battery_level}
                      charging={receiverBattery.charging === true}
                    />
                  )}
                  <p className="text-sm leading-relaxed text-fg-2">
                    {batteryNote ?? "Detailed wired device reads are unavailable on this firmware."}
                  </p>
                  <p className="text-xs leading-relaxed text-fg-3">
                    Current lighting, keymap, macro, System, and TFT values still have no verified read-back path.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-fg-2">Reading…</p>
              )
            ) : (
              <KVList
                rows={[
                  {
                    label: "Firmware",
                    value: <Mono>v{info.firmware_version.toFixed(2)}</Mono>,
                  },
                  {
                    label: "VID:PID",
                    value: <Mono>{hex4(info.vid)}:{hex4(info.pid)}</Mono>,
                  },
                  {
                    label: "Battery",
                    value: <BatteryBar level={info.battery_level} charging={info.charge_status === 1} />,
                  },
                  {
                    label: "Profile",
                    value: <Badge tone="accent">slot {info.current_profile}</Badge>,
                  },
                  {
                    label: "Macro space",
                    value: <Mono>{formatInt(info.macro_space_size)} bytes</Mono>,
                  },
                  {
                    label: "TFT capacity",
                    value: <Mono>{info.tft_max_frames} frames</Mono>,
                  },
                  {
                    label: "Frame version",
                    value: <Mono>{info.frame_version}</Mono>,
                  },
                ]}
              />
            )}
          </Card>

          <Card
            title="Onboard system settings"
            action={draft && (
              <div className="flex items-center gap-2">
                <Badge tone="good">Read from keyboard</Badge>
                <Button variant="primary" size="sm" onClick={saveSystemSettings} disabled={busy || !hasChanges}>
                  {busy ? "Saving…" : "Save settings"}
                </Button>
              </div>
            )}
          >
            {transport === "legacy-feature" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    Sleep timer
                    <select value={legacySettings.sleep_time} onChange={(e) => updateLegacy("sleep_time", Number(e.target.value))}>
                      {LEGACY_SLEEP_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    Key response level
                    <select value={legacySettings.key_response_level} onChange={(e) => updateLegacy("key_response_level", Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>Level {value}</option>)}
                    </select>
                  </label>
                </div>
                <div className="mt-5 grid gap-3 border-t border-line/60 pt-4 sm:grid-cols-2">
                  <Toggle checked={legacySettings.disable_windows_key} onChange={(v) => updateLegacy("disable_windows_key", v)}>Disable Windows key</Toggle>
                  <Toggle checked={legacySettings.disable_alt_f4} onChange={(v) => updateLegacy("disable_alt_f4", v)}>Disable Alt+F4</Toggle>
                  <Toggle checked={legacySettings.disable_alt_tab} onChange={(v) => updateLegacy("disable_alt_tab", v)}>Disable Alt+Tab</Toggle>
                  <Toggle checked={legacySettings.fn_switch} onChange={(v) => updateLegacy("fn_switch", v)}>Fn switch</Toggle>
                </div>
                <div className="mt-5 flex items-center gap-3 border-t border-line/60 pt-4">
                  <Button variant="primary" size="sm" onClick={saveLegacySystemSettings} disabled={busy}>
                    {busy ? "Saving…" : "Save settings"}
                  </Button>
                  {legacySavedAt && (
                    <Badge tone="warn">Last applied {new Date(legacySavedAt).toLocaleString()}</Badge>
                  )}
                </div>
                <p className="mt-3 text-xs text-fg-3">Write-only on this firmware; visual/behavioural confirmation is required.</p>
              </>
            ) : draft === null ? (
              <p className="text-sm text-fg-2">
                Reading…
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    Sleep timer
                    <select value={draft.sleep_time} onChange={(e) => updateDraft("sleep_time", Number(e.target.value))}>
                      {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    Key response level
                    <select value={draft.key_delay} onChange={(e) => updateDraft("key_delay", Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>Level {value}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    Report-rate value
                    <input type="number" min={0} max={255} value={draft.report_rate}
                      onChange={(e) => updateDraft("report_rate", Math.max(0, Math.min(255, Number(e.target.value) || 0)))} />
                  </label>
                  <label className="grid gap-1.5 text-sm text-fg-2">
                    TFT display-time value
                    <input type="number" min={0} max={255} value={draft.tft_display_time}
                      onChange={(e) => updateDraft("tft_display_time", Math.max(0, Math.min(255, Number(e.target.value) || 0)))} />
                  </label>
                </div>
                <div className="mt-5 grid gap-3 border-t border-line/60 pt-4 sm:grid-cols-2">
                  <Toggle checked={draft.game_mode !== 0} onChange={(v) => updateDraft("game_mode", v ? 1 : 0)}>Game mode</Toggle>
                  <Toggle checked={draft.fn_switch !== 0} onChange={(v) => updateDraft("fn_switch", v ? 1 : 0)}>Fn switch</Toggle>
                  <Toggle checked={draft.stability_mode !== 0} onChange={(v) => updateDraft("stability_mode", v ? 1 : 0)}>Stability mode</Toggle>
                  <Toggle checked={draft.auto_calibration !== 0} onChange={(v) => updateDraft("auto_calibration", v ? 1 : 0)}>Auto calibration</Toggle>
                  <Toggle checked={draft.single_key_wakeup !== 0} onChange={(v) => updateDraft("single_key_wakeup", v ? 1 : 0)}>Single-key wakeup</Toggle>
                </div>
                <p className="mt-4 border-t border-line/60 pt-3 text-xs text-fg-3">
                  One confirmed write saves the complete settings block, then reads it back for verification.
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="TFT clock">
            <p className="mb-4 text-sm text-fg-2">
              Send this Mac's current local date and time to the keyboard display.
            </p>
            <Button variant="primary" onClick={syncClock} disabled={busy}>
              Sync clock
            </Button>
            {clockSync && (
              <p className="mt-4 text-xs text-fg-3">
                Last sent: {clockSync.year}-{String(clockSync.month).padStart(2, "0")}-
                {String(clockSync.day).padStart(2, "0")} {String(clockSync.hour).padStart(2, "0")}:
                {String(clockSync.minute).padStart(2, "0")}:{String(clockSync.second).padStart(2, "0")}
              </p>
            )}
          </Card>
          <Card title="Safety boundary">
            <p className="text-sm leading-relaxed text-fg-2">
              AK820 Pro Control never invokes firmware update or bootloader operations. Device writes
              are serialized and require session approval; settings are read back when supported.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
