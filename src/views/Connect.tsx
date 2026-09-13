import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Usb } from "lucide-react";
import type { DeviceInfo, ProbeReport } from "../types";
import { Badge, BatteryBar, Button, Card, Disclosure, ErrorBanner, Mono, hex4, prettyProduct } from "../components/ui";
import { Check, PageHeader } from "../components/Layout";
import { formatError } from "../errors";

const CONTROL_USAGE_PAGE = 0xff68;

interface BluetoothBatteryStatus {
  paired: boolean;
  connected: boolean;
  battery_level: number | null;
  source: string;
}

export function Connect({ onReconnect }: { onReconnect?: () => void }) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [probe, setProbe] = useState<ProbeReport | null>(null);
  const [bluetoothBattery, setBluetoothBattery] = useState<BluetoothBatteryStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const list = await invoke<DeviceInfo[]>("list_devices");
      setDevices(list);
      setBluetoothBattery(await invoke<BluetoothBatteryStatus>("get_bluetooth_battery"));
      if (list.some((device) => device.usage_page === CONTROL_USAGE_PAGE)) {
        setProbe(await invoke<ProbeReport>("probe_device"));
      } else {
        setProbe(null);
      }
    } catch (error) {
      setErr(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    onReconnect?.();
    await refresh();
  }

  useEffect(() => {
    refresh();
  }, []);

  const bluetoothOnly =
    devices !== null &&
    devices.some((device) => device.pid === 0xfefe) &&
    !devices.some((device) => device.usage_page === CONTROL_USAGE_PAGE);
  const connectionIconClass = probe?.connected
    ? "border-good/30 bg-good-soft text-good"
    : "border-bad/30 bg-bad-soft text-bad";

  return (
    <>
      <PageHeader
        title="My Keyboard"
        description="Connection status and information for your AK820 Pro."
        action={
          <Button onClick={reconnect} disabled={busy}>
            {busy ? "Checking…" : "Check again"}
          </Button>
        }
      />

      <ErrorBanner>{err}</ErrorBanner>

      {bluetoothOnly && (
        <div className="mb-6 rounded-lg border border-warn/50 bg-warn/10 px-4 py-3">
          <p className="text-sm font-medium text-fg-0">Bluetooth keyboard detected</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-2">
            Connect the keyboard directly with a USB-C data cable and switch it to
            wired mode, then choose Check again. Your saved settings remain available
            when you return to Bluetooth.
          </p>
        </div>
      )}

      <div className="grid gap-5">
        <Card className="overflow-hidden">
          {probe === null ? (
            <div className="flex items-center gap-4 py-1">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-fg-3">
                <Usb size={20} strokeWidth={1.7} />
              </span>
              <div>
                <h2 className="font-medium text-fg-0">Looking for your keyboard</h2>
                <p className="mt-1 text-sm text-fg-2">
                  Connect it with a USB-C data cable and switch to wired mode.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${connectionIconClass}`}>
                  {probe.connected ? <Check size={22} strokeWidth={2} /> : <Usb size={21} strokeWidth={1.7} />}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-medium tracking-tight text-fg-0">
                      {prettyProduct(probe.product)}
                    </h2>
                    <Badge tone={probe.connected ? "good" : "bad"}>
                      {probe.connected ? "Connected" : "Offline"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-fg-2">
                    {probe.connected
                      ? "Ready to customise. Changes are saved directly to the keyboard."
                      : "Reconnect the USB-C cable, then check again."}
                  </p>
                </div>
              </div>
              {probe.connected && (
                <div className="rounded-lg border border-line/70 bg-surface-base/50 px-4 py-3 text-sm sm:text-right">
                  <p className="text-xs text-fg-3">Connection</p>
                  <p className="mt-0.5 font-medium text-fg-0">Wired USB-C</p>
                </div>
              )}
            </div>
          )}
        </Card>

        {bluetoothBattery?.paired && (
          <Card
            title="Wireless battery"
            action={
              <Badge tone={bluetoothBattery.connected ? "good" : "neutral"}>
                {bluetoothBattery.connected ? "Connected" : "Paired"}
              </Badge>
            }
          >
            {bluetoothBattery.battery_level !== null ? (
              <div className="space-y-3">
                <BatteryBar level={bluetoothBattery.battery_level} charging={false} />
                <p className="text-xs leading-relaxed text-fg-3">
                  Reported by macOS. Charging status is not available over Bluetooth.
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-fg-2">
                {bluetoothBattery.connected
                  ? "The keyboard is connected, but macOS is not reporting a battery percentage."
                  : "Switch the keyboard to its paired Bluetooth channel to request a battery reading."}
              </p>
            )}
          </Card>
        )}

        <Disclosure title="Advanced connection details" description="Useful when reporting a problem">
            {devices === null ? (
              <p className="text-sm text-fg-2">Checking connection details…</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-fg-2">No compatible keyboard interfaces found.</p>
            ) : (
              <div className="overflow-x-auto">
                <p className="mb-4 text-xs leading-relaxed text-fg-3">
                  Your keyboard exposes separate services for typing, media controls,
                  configuration, and display transfers.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-fg-2">
                      <th className="px-2 py-2 font-normal">Interface</th>
                      <th className="px-2 py-2 font-normal">Usage</th>
                      <th className="px-2 py-2 font-normal">Device ID</th>
                      <th className="px-2 py-2 font-normal">Name</th>
                      <th className="px-2 py-2 font-normal">Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => {
                      const isControl = device.usage_page === CONTROL_USAGE_PAGE;
                      return (
                        <tr
                          key={`${device.path}:${device.interface}:${device.usage_page}`}
                          className="border-t border-line/60"
                        >
                          <td className="px-2 py-2"><Mono>{device.interface}</Mono></td>
                          <td className="px-2 py-2"><Mono>{hex4(device.usage_page)}</Mono></td>
                          <td className="px-2 py-2"><Mono>{hex4(device.vid)}:{hex4(device.pid)}</Mono></td>
                          <td className="px-2 py-2">{device.product ?? "—"}</td>
                          <td className="px-2 py-2">
                            {isControl ? (
                              <Badge tone="accent">Configuration</Badge>
                            ) : (
                              <span className="text-xs text-fg-3">Keyboard service</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </Disclosure>
      </div>
    </>
  );
}
