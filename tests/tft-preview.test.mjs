import assert from "node:assert/strict";
import test from "node:test";
import { decodeTftPreview, writePreviewRgba } from "../src/tft-preview-codec.ts";

function twoFrameFixture() {
  const frameBytes = 128 * 128 * 2;
  const bytes = new Uint8Array(6 + 2 * (2 + frameBytes));
  bytes.set([84, 70, 84, 49, 2, 0, 75, 0]);
  for (let offset = 8; offset < 8 + frameBytes; offset += 2) bytes.set([0, 248], offset);
  bytes.set([240, 0], 8 + frameBytes);
  for (let offset = 10 + frameBytes; offset < bytes.length; offset += 2) bytes.set([31, 0], offset);
  return bytes;
}

test("decodes distinct animation frames and per-frame timing from binary IPC and JSON fallback", () => {
  for (const source of [twoFrameFixture().buffer, Array.from(twoFrameFixture())]) {
    const frames = decodeTftPreview(source);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames.map((frame) => frame.delay), [75, 240]);
    assert.equal(frames[0].pixels.length, 32768);
    assert.deepEqual(Array.from(frames[0].pixels.slice(-2)), [0, 248]);
    assert.deepEqual(Array.from(frames[1].pixels.slice(0, 2)), [31, 0]);
  }
});

test("rejects malformed and truncated cache while treating missing cache as empty", () => {
  assert.deepEqual(decodeTftPreview([]), []);
  for (const bytes of [[1, 2], [84, 70, 84, 49, 0, 0], [84, 70, 84, 49, 0, 1]]) {
    assert.throws(() => decodeTftPreview(bytes));
  }
  assert.throws(() => decodeTftPreview(twoFrameFixture().slice(0, -1).buffer));
  const invalidMagic = twoFrameFixture();
  invalidMagic[0] = 0;
  assert.throws(() => decodeTftPreview(invalidMagic.buffer));
});

test("avoids zero-delay animation loops", () => {
  const bytes = twoFrameFixture();
  bytes[6] = 0;
  assert.equal(decodeTftPreview(bytes.buffer)[0].delay, 20);
});

test("RGB565 little-endian conversion preserves primary colours, white, black, and midtones", () => {
  const pixels = new Uint8Array([0, 248, 224, 7, 31, 0, 255, 255, 0, 0, 16, 132]);
  const rgba = new Uint8ClampedArray(24);
  writePreviewRgba(pixels, rgba);
  assert.deepEqual(Array.from(rgba), [
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255, 132, 130, 132, 255,
  ]);
  assert.throws(() => writePreviewRgba(new Uint8Array([0]), new Uint8ClampedArray(2)));
  assert.throws(() => writePreviewRgba(pixels, new Uint8ClampedArray(4)));
});
