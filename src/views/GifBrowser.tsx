import { useMemo, useState, type CSSProperties } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Badge, Button, Card, ErrorBanner } from "../components/ui";
import { formatError } from "../errors";
import {
  downloadGif,
  searchGifs,
  type GifProvider,
  type GifSearchResult,
} from "../gif-providers";

export interface TftImageTransform {
  fit: "fill" | "contain" | "stretch";
  zoom_percent: number;
  position_x: number;
  position_y: number;
  background: string;
  speed_percent: number;
  max_frames: number;
}

interface Props {
  busy: boolean;
  onApply: (
    result: GifSearchResult,
    bytes: number[],
    transform: TftImageTransform,
  ) => Promise<void>;
}

const KEY_STORAGE: Record<GifProvider, string> = {
  giphy: "ajazz-macos:giphy-api-key",
  tenor: "ajazz-macos:tenor-api-key",
};

const DEFAULT_TRANSFORM: TftImageTransform = {
  fit: "fill",
  zoom_percent: 100,
  position_x: 50,
  position_y: 50,
  background: "000000",
  speed_percent: 100,
  max_frames: 30,
};

export function GifBrowser({ busy, onApply }: Props) {
  const [provider, setProvider] = useState<GifProvider>("giphy");
  const [apiKeys, setApiKeys] = useState<Record<GifProvider, string>>(() => ({
    giphy: readStoredKey("giphy"),
    tenor: readStoredKey("tenor"),
  }));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifSearchResult[]>([]);
  const [selected, setSelected] = useState<GifSearchResult | null>(null);
  const [transform, setTransform] = useState<TftImageTransform>(DEFAULT_TRANSFORM);
  const [searching, setSearching] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewStyle = useMemo(() => ({
    backgroundColor: `#${transform.background}`,
  }), [transform.background]);
  const imagePlacement = useMemo(
    () => selected ? calculatePreviewPlacement(selected, transform) : undefined,
    [selected, transform],
  );

  function updateKey(value: string): void {
    setApiKeys((current) => ({ ...current, [provider]: value }));
    try {
      window.localStorage.setItem(KEY_STORAGE[provider], value);
    } catch {
      // Searching still works for this session when local storage is unavailable.
    }
  }

  async function search(): Promise<void> {
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      setResults(await searchGifs(provider, query, apiKeys[provider]));
    } catch (reason) {
      setResults([]);
      setError(formatError(reason));
    } finally {
      setSearching(false);
    }
  }

  async function apply(): Promise<void> {
    if (!selected) return;
    setPreparing(true);
    setError(null);
    try {
      const bytes = await downloadGif(selected);
      await onApply(selected, bytes, transform);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setPreparing(false);
    }
  }

  function updateTransform<K extends keyof TftImageTransform>(
    key: K,
    value: TftImageTransform[K],
  ): void {
    setTransform((current) => ({ ...current, [key]: value }));
  }

  const providerName = provider === "giphy" ? "GIPHY" : "Tenor";
  const setupUrl = provider === "giphy"
    ? "https://developers.giphy.com/dashboard/"
    : "https://console.cloud.google.com/apis/library/tenor.googleapis.com";
  let applyLabel = "Apply to TFT";
  if (preparing) applyLabel = "Downloading…";
  else if (busy) applyLabel = "Uploading…";

  return (
    <Card
      kicker="Online library"
      title="Find a GIF"
      action={<Badge tone="accent">Powered by {providerName}</Badge>}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-3">
            <div className="inline-flex overflow-hidden rounded-md border border-line">
              {(["giphy", "tenor"] as GifProvider[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setProvider(candidate);
                    setResults([]);
                    setSelected(null);
                    setError(null);
                  }}
                  className={[
                    "px-3 py-2 text-xs font-medium uppercase tracking-wider transition",
                    provider === candidate
                      ? "bg-accent-500/30 text-fg-0"
                      : "bg-surface-raised text-fg-2 hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <label className="min-w-52 flex-1">
              <span className="kicker mb-1 block">{providerName} API key</span>
              <input
                className="w-full"
                type="password"
                value={apiKeys[provider]}
                onChange={(event) => updateKey(event.target.value)}
                placeholder={`Paste your ${providerName} key`}
                autoComplete="off"
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => void openUrl(setupUrl)}>
              Get a key
            </Button>
          </div>
          <p className="mt-2 text-xs text-fg-3">
            Keys stay on this Mac and are sent only to the selected provider.
            {provider === "tenor" && " Tenor no longer accepts new API clients; existing keys remain supported."}
          </p>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              className="min-w-0 flex-1"
              type="text"
              maxLength={50}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reactions, animals, pixel art…"
            />
            <Button type="submit" variant="primary" disabled={searching || busy}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          <ErrorBanner>{error}</ErrorBanner>

          {results.length > 0 ? (
            <div className="mt-4 grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
              {results.map((result) => (
                <button
                  key={`${result.provider}:${result.id}`}
                  type="button"
                  onClick={() => setSelected(result)}
                  aria-label={`Select ${result.title}`}
                  className={[
                    "group relative aspect-square overflow-hidden rounded-md border bg-surface-base transition",
                    selected?.id === result.id
                      ? "border-accent-400 ring-2 ring-accent-500/35"
                      : "border-line hover:border-line-strong",
                  ].join(" ")}
                >
                  <img
                    src={result.previewUrl}
                    alt={result.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-line px-4 py-10 text-center text-sm text-fg-3">
              Search results will appear here.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface-base/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="kicker">128 × 128 preview</p>
              <p className="mt-1 line-clamp-1 text-sm text-fg-1">
                {selected?.title ?? "Select a search result"}
              </p>
            </div>
            {selected && <Badge tone="neutral">{selected.width} × {selected.height}</Badge>}
          </div>

          <div
            className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-md border border-line shadow-card"
            style={previewStyle}
          >
            {selected ? (
              <img
                src={selected.downloadUrl}
                alt="TFT crop preview"
                className="absolute max-w-none"
                style={imagePlacement}
              />
            ) : (
              <div className="grid h-full place-items-center text-center text-xs text-fg-3">
                Your crop and resize preview appears here.
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 border border-white/10" />
          </div>

          <div className="mt-4 space-y-3">
            <EditorSelect
              label="Fit"
              value={transform.fit}
              options={["fill", "contain", "stretch"]}
              onChange={(value) => updateTransform("fit", value as TftImageTransform["fit"])}
            />
            <EditorRange label="Zoom" value={transform.zoom_percent} min={25} max={400} suffix="%"
              onChange={(value) => updateTransform("zoom_percent", value)} />
            <EditorRange label="Horizontal crop" value={transform.position_x} min={0} max={100} suffix="%"
              onChange={(value) => updateTransform("position_x", value)} />
            <EditorRange label="Vertical crop" value={transform.position_y} min={0} max={100} suffix="%"
              onChange={(value) => updateTransform("position_y", value)} />
            <EditorRange label="Playback speed" value={transform.speed_percent} min={25} max={400} suffix="%"
              onChange={(value) => updateTransform("speed_percent", value)} />
            <EditorRange label="Frame limit" value={transform.max_frames} min={1} max={30}
              onChange={(value) => updateTransform("max_frames", value)} />
            <label className="flex items-center justify-between gap-3 text-xs text-fg-2">
              <span>Letterbox color</span>
              <input
                type="color"
                value={`#${transform.background}`}
                onChange={(event) => updateTransform("background", event.target.value.slice(1).toUpperCase())}
                className="h-8 w-12"
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              variant="primary"
              onClick={() => void apply()}
              disabled={!selected || busy || preparing}
            >
              {applyLabel}
            </Button>
            <Button variant="ghost" onClick={() => setTransform(DEFAULT_TRANSFORM)} disabled={busy}>
              Reset
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
            The preview animates at the provider's original speed. Speed and frame-limit changes are applied during conversion.
          </p>
        </div>
      </div>
    </Card>
  );
}

function EditorRange({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-xs text-fg-2">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--pct": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
      <span className="text-right font-mono text-fg-1">{value}{suffix}</span>
    </label>
  );
}

function EditorSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-fg-2">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs uppercase text-fg-1"
      >
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function readStoredKey(provider: GifProvider): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE[provider]) ?? "";
  } catch {
    return "";
  }
}

function calculatePreviewPlacement(
  result: GifSearchResult,
  transform: TftImageTransform,
): CSSProperties {
  const zoom = transform.zoom_percent / 100;
  let scaleX: number;
  let scaleY: number;
  if (transform.fit === "stretch") {
    scaleX = 128 / result.width;
    scaleY = 128 / result.height;
  } else {
    const fill = transform.fit === "fill";
    const scale = fill
      ? Math.max(128 / result.width, 128 / result.height)
      : Math.min(128 / result.width, 128 / result.height);
    scaleX = scale;
    scaleY = scale;
  }
  const width = (result.width * scaleX * zoom / 128) * 100;
  const height = (result.height * scaleY * zoom / 128) * 100;
  return {
    width: `${width}%`,
    height: `${height}%`,
    left: `${(100 - width) * transform.position_x / 100}%`,
    top: `${(100 - height) * transform.position_y / 100}%`,
  };
}
