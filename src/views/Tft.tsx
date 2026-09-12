import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, ErrorBanner } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { invokeDeviceWrite } from "../device-write";
import { formatError } from "../errors";
import { loadLastApplied, saveLastApplied } from "../device-state";
import { GifBrowser, type TftImageTransform } from "./GifBrowser";
import type { GifSearchResult } from "../gif-providers";

interface TftPresetInfo {
  id: string;
  display_name: string;
  description: string;
  frame_count: number;
  total_ms: number;
}

interface TftUploadProgress {
  completed_chunks: number;
  total_chunks: number;
  percent: number;
}

type FitMode = "fill" | "contain" | "stretch";

interface LastTftState {
  kind: "preset" | "image" | "factory";
  id?: string;
  label: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function Tft() {
  const [presets, setPresets] = useState<TftPresetInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TftUploadProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fit, setFit] = useState<FitMode>("fill");
  const [lastTft, setLastTft] = useState(() => loadLastApplied<LastTftState>("tft"));

  useEffect(() => {
    invoke<TftPresetInfo[]>("list_tft_presets")
      .then((list) => {
        setPresets(list);
        const remembered = loadLastApplied<LastTftState>("tft");
        const rememberedPreset = remembered?.value.kind === "preset" ? remembered.value.id : null;
        if (rememberedPreset && list.some((preset) => preset.id === rememberedPreset)) {
          setSelected(rememberedPreset);
        } else if (list.length > 0) {
          setSelected(list[0].id);
        }
      })
      .catch((error) => setErr(formatError(error)));

    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<TftUploadProgress>("tft-upload-progress", (event) => {
      if (!disposed) setProgress(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  function beginOperation(): void {
    setBusy(true);
    setProgress(null);
    setErr(null);
    setInfo(null);
  }

  function finishOperation(): void {
    setBusy(false);
  }

  async function applyPreset(): Promise<void> {
    if (!selected) return;
    beginOperation();
    try {
      const preset = presets?.find((candidate) => candidate.id === selected);
      await invokeDeviceWrite(
        "apply_tft_preset",
        { id: selected },
        `Upload ${preset?.display_name ?? "the selected diagnostic animation"} to the TFT.`,
      );
      setLastTft(saveLastApplied("tft", {
        kind: "preset",
        id: selected,
        label: preset?.display_name ?? selected,
      } satisfies LastTftState));
      setInfo(
        preset
          ? `Uploaded ${preset.display_name} (${preset.frame_count} frame${preset.frame_count === 1 ? "" : "s"}, ${formatDuration(preset.total_ms)}). Verify it on the display.`
          : "Upload completed. Verify it on the display.",
      );
    } catch (error) {
      setErr(formatError(error));
    } finally {
      finishOperation();
    }
  }

  async function uploadImage(): Promise<void> {
    setErr(null);
    setInfo(null);
    try {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif"] }],
      });
      if (typeof path !== "string") return;

      beginOperation();
      await invokeDeviceWrite(
        "apply_tft_image",
        { path, fit },
        `Convert and upload ${path.split("/").pop() ?? "the selected image"} to the TFT.`,
      );
      const name = path.split("/").pop() ?? path;
      setLastTft(saveLastApplied("tft", {
        kind: "image",
        label: name,
      } satisfies LastTftState));
      setInfo(`Uploaded ${name} using ${fit} fit. Verify it on the display.`);
    } catch (error) {
      setErr(formatError(error));
    } finally {
      finishOperation();
    }
  }

  async function cancelUpload(): Promise<void> {
    const requested = await invoke<boolean>("cancel_tft_upload");
    if (requested) setInfo("Cancellation requested. The current HID chunk will finish first.");
  }

  async function applyOnlineGif(
    result: GifSearchResult,
    bytes: number[],
    transform: TftImageTransform,
  ): Promise<void> {
    beginOperation();
    try {
      await invokeDeviceWrite(
        "apply_tft_media_bytes",
        { bytes, transform },
        `Convert and upload “${result.title}” from ${result.provider === "giphy" ? "GIPHY" : "Tenor"} to the TFT.`,
      );
      const provider = result.provider === "giphy" ? "GIPHY" : "Tenor";
      setLastTft(saveLastApplied("tft", {
        kind: "image",
        label: `${result.title} · ${provider}`,
      } satisfies LastTftState));
      setInfo(`Uploaded “${result.title}” from ${provider}. Verify it on the display.`);
    } catch (error) {
      setErr(formatError(error));
      throw error;
    } finally {
      finishOperation();
    }
  }

  async function factoryDefault(): Promise<void> {
    beginOperation();
    try {
      await invokeDeviceWrite(
        "tft_factory_default",
        undefined,
        "Restore the firmware-default TFT animation.",
      );
      setLastTft(saveLastApplied("tft", {
        kind: "factory",
        label: "Factory default",
      } satisfies LastTftState));
      setInfo("Restored the firmware-default animation.");
    } catch (error) {
      setErr(formatError(error));
    } finally {
      finishOperation();
    }
  }

  const current = presets?.find((preset) => preset.id === selected);

  return (
    <>
      <PageHeader
        title="TFT Display"
        description="Upload a still image or animated GIF, run a diagnostic pattern, or restore the factory animation."
        action={
          <Button variant="ghost" onClick={() => void factoryDefault()} disabled={busy}>
            Factory Default
          </Button>
        }
      />

      <ErrorBanner>{err}</ErrorBanner>

      {lastTft && (
        <div className="mb-5 flex items-center gap-2 text-xs text-fg-2">
          <Badge tone="warn">Last applied by AJAZZ macOS</Badge>
          <span>{lastTft.value.label} · {new Date(lastTft.savedAt).toLocaleString()}</span>
        </div>
      )}

      <div className="grid gap-6">
        <GifBrowser busy={busy} onApply={applyOnlineGif} />

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <span>Custom image</span>
              <Badge tone="warn">Hardware verification pending</Badge>
            </span>
          }
        >
          <p className="text-sm text-fg-2">
            PNG and JPEG files become one 128 × 128 RGB565 frame. GIFs retain
            frame timing and are capped to the keyboard-safe frame budget.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void uploadImage()} disabled={busy}>
              {busy ? "Uploading…" : "Choose image…"}
            </Button>
            <span className="text-xs uppercase tracking-wider text-fg-3">Fit</span>
            <div className="inline-flex overflow-hidden rounded-md border border-line">
              {(["fill", "contain", "stretch"] as FitMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFit(mode)}
                  disabled={busy}
                  className={[
                    "px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition",
                    fit === mode
                      ? "bg-accent-500/30 text-fg-0"
                      : "bg-surface-raised text-fg-2 hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {busy && progress && (
            <div className="mt-5 border-t border-line/60 pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-fg-2">
                <span>Sending HID chunks</span>
                <span className="font-mono">
                  {progress.completed_chunks}/{progress.total_chunks} · {progress.percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-base">
                <div
                  className="h-full rounded-full bg-accent-500 transition-[width] duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <Button className="mt-3" variant="ghost" size="sm" onClick={() => void cancelUpload()}>
                Cancel upload
              </Button>
            </div>
          )}
        </Card>

        <Card title="Display diagnostics">
          <p className="text-sm text-fg-2">
            Use a generated pattern to verify full-panel orientation, color,
            animation timing, and successful TFT transfer before testing personal media.
          </p>
          {presets === null ? (
            <p className="mt-4 text-sm text-fg-3">Loading diagnostics…</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelected(preset.id)}
                  disabled={busy}
                  className={[
                    "flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition",
                    preset.id === selected
                      ? "border-accent-500/60 bg-accent-500/15 text-fg-0"
                      : "border-line bg-surface-raised text-fg-1 hover:border-line-strong",
                  ].join(" ")}
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="font-medium">{preset.display_name}</span>
                    <span className="flex items-center gap-2">
                      {lastTft?.value.kind === "preset" && lastTft.value.id === preset.id && (
                        <Badge tone="good">Last applied</Badge>
                      )}
                      <span className="text-[10px] uppercase tracking-wider text-fg-3">
                        {preset.frame_count} fr · {formatDuration(preset.total_ms)}
                      </span>
                    </span>
                  </span>
                  <span className="mt-1 text-xs text-fg-2">{preset.description}</span>
                </button>
              ))}
            </div>
          )}
          <Button
            className="mt-4"
            variant="primary"
            onClick={() => void applyPreset()}
            disabled={busy || !current}
          >
            {busy ? "Uploading…" : current ? `Apply · ${current.display_name}` : "Select a diagnostic"}
          </Button>
        </Card>

        {info && (
          <Card title="Status">
            <p className="text-sm text-fg-1">{info}</p>
          </Card>
        )}
      </div>
    </>
  );
}
