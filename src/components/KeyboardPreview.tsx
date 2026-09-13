import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ANSI_LAYOUT } from "../data/layouts";
import type { LedColor, LightingConfig } from "../types";
import "./KeyboardPreview.css";

type Point = { slot: number; label: string; hid: number; x: number; y: number; w: number };
const UNIT = 50;
const WIDTHS: Record<number, number> = { 92: 2, 32: 1.5, 97: 1.5, 48: 1.75, 76: 2.25, 64: 2.25, 75: 1.75, 80: 1.25, 81: 1.25, 82: 1.25, 83: 6.25 };
const KEYS: Point[] = ANSI_LAYOUT.rows.flatMap((row, rowIndex) => {
  let x = 0;
  return row.map((key, index) => {
    if (rowIndex === 0 && [1, 5, 9].includes(index)) x += 0.25;
    if ([107, 105, 108].includes(key.slot)) x = 15.5;
    if (key.slot === 90) x = 14.25;
    if (key.slot === 88) x = 13.25;
    const w = WIDTHS[key.slot] ?? 1;
    const result = { ...key, label: key.slot === 107 ? "Home" : key.label, x: x * UNIT, y: (rowIndex + (rowIndex ? 0.2 : 0) + (key.slot >= 88 && key.slot <= 91 ? 0.15 : 0)) * UNIT, w: w * UNIT };
    x += w;
    return result;
  });
});
const COLOURWAYS = [
  { id: "grey", label: "Grey", colors: ["#292b2b", "#d8d6cc", "#8a8b87", "#f6d321"], ink: "#262721" },
  { id: "white-purple", label: "White · Purple", colors: ["#e6e4eb", "#faf8f5", "#cbc4e3", "#9d85d0"], ink: "#3d3553" },
  { id: "grey-beige-red", label: "Grey · Beige · Red", colors: ["#565958", "#ded8c9", "#979b96", "#b94340"], ink: "#262926" },
];
const REACTIVE = new Set(["single-on", "single-off", "explode", "launch", "ripples"]);
const CODE_HID: Record<string, number> = {
  Escape: 41, Backspace: 42, Tab: 43, Space: 44, Enter: 40, CapsLock: 57,
  Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49,
  Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
  Delete: 76, End: 77, Home: 77, PageUp: 75, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
};
for (let i = 0; i < 26; i++) CODE_HID[`Key${String.fromCharCode(65 + i)}`] = 4 + i;
for (let i = 1; i <= 12; i++) CODE_HID[`F${i}`] = 57 + i;
for (let i = 0; i < 10; i++) CODE_HID[`Digit${i}`] = i === 0 ? 39 : 29 + i;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const wave = (n: number) => (Math.sin(n) + 1) / 2;

