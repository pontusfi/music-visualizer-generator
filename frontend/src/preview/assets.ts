import { mulberry32 } from "./signals";

/** The cover, reduced to only its highlights.
 *
 * This is the layer that burns on a kick: everything below mid-grey is thrown
 * away, so a bloom pass lights the bright parts of the artwork and leaves the
 * shadows where they are. Same trick the renderer uses, at a tenth the size.
 */
export function buildHighlights(image: HTMLImageElement, size = 320): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.drawImage(image, 0, 0, size, size);
  const frame = ctx.getImageData(0, 0, size, size);
  const d = frame.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const keep = Math.max(0, lum - 0.55) / 0.45;
    d[i] *= keep;
    d[i + 1] *= keep;
    d[i + 2] *= keep;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** A fixed tile of noise, generated once from a fixed seed.
 *  Re-rolling it per frame is what makes grain crawl. */
export function buildGrain(size = 128, seed = 9001): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const frame = ctx.createImageData(size, size);
  const d = frame.data;
  const random = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const v = 120 + random() * 135;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** Downsample a cover to a pixel block small enough to bin by hue. */
export function samplePixels(
  image: HTMLImageElement,
  size = 64,
): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  } catch {
    // a tainted canvas: nothing to read, and nothing worth throwing over
    return null;
  }
}
