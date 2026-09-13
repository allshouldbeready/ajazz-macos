const FRAME_BYTES = 128 * 128 * 2;

export interface DisplayPreviewFrame {
  pixels: Uint8Array;
  delay: number;
}

/** Exact fitted, sampled RGB565 frames from the last successful upload. */
export function decodeTftPreview(data: ArrayBuffer | number[]): DisplayPreviewFrame[] {
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return [];
  if (bytes.length < 6 || bytes[0] !== 84 || bytes[1] !== 70 || bytes[2] !== 84 || bytes[3] !== 49) {
    throw new Error("Saved display preview is unavailable");
  }
  const count = bytes[4] | (bytes[5] << 8);
  if (count === 0 || count > 255 || bytes.length !== 6 + count * (FRAME_BYTES + 2)) {
    throw new Error("Saved display preview is incomplete");
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * (FRAME_BYTES + 2);
    return {
      delay: Math.max(20, bytes[offset] | (bytes[offset + 1] << 8)),
      pixels: bytes.subarray(offset + 2, offset + 2 + FRAME_BYTES),
    };
  });
}

/** Expand the display's RGB565 LE pixels into the canvas's RGBA8 buffer. */
export function writePreviewRgba(pixels: Uint8Array, rgba: Uint8ClampedArray): void {
  if (pixels.length % 2 !== 0 || rgba.length !== pixels.length * 2) {
    throw new Error("Display preview pixel buffers have different sizes");
  }
  for (let pixel = 0; pixel < pixels.length / 2; pixel++) {
    const value = pixels[pixel * 2] | (pixels[pixel * 2 + 1] << 8);
    const red = (value >> 11) & 31;
    const green = (value >> 5) & 63;
    const blue = value & 31;
    rgba[pixel * 4] = (red << 3) | (red >> 2);
    rgba[pixel * 4 + 1] = (green << 2) | (green >> 4);
    rgba[pixel * 4 + 2] = (blue << 3) | (blue >> 2);
    rgba[pixel * 4 + 3] = 255;
  }
}