/** Visual approximation only: this component never communicates with the keyboard. */
export function KeyboardPreview({ config, display, customColors, controls }: {
  config: LightingConfig;
  display?: (paused: boolean) => ReactNode;
  customColors?: LedColor[];
  controls?: ReactNode;
}) {
  const [colourway, setColourway] = useState(() => {
    try { return localStorage.getItem("ak820:preview-colourway") ?? "grey"; } catch { return "grey"; }
  });
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const board = useRef<HTMLDivElement>(null);
  const presses = useRef<{ slot: number; x: number; y: number; time: number }[]>([]);
  const currentConfig = useRef(config);
  currentConfig.current = config;
  const theme = COLOURWAYS.find((item) => item.id === colourway) ?? COLOURWAYS[0];

  function press(key: Point) {
    presses.current = [...presses.current.slice(-15), { ...key, time: performance.now() }];
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      const key = KEYS.find((item) => item.hid === CODE_HID[event.code]);
      if (key) press(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const elements = board.current?.querySelectorAll<HTMLButtonElement>(".keyboard-preview-key");
    const draw = (now: number) => {
      if (now - last > 32) {
        last = now;
        const cfg = currentConfig.current;
        const t = paused ? 1 : now / 1000 * (0.3 + cfg.speed * 0.3);
        presses.current = presses.current.filter((p) => now - p.time < 3500);
        elements?.forEach((element, index) => {
          const key = KEYS[index];
          const x = key.x / UNIT;
          const y = key.y / UNIT;
          const axis = { up: -y, down: y, left: -x, right: x }[cfg.direction];
          const radius = Math.hypot(x - 8, (y - 2.7) * 1.5);
          let level = 1;
          let hue = x * 22 + y * 30 + t * 80;
          let reaction = 0;
          let down = false;
          for (const hit of presses.current) {
            const age = (now - hit.time) / 1000;
            const distance = Math.hypot(x - hit.x / UNIT, y - hit.y / UNIT);
            if (hit.slot === key.slot && age < 0.15) down = true;
            if (cfg.mode === "single-on" || cfg.mode === "single-off") {
              if (hit.slot === key.slot) reaction = Math.max(reaction, clamp(1 - age / 1.5));
            } else if (cfg.mode === "launch") {
              const dx = x - hit.x / UNIT;
              const dy = y - hit.y / UNIT;
              const travel = { up: -dy, down: dy, left: -dx, right: dx }[cfg.direction];
              const cross = ["up", "down"].includes(cfg.direction) ? dx : dy;
              reaction = Math.max(reaction, clamp(1 - Math.abs(travel - age * 9) / 1.8) * clamp(1 - Math.abs(cross)));
            } else {
              const spread = cfg.mode === "explode" ? clamp(1 - distance / Math.max(0.1, age * 9)) : clamp(1 - Math.abs(distance - age * 7) / 1.2);
              reaction = Math.max(reaction, spread * clamp(1 - age / 2.5));
            }
          }
          switch (cfg.mode) {
            case "off": level = 0; break;
            case "single-on": case "explode": case "launch": case "ripples": level = reaction; break;
            case "single-off": level = 1 - reaction; break;
            case "glittering": level = Math.pow(wave(t * 3 + key.slot * 2.399), 12); break;
            case "falling": level = Math.pow(wave(y * 1.6 - t * 4 + Math.sin(x * 7)), 5); break;
            case "colourful": hue = key.slot * 137.5 + Math.floor(t * 2) * 47; break;
            case "breath": level = 0.05 + 0.95 * wave(t * 2); break;
            case "spectrum": hue = t * 60; break;
            case "outward": level = Math.pow(wave(radius * 1.4 - t * 4), 3); break;
            case "scrolling": level = 0.08 + 0.92 * Math.pow(wave(axis * 0.75 - t * 3), 3); break;
            case "rolling": level = 0.1 + 0.9 * wave(axis * 0.65 - t * 3 + y); break;
            case "rotating": level = Math.pow(wave(Math.atan2(y - 2.7, x - 8) - t * 3 * (cfg.direction === "left" ? -1 : 1)), 5); break;
            case "flowing": level = 0.15 + 0.85 * wave(axis * 0.7 + y * 1.2 - t * 3); break;
            case "pulsating": level = Math.pow(wave(radius - t * 3), 2); break;
            case "tilt": level = Math.pow(wave(axis * 0.9 + y * 1.5 - t * 3), 3); break;
            case "shuttle": level = clamp(1 - Math.abs(x - wave(t * 2) * 16) / 2); break;
          }
          let color = `#${cfg.color}`;
          if (cfg.color_mode > 0 || ["colourful", "spectrum"].includes(cfg.mode)) color = `hsl(${hue % 360} 95% 62%)`;
          else if (cfg.secondary && wave(axis - t * 2) > 0.5) color = `#${cfg.secondary}`;
          if (cfg.mode === "custom") {
            const led = customColors?.find((item) => item.led_id === key.slot);
            color = led ? `rgb(${led.red} ${led.green} ${led.blue})` : "transparent";
          }
          element.style.setProperty("--led", color);
          element.style.setProperty("--light", String(clamp(level * cfg.brightness / 5)));
          element.dataset.pressed = String(down);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [paused, customColors]);

  const style = {
    "--case": theme.colors[0], "--key": theme.colors[1], "--modifier": theme.colors[2],
    "--accent-key": theme.colors[3], "--key-ink": theme.ink,
  } as CSSProperties;

  return <section className="keyboard-preview" aria-label="Interactive lighting preview" style={style}>
    <div className="keyboard-preview-toolbar">
      <div><h2>Lighting preview</h2><p>{REACTIVE.has(config.mode) ? "Click a key or type to try this effect." : "Try the keys and watch your lighting come to life."}</p></div>
      <button className="keyboard-preview-pause" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Play motion" : "Pause motion"}</button>
    </div>
    {controls && <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-fg-2">{controls}</div>}
    <div className="keyboard-preview-stage">
      <div className="keyboard-preview-board" ref={board}>
        {KEYS.map((key) => {
          const accent = [0, 76, 83].includes(key.slot);
          const modifier = (key.slot > 12 && key.label.length > 1 && !key.label.includes(" ")) || (key.slot >= 5 && key.slot <= 8);
          let keyClass = "keyboard-preview-key";
          if (accent) keyClass += " is-accent";
          else if (modifier) keyClass += " is-modifier";
          return <button key={key.slot} type="button" className={keyClass}
            style={{ left: `${(key.x + 12) / 849 * 100}%`, top: `${(key.y + 12) / 338 * 100}%`, width: `${(key.w - 4) / 849 * 100}%`, height: `${46 / 338 * 100}%` }}
            onPointerDown={() => press(key)} onClick={(event) => { if (event.detail === 0) press(key); }} aria-label={`Preview ${key.label}`}>
            <span className="keyboard-preview-glow" /><span className="keyboard-preview-keycap">{key.label === "Spacebar" ? "" : key.label.replace("L-", "").replace("R-", "")}</span>
          </button>;
        })}
        <div className="keyboard-preview-knob" aria-label="Volume knob" />
        <div className="keyboard-preview-screen" aria-label="Remembered display preview">
          {display?.(paused) ?? <span>AK820<br /><strong>PRO</strong></span>}
        </div>
        <div className="keyboard-preview-indicators" aria-hidden="true">○<br />○<br />○</div>
      </div>
    </div>
    <div className="keyboard-preview-footer">
      <div className="keyboard-preview-swatches" role="group" aria-label="Keyboard colour">
        {COLOURWAYS.map((item) => <button key={item.id} className="keyboard-preview-swatch" aria-pressed={theme.id === item.id} onClick={() => {
          setColourway(item.id); try { localStorage.setItem("ak820:preview-colourway", item.id); } catch { /* Preview remains usable without persistence. */ }
        }}><span style={{ background: `linear-gradient(120deg, ${item.colors[1]} 0 40%, ${item.colors[2]} 40% 70%, ${item.colors[3]} 70%)` }} />{item.label}</button>)}
      </div>
      <p>Effect preview · actual lighting may vary</p>
    </div>
  </section>;
}
