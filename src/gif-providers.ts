import { fetch as httpFetch } from "@tauri-apps/plugin-http";

export interface GifSearchResult {
  id: string;
  provider: "giphy";
  title: string;
  previewUrl: string;
  downloadUrl: string;
  pageUrl: string;
  width: number;
  height: number;
}

const SEARCH_LIMIT = 18;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

export async function searchGifs(
  query: string,
  apiKey: string,
): Promise<GifSearchResult[]> {
  const term = query.trim().slice(0, 50);
  const key = apiKey.trim();
  if (!term) throw new Error("Enter a GIF search term.");
  if (!key) throw new Error("Enter a GIPHY API key.");
  return searchGiphy(term, key);
}

export async function downloadGif(result: GifSearchResult): Promise<number[]> {
  if (!isAllowedMediaUrl(result.downloadUrl)) {
    throw new Error("The provider returned an untrusted media URL.");
  }
  const response = await httpFetch(result.downloadUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`GIF download failed (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("This GIF is larger than the 15 MiB import limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("The downloaded GIF is empty or larger than 15 MiB.");
  }
  const signature = String.fromCharCode(...bytes.slice(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("The selected provider rendition is not a GIF.");
  }
  return Array.from(bytes);
}

async function searchGiphy(query: string, apiKey: string): Promise<GifSearchResult[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    limit: String(SEARCH_LIMIT),
    rating: "pg",
    lang: "en",
    bundle: "messaging_non_clips",
  });
  const response = await httpFetch(`https://api.giphy.com/v1/gifs/search?${params}`, {
    method: "GET",
  });
  if (!response.ok) throw new Error(`GIPHY search failed (${response.status}).`);
  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      title?: string;
      url?: string;
      images?: Record<string, { url?: string; width?: string; height?: string }>;
    }>;
  };
  return (payload.data ?? []).flatMap((item) => {
    const preview = item.images?.fixed_width_small ?? item.images?.fixed_width;
    const download = item.images?.fixed_width ?? item.images?.downsized_medium;
    if (!item.id || !preview?.url || !download?.url) return [];
    if (!isAllowedMediaUrl(preview.url) || !isAllowedMediaUrl(download.url)) {
      return [];
    }
    return [{
      id: item.id,
      provider: "giphy" as const,
      title: item.title?.trim() || "Untitled GIF",
      previewUrl: preview.url,
      downloadUrl: download.url,
      pageUrl: item.url ?? "https://giphy.com",
      width: positiveNumber(download.width, 200),
      height: positiveNumber(download.height, 200),
    }];
  });
}

function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "giphy.com" || host.endsWith(".giphy.com");
  } catch {
    return false;
  }
}

function positiveNumber(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
