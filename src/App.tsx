import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Connect } from "./views/Connect";
import { Keymap } from "./views/Keymap";
import { Lighting } from "./views/Lighting";
import { Macros } from "./views/Macros";
import { System } from "./views/System";
import { Tft } from "./views/Tft";
import { resetDeviceWriteApproval } from "./device-write";
import {
  Layout,
  Plug,
  Bulb,
  Settings,
  Keyboard,
  Macro,
  Screen,
  type NavItem,
} from "./components/Layout";

type Tab = "connect" | "lighting" | "system" | "keymap" | "macros" | "tft";

const ICON_PROPS = { size: 16, strokeWidth: 1.6 } as const;

const NAV: NavItem<Tab>[] = [
  { id: "connect", label: "My Keyboard", icon: <Plug {...ICON_PROPS} /> },
  { id: "lighting", label: "Lighting", icon: <Bulb {...ICON_PROPS} /> },
  { id: "system", label: "System", icon: <Settings {...ICON_PROPS} /> },
  { id: "keymap", label: "Keymap", icon: <Keyboard {...ICON_PROPS} /> },
  { id: "macros", label: "Macros", icon: <Macro {...ICON_PROPS} /> },
  { id: "tft", label: "Display", icon: <Screen {...ICON_PROPS} /> },
];

interface ProbeReport {
  connected: boolean;
  interface: number;
  product: string | null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("connect");
  const [probe, setProbe] = useState<ProbeReport | null>(null);

  useEffect(() => {
    let alive = true;
    let nextTimer: number | undefined;

    const firstTimer = window.setTimeout(async function tick() {
      if (!alive) return;
      try {
        const nextProbe = await invoke<ProbeReport>("probe_device");
        if (alive) {
          setProbe(nextProbe);
          if (!nextProbe.connected) resetDeviceWriteApproval();
        }
      } catch {
        if (alive) {
          setProbe(null);
          resetDeviceWriteApproval();
        }
      }
      if (alive) nextTimer = window.setTimeout(tick, 4000);
    }, 200);

    return () => {
      alive = false;
      window.clearTimeout(firstTimer);
      if (nextTimer !== undefined) window.clearTimeout(nextTimer);
    };
  }, []);

  async function reconnect(): Promise<void> {
    resetDeviceWriteApproval();
    try {
      await invoke("force_reconnect");
    } catch {
      // The next scheduled probe will surface the connection state.
    }
  }

  return (
    <Layout
      brand="AK820 Pro Control"
      phaseLabel="ANSI · Beta"
      nav={NAV}
      active={tab}
      onSelect={setTab}
      connection={probe ? { connected: probe.connected, product: probe.product } : undefined}
      onReconnect={reconnect}
      wide={tab === "keymap"}
    >
      {tab === "connect" && <Connect onReconnect={reconnect} />}
      {tab === "lighting" && <Lighting />}
      {tab === "system" && <System />}
      {tab === "keymap" && <Keymap />}
      {tab === "macros" && <Macros />}
      {tab === "tft" && <Tft />}
    </Layout>
  );
}
