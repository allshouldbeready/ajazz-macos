import { fetch as httpFetch } from "@tauri-apps/plugin-http";

export type GifProvider = "giphy" | "tenor";

export interface GifSearchResult {
  id: string;
  provider: GifProvider;
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
  provider: GifProvider,
  query: string,
  apiKey: string,
): Promise<GifSearchResult[]> {
  const term = query.trim().slice(0, 50);
  const key = apiKey.trim();
  if (!term) throw new Error("Enter a GIF search term.");
  if (!key) throw new Error(`Enter a ${provider === "giphy" ? "GIPHY" : "Tenor"} API key.`);

  return provider === "giphy"
    ? searchGiphy(term, key)
    : searchTenor(term, key);
}

export async function downloadGif(result: GifSearchResult): Promise<number[]> {
  if (!isAllowedMediaUrl(result.downloadUrl, result.provider)) {
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
    if (!isAllowedMediaUrl(preview.url, "giphy") || !isAllowedMediaUrl(download.url, "giphy")) {
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

async function searchTenor(query: string, apiKey: string): Promise<GifSearchResult[]> {
  const params = new URLSearchParams({
    key: apiKey,
    client_key: "ajazz_macos",
    q: query,
    limit: String(SEARCH_LIMIT),
    contentfilter: "medium",
    locale: "en_AU",
    country: "AU",
    media_filter: "gif,tinygif",
  });
  const response = await httpFetch(`https://tenor.googleapis.com/v2/search?${params}`, {
    method: "GET",
  });
  if (!response.ok) throw new Error(`Tenor search failed (${response.status}).`);
  const payload = (await response.json()) as {
    results?: Array<{
      id?: string;
      content_description?: string;
      itemurl?: string;
      media_formats?: Record<string, { url?: string; dims?: number[] }>;
    }>;
  };
  return (payload.results ?? []).flatMap((item) => {
    const preview = item.media_formats?.tinygif ?? item.media_formats?.gif;
    const download = item.media_formats?.gif ?? item.media_formats?.tinygif;
    if (!item.id || !preview?.url || !download?.url) return [];
    if (!isAllowedMediaUrl(preview.url, "tenor") || !isAllowedMediaUrl(download.url, "tenor")) {
      return [];
    }
    return [{
      id: item.id,
      provider: "tenor" as const,
      title: item.content_description?.trim() || "Untitled GIF",
      previewUrl: preview.url,
      downloadUrl: download.url,
      pageUrl: item.itemurl ?? "https://tenor.com",
      width: positiveNumber(download.dims?.[0], 200),
      height: positiveNumber(download.dims?.[1], 200),
    }];
  });
}

function isAllowedMediaUrl(value: string, provider: GifProvider): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (provider === "giphy") return host === "giphy.com" || host.endsWith(".giphy.com");
    return host === "tenor.com" || host.endsWith(".tenor.com");
  } catch {
    return false;
  }
}

function positiveNumber(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
