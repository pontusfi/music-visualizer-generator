/**
 * Everything expensive, built once at init.
 *
 * The rule here is that nothing allocates during the render. Every canvas a
 * look draws per frame already exists by the time renderFrame is first called;
 * the draw path only ever composites them.
 */

import { pickPalette } from "./palette.js";

export function off(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** The cover, small enough to bin by colour. */
export function samplePixels(img, size = 64) {
  const c = off(size, size);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, size, size);
  return x.getImageData(0, 0, size, size).data;
}

export const paletteFrom = (img) => pickPalette(samplePixels(img));

/**
 * The signature: ten luminance thresholds of the cover, as white masks.
 *
 * White rather than ember-coloured, which is the change that lets the burn
 * take its colour from the harmony at draw time. A mask is tinted on the way
 * to the screen instead of being baked at init, so the ember can move without
 * rebuilding ten full-size layers.
 */
export function buildBurnMasks(img, w, h, levels = 10) {
  const src = off(w, h);
  const sc = src.getContext("2d", { willReadFrequently: true });
  sc.drawImage(img, 0, 0, w, h);
  const base = sc.getImageData(0, 0, w, h).data;

  const masks = [];
  for (let t = 0; t < levels; t += 1) {
    const threshold = 0.8 - t * (0.62 / levels);
    const layer = off(w, h);
    const lc = layer.getContext("2d");
    const image = lc.createImageData(w, h);
    const d = image.data;
    for (let i = 0; i < base.length; i += 4) {
      const l =
        (0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2]) / 255;
      if (l > threshold) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = Math.round(255 * Math.min(1, (l - threshold) / 0.14));
      }
    }
    lc.putImageData(image, 0, 0);
    masks.push(layer);
  }
  return masks;
}

/**
 * Full-frame grain sheets, cycled by frame index.
 *
 * Tiling a 512px square every frame costs more than the memory does, and at 4K
 * it dominates the draw budget. Eight sheets is enough that the eye reads it as
 * film grain rather than a loop.
 */
export function buildGrain(W, H, rng, sheets = 8) {
  const out = [];
  for (let t = 0; t < sheets; t += 1) {
    const tile = off(512, 512);
    const tc = tile.getContext("2d");
    const image = tc.createImageData(512, 512);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 110 + rng() * 90;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    tc.putImageData(image, 0, 0);

    const sheet = off(W, H);
    const c = sheet.getContext("2d");
    for (let y = 0; y < H; y += 512) for (let x = 0; x < W; x += 512) c.drawImage(tile, x, y);
    out.push(sheet);
  }
  return out;
}

/** Baked once: a radial gradient per frame is expensive under software raster. */
export function buildVignette(W, H, inner = 0.3, outer = 0.95, strength = 0.55) {
  const c = off(W, H);
  const x = c.getContext("2d");
  const g = x.createRadialGradient(W / 2, H / 2, H * inner, W / 2, H / 2, H * outer);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

/** Channel-separated copies, for the transient split. */
export function channelSplit(img, w, h) {
  const make = (tint) => {
    const c = off(w, h);
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, w, h);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = tint;
    x.fillRect(0, 0, w, h);
    return c;
  };
  return { r: make("#ff0000"), g: make("#00ff00"), b: make("#0000ff") };
}

/**
 * Reusable scratch surfaces for the things that must change colour per frame.
 *
 * Both canvases are allocated once and repainted in place — the point is that
 * an eight-minute render at 60 fps does 28,800 frames and must not leave 28,800
 * dead canvases behind it.
 */
export class Tint {
  constructor(w, h) {
    this.mask = off(w, h);
    this.maskCtx = this.mask.getContext("2d");
    this.strip = off(1, 256);
    this.stripCtx = this.strip.getContext("2d");
    this._strip = null;
  }

  /** A burn mask, painted in `colour`. */
  burn(maskCanvas, colour) {
    const c = this.maskCtx;
    c.globalCompositeOperation = "copy";
    c.drawImage(maskCanvas, 0, 0);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = colour;
    c.fillRect(0, 0, this.mask.width, this.mask.height);
    c.globalCompositeOperation = "source-over";
    return this.mask;
  }

  /** One colour-to-nothing strip, stretched per spectrum bar. */
  bar(colour) {
    if (this._strip === colour) return this.strip;
    this._strip = colour;
    const c = this.stripCtx;
    const rgb = colour.slice(colour.indexOf("(") + 1, colour.lastIndexOf(")"));
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, `rgba(${rgb},0.95)`);
    g.addColorStop(0.35, `rgba(${rgb},0.42)`);
    g.addColorStop(1.0, `rgba(${rgb},0)`);
    c.globalCompositeOperation = "copy";
    c.fillStyle = g;
    c.fillRect(0, 0, 1, 256);
    c.globalCompositeOperation = "source-over";
    return this.strip;
  }
}
