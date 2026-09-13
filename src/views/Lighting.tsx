import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Direction, LedColor, LightingConfig, LightingModeInfo } from "../types";
import { KeyboardPreview } from "../components/KeyboardPreview";
import { RememberedTftPreview } from "../components/RememberedTftPreview";
import { Badge, Button, Card, Disclosure, ErrorBanner, Slider, Toggle } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { CustomLightingPaint } from "./CustomLightingPaint";
import { formatError } from "../errors";
import { invokeDeviceWrite } from "../device-write";
import { loadLastApplied, saveLastApplied } from "../device-state";

const ALL_DIRECTIONS: Direction[] = ["left", "down", "up", "right"];
const APPLY_DEBOUNCE_MS = 80;
const SHOW_EXPERIMENTAL_FEATURES = false;

export function Lighting() {
  const [modes, setModes] = useState<LightingModeInfo[] | null>(null);
  const [cfg, setCfg] = useState<LightingConfig>({
    mode: "static",
    color: "7C5CFF",
    secondary: null,
    color_mode: 0,
    effect_mode_type: 0,
    brightness: 3,
    speed: 3,
    direction: "left",
  });
  const [currentCfg, setCurrentCfg] = useState<LightingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [customColors, setCustomColors] = useState<LedColor[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(false);
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const [stateSource, setStateSource] = useState<"device" | "last-applied" | null>(null);
  const [transport, setTransport] = useState<"online-output" | "legacy-feature" | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Audio-reactive lighting (macOS only) — currently **alpha**: the
  // wire-level cadence makes it flicker on real music. We gate it behind
  // an explicit "unlock experimental" toggle so a casual user doesn't
  // accidentally turn on something that looks broken, and persist the
  // unlock to localStorage so contributors don't have to re-click it on
  // every page load.
  //
  // Backend keeps the authoritative streaming state — we poll every 3s
  // so a loop self-exit (capture crashed, permission revoked) clears
  // the toggle without the user having to click anything.
  const AUDIO_REACTIVE_UNLOCK_KEY = "ak820:audio-reactive-unlocked";
  const [audioReactiveUnlocked, setAudioReactiveUnlocked] = useState<boolean>(
    () => {
      try {
        return window.localStorage.getItem(AUDIO_REACTIVE_UNLOCK_KEY) === "true";
      } catch {
        return false;
      }
    },
  );
  const [audioReactive, setAudioReactive] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);

  const pendingTimer = useRef<number | null>(null);
  const inflight = useRef(false);
  const queued = useRef<LightingConfig | null>(null);

  useEffect(() => {
    void syncLighting();
  }, []);

  async function syncLighting() {
    setSyncing(true);
    setErr(null);
    try {
      const listed = await invoke<LightingModeInfo[]>("list_lighting_modes");
      setModes(listed);
      const transport = await invoke<"online-output" | "legacy-feature">("get_transport_kind");
      setTransport(transport);
      if (transport === "online-output") {
        const current = await invoke<LightingConfig>("get_lighting");
        setCfg(current);
        setCurrentCfg(current);
        setStateSource("device");
        setLastApplied(null);
      } else {
        const remembered = loadLastApplied<LightingConfig>("lighting");
        if (remembered) {
          setCfg(remembered.value);
          setCurrentCfg(remembered.value);
          setStateSource("last-applied");
          setLastApplied(new Date(remembered.savedAt).toLocaleTimeString());
        } else {
          setCurrentCfg(null);
          setStateSource(null);
        }
      }
    } catch (e) {
      setErr(formatError(e));
      setModes((current) => current ?? []);
    } finally {
      setSyncing(false);
    }
  }

  // Initial status + drift-detection poll. 3s is a compromise between
  // catching crashes promptly and not hammering the IPC channel.
  useEffect(() => {
    if (!SHOW_EXPERIMENTAL_FEATURES) return;
    let alive = true;
    const refresh = () => {
      invoke<boolean>("audio_reactive_status")
        .then((on) => {
          if (alive) setAudioReactive(on);
        })
        .catch(() => {
          // The command stubs to error on non-macOS — silently treat
          // that as "not running".
          if (alive) setAudioReactive(false);
        });
    };
    refresh();
    const id = window.setInterval(refresh, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  async function toggleAudioReactive(on: boolean) {
    setAudioBusy(true);
    setErr(null);
    try {
      if (on) {
        await invoke("audio_reactive_start");
        setAudioReactive(true);
      } else {
        await invoke("audio_reactive_stop");
        setAudioReactive(false);
      }
    } catch (e) {
      setErr(formatError(e));
      // Backend authority: if start failed, ensure UI shows off.
      setAudioReactive(false);
    } finally {
      setAudioBusy(false);
    }
  }

  /**
   * Lock/unlock the experimental feature. Locking while streaming
   * also stops the stream — otherwise an alpha-feature stays running
   * even though the user has signalled they want it "off".
   */
  async function toggleAudioReactiveUnlock(unlocked: boolean) {
    setAudioReactiveUnlocked(unlocked);
    try {
      window.localStorage.setItem(
        AUDIO_REACTIVE_UNLOCK_KEY,
        unlocked ? "true" : "false",
      );
    } catch {
      // localStorage can throw in private-browsing or quota cases —
      // swallow; worst case the user re-unlocks next session.
    }
    if (!unlocked && audioReactive) {
      await toggleAudioReactive(false);
    }
  }

  const currentMode = useMemo(
    () => modes?.find((m) => m.name === cfg.mode),
    [modes, cfg.mode],
  );

  async function applyNow(next: LightingConfig) {
    if (inflight.current) {
      queued.current = next;
      return;
    }
    inflight.current = true;
    setBusy(true);
    setErr(null);
    try {
      await invokeDeviceWrite(
        "apply_lighting",
        { config: next },
        "Apply the selected lighting effect and colors.",
      );
      if (transport === "online-output") {
        const current = await invoke<LightingConfig>("get_lighting");
        setCfg(current);
        setCurrentCfg(current);
        setLastApplied(null);
        setStateSource("device");
      } else {
        const stored = saveLastApplied("lighting", next);
        setCurrentCfg(next);
        setLastApplied(new Date(stored.savedAt).toLocaleTimeString());
        setStateSource("last-applied");
      }
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setBusy(false);
      inflight.current = false;
      const drain = queued.current;
      queued.current = null;
      if (drain) void applyNow(drain);
    }
  }

  function scheduleApply(next: LightingConfig) {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => {
      pendingTimer.current = null;
      void applyNow(next);
    }, APPLY_DEBOUNCE_MS);
  }

  function update<K extends keyof LightingConfig>(key: K, value: LightingConfig[K]) {
    const next = { ...cfg, [key]: value };
    setCfg(next);
    if (autoApply) scheduleApply(next);
  }

  function updateColor(v: string) {
    const next = { ...cfg, color: v };
    setCfg(next);
    if (autoApply && v.length === 6) scheduleApply(next);
  }

  if (modes === null) {
    return <p className="text-sm text-fg-2">Loading lighting modes…</p>;
  }

  const hasSecondary = cfg.secondary !== null && cfg.secondary !== undefined;
  const isCustomMode = cfg.mode === "custom";
  let audioStatus = "Unlock above to enable.";
  if (audioReactive) audioStatus = "Live — keyboard is following the system audio mix.";
  else if (audioReactiveUnlocked) audioStatus = "Ready to start.";

  return (
    <>
      <PageHeader
        title="Lighting"
        description={
          isCustomMode
            ? "Choose a colour for each key using the keyboard below."
            : "Choose an effect, colours, brightness, and speed."
        }
        action={
          isCustomMode ? null : (
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => void syncLighting()} disabled={busy || syncing}>
                {syncing ? "Reading…" : "Reload"}
              </Button>
              <Toggle checked={autoApply} onChange={setAutoApply}>
                Auto-apply
              </Toggle>
              <Button variant="primary" onClick={() => void applyNow(cfg)} disabled={busy}>
                {busy ? "Sending…" : "Apply"}
              </Button>
            </div>
          )
        }
      />

      <ErrorBanner>{err}</ErrorBanner>

      <div className="grid gap-6">
        <KeyboardPreview config={cfg} customColors={customColors} display={(paused) => <RememberedTftPreview paused={paused} />}
          controls={<>
            <label className="flex items-center gap-2">Effect
              <select aria-label="Preview effect" value={cfg.mode} onChange={(e) => update("mode", e.target.value)}>
                {modes.map((mode) => <option key={mode.name} value={mode.name}>{mode.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Colour
              <input aria-label="Preview colour" type="color" className="h-8 w-10" value={`#${cfg.color}`} onChange={(e) => updateColor(e.target.value.slice(1).toUpperCase())} />
            </label>
            <label className="flex items-center gap-2">Brightness
              <input aria-label="Preview brightness" type="range" className="w-20" min={0} max={5} value={cfg.brightness} onChange={(e) => update("brightness", Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">Speed
              <input aria-label="Preview speed" type="range" className="w-20" min={0} max={5} value={cfg.speed} onChange={(e) => update("speed", Number(e.target.value))} />
            </label>
          </>}
        />
        <div
          className={["grid gap-6", audioReactive ? "pointer-events-none opacity-50" : ""].join(" ")}
        >
        <Card
          title="Mode"
          action={
            stateSource === "device" ? (
              <Badge tone="good">Current</Badge>
            ) : lastApplied && !audioReactive ? (
              <Badge tone="warn">Last saved {lastApplied}</Badge>
            ) : audioReactive ? (
              <span className="text-xs text-fg-3">Paused while audio lighting is on</span>
            ) : null
          }
        >
          {stateSource === null && (
            <p className="mb-4 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
              The keyboard cannot report its current lighting. Apply an effect once and the app will remember it here.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {modes.map((m) => {
              const isActive = m.name === cfg.mode;
              const isCurrent = m.name === currentCfg?.mode;
              return (
                <Button
                  key={m.name}
                  variant={isActive ? "ghost-active" : "ghost"}
                  size="sm"
                  onClick={() => update("mode", m.name)}
                  className={["justify-start", isCurrent ? "ring-1 ring-good/70" : ""].join(" ")}
                  title={m.description}
                >
                  {m.label}
                  {isCurrent && (
                    <span className="ml-auto text-[9px] uppercase tracking-wider text-good">
                      {stateSource === "device" ? "current" : "last saved"}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          {currentMode && (
            <p className="mt-4 border-t border-line/60 pt-3 text-sm text-fg-2">
              <span className="font-medium text-fg-0">{currentMode.label}.</span>{" "}
              {currentMode.description}
            </p>
          )}
        </Card>

        {isCustomMode ? (
          <CustomLightingPaint inheritedConfig={cfg} onPreviewChange={setCustomColors} />
        ) : (
        <>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Colour">
            {currentCfg && (
              <div className="mb-4 flex items-center gap-2 text-xs text-fg-2">
                <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: `#${currentCfg.color}` }} />
                <span>
                  {stateSource === "device" ? "Current" : "Last applied"} {currentCfg.color}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={"#" + cfg.color}
                onChange={(e) => updateColor(e.target.value.replace("#", "").toUpperCase())}
                className="h-10 w-14"
              />
              <input
                type="text"
                value={cfg.color}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 6);
                  updateColor(v);
                }}
                placeholder="FFFFFF"
                className="w-28 font-mono uppercase"
              />
              <Badge tone="neutral">Primary</Badge>
            </div>

            <div className="mt-5 border-t border-line/60 pt-4">
              <Toggle
                checked={hasSecondary}
                onChange={(v) => update("secondary", v ? "000000" : null)}
              >
                Secondary colour
              </Toggle>
              {hasSecondary && (
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="color"
                    value={"#" + (cfg.secondary ?? "000000")}
                    onChange={(e) => update("secondary", e.target.value.replace("#", "").toUpperCase())}
                    className="h-10 w-14"
                  />
                  <input
                    type="text"
                    value={cfg.secondary ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 6);
                      update("secondary", v);
                    }}
                    placeholder="000000"
                    className="w-28 font-mono uppercase"
                  />
                  <Badge tone="neutral">Secondary</Badge>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Movement"
            action={
              !currentMode?.supports_direction && (
                <span className="text-xs text-fg-3">Not available for this effect</span>
              )
            }
          >
            <div className="flex flex-wrap gap-2">
              {ALL_DIRECTIONS.map((d) => {
                const supported = !currentMode?.supports_direction || currentMode.directions.includes(d);
                const isActive = d === cfg.direction;
                return (
                  <Button
                    key={d}
                    variant={isActive ? "ghost-active" : "ghost"}
                    size="sm"
                    onClick={() => update("direction", d)}
                    disabled={!supported}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </Button>
                );
              })}
            </div>

            <Disclosure
              className="mt-5"
              title="Advanced colour behaviour"
              description="Fine-tune colour cycling"
            >
              <label className="grid max-w-xs gap-1.5 text-sm text-fg-2">
                Colour variation
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={cfg.color_mode}
                  onChange={(e) =>
                    update("color_mode", Math.max(0, Math.min(255, Number(e.target.value) || 0)))
                  }
                  className="w-24 font-mono"
                />
                <span className="text-xs text-fg-3">
                  Use 0 for one colour; higher values enable effect-specific colour cycling.
                </span>
              </label>
            </Disclosure>
          </Card>
        </div>

        <Card title="Levels">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Slider label="Brightness" value={cfg.brightness} max={5} onChange={(v) => update("brightness", v)} />
            <Slider label="Speed" value={cfg.speed} max={5} onChange={(v) => update("speed", v)} />
          </div>
        </Card>
        </>
        )}
        </div>

        <Disclosure
          title="Experimental audio lighting"
          description="Optional preview feature"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <Badge tone="warn">Experimental</Badge>
            <Toggle
              checked={audioReactiveUnlocked}
              onChange={toggleAudioReactiveUnlock}
            >
              {audioReactiveUnlocked ? "Unlocked" : "Locked"}
            </Toggle>
          </div>
          <p className="text-sm text-fg-2">
            Make the keyboard react to audio playing on this Mac. Bass, vocals,
            and higher sounds illuminate different areas in red, green, and blue.
            The regular lighting controls are paused while this is active.
          </p>
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-fg-1">
            <strong className="text-amber-300">Experimental — use at your own risk.</strong>
            <br />
            Known issue: lighting may flicker during music. Unlocking this feature
            is remembered across launches.
          </p>
          <p className="mt-2 text-xs text-fg-3">
            macOS may ask for Screen Recording permission the first time because
            that permission also covers system-audio capture.
          </p>

          <div
            className={[
              "mt-4 flex items-center justify-between border-t border-line/60 pt-4",
              audioReactiveUnlocked ? "" : "pointer-events-none opacity-50",
            ].join(" ")}
          >
            <div>
              <p className="text-sm text-fg-1">Streaming</p>
              <p className="text-xs text-fg-3">
                {audioStatus}
              </p>
            </div>
            <Toggle
              checked={audioReactive}
              onChange={toggleAudioReactive}
              disabled={!audioReactiveUnlocked || audioBusy}
            >
              {audioReactive ? "Streaming" : "Off"}
            </Toggle>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
