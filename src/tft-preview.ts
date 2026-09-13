import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { decodeTftPreview, type DisplayPreviewFrame } from "./tft-preview-codec";

export function useTftPreview() {
  const [frames, setFrames] = useState<DisplayPreviewFrame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    async function refresh() {
      const request = ++revision;
      try {
        const data = await invoke<ArrayBuffer | number[]>("get_tft_preview");
        const next = decodeTftPreview(data);
        if (!disposed && request === revision) setFrames(next);
      } catch {
        if (!disposed && request === revision) setFrames([]);
      } finally {
        if (!disposed && request === revision) setLoading(false);
      }
    }
    void listen("tft-preview-changed", () => void refresh()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {
      // A browser-only preview has no native events.
    });
    void refresh();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { frames, loading };
}
