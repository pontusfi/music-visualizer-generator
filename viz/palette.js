/**
 * The record's own colours, and where it sits in the frame.
 *
 * Pure maths only — takes pixels and numbers, returns numbers. The canvas work
 * that produces those pixels lives in assets.js.
 */

/** Share of the frame height the cover occupies, and where its top edge sits. */
const COVER_HEIGHT = 0.62;
const COVER_TOP = 0.10;
/** Widest the cover may get before it starts fighting the frame edges. */
const COVER_MAX_WIDTH = 0.86;

const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const chroma = (c) => Math.max(...c) - Math.min(...c);
const sat = (c) => chroma(c) / (Math.max(...c) || 1);

const FALLBACK = {
  ground: [10, 9, 9],
  ember: [196, 74, 32],
  bone: [201, 194, 180],
};

/**
 * Ground, ember and bone, straight out of the artwork.
 *
 * Coarse quantise into buckets, then pick by role rather than by a single
 * global statistic — an average is always mud.
 *
 * @param pixels RGBA bytes, as getImageData returns them.
 */
export function pickPalette(pixels) {
  const buckets = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue; // invisible pixels have no say
    const key = (pixels[i] >> 4) * 289 + (pixels[i + 1] >> 4) * 17 + (pixels[i + 2] >> 4);
    const b = buckets.get(key) || [0, 0, 0, 0];
    b[0] += pixels[i];
    b[1] += pixels[i + 1];
    b[2] += pixels[i + 2];
    b[3] += 1;
    buckets.set(key, b);
  }

  const cols = [...buckets.values()]
    .filter((b) => b[3] > 2)
    .map((b) => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
  if (cols.length === 0) return { ...FALLBACK };

  const ground = cols.slice().sort((a, b) => lum(a) - lum(b))[0] ?? FALLBACK.ground;
  const bone = cols.slice().sort((a, b) => lum(b) - lum(a))[0] ?? FALLBACK.bone;

  // Exclude blown highlights and near-black. A clipped white sun has high
  // luminance and no colour and would win a naive "most vivid" sort every
  // time; the ember has to come from the midtones or it comes out beige.
  const mids = cols.filter((c) => lum(c) > 0.18 && lum(c) < 0.88);
  const pool = mids.length ? mids : cols;
  const ember =
    pool.slice().sort((a, b) => sat(b) * chroma(b) - sat(a) * chroma(a))[0] ??
    FALLBACK.ember;

  return {
    ground: ground.map((v) => v * 0.35),
    ember: ember.slice(),
    bone: bone.slice(),
  };
}

/** Where the cover sits in a W x H frame, in whole pixels. */
export function layoutFor(artW, artH, W, H) {
  const ratio = artW > 0 && artH > 0 ? artW / artH : 1;
  let h = Math.round(H * COVER_HEIGHT);
  let w = Math.round(h * ratio);
  const maxW = Math.round(W * COVER_MAX_WIDTH);
  if (w > maxW) {
    w = maxW;
    h = Math.round(w / ratio);
  }
  return {
    w: Math.max(1, w),
    h: Math.max(1, h),
    x: Math.round((W - w) / 2),
    y: Math.round(H * COVER_TOP),
  };
}

/**
 * Rotate a colour round the hue wheel by `delta` turns, keeping its
 * saturation and lightness.
 *
 * The ember stays the artwork's colour; harmony only nudges it. Grey has no
 * hue, so it comes back grey.
 */
export function shiftHue([r, g, b], delta) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  const c = mx - mn;
  if (c === 0) return [Math.round(r), Math.round(g), Math.round(b)];

  const s = c / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === R) h = ((G - B) / c) % 6;
  else if (mx === G) h = (B - R) / c + 2;
  else h = (R - G) / c + 4;
  h = ((h * 60 + 360) % 360) / 360;

  const hue = ((h + delta) % 1 + 1) % 1;
  const deg = hue * 360;
  const cc = (1 - Math.abs(2 * l - 1)) * s;
  const xx = cc * (1 - Math.abs(((deg / 60) % 2) - 1));
  const m = l - cc / 2;
  let out;
  if (deg < 60) out = [cc, xx, 0];
  else if (deg < 120) out = [xx, cc, 0];
  else if (deg < 180) out = [0, cc, xx];
  else if (deg < 240) out = [0, xx, cc];
  else if (deg < 300) out = [xx, 0, cc];
  else out = [cc, 0, xx];
  out = out.map((v) => (v + m) * 255);

  // Equal HSL lightness is not equal brightness: green carries three times the
  // luminance of blue. Left uncorrected, nudging the ember toward yellow makes
  // it visibly brighter, and since the burn composites additively the flare
  // would get stronger for no musical reason. Put the luminance back.
  const before = relLum([r, g, b]);
  const after = relLum(out);
  if (before > 0 && after > 0) {
    out = out.map((v) => (v * before) / after);
    // Scaling up can push a channel past 255, and clipping it would move the
    // hue as well as the brightness. Blend toward the grey of the same
    // luminance instead: relative luminance is linear, so every point on that
    // blend has exactly the brightness we asked for — the colour just gets
    // less saturated, which is what running out of gamut actually means.
    const peak = Math.max(...out);
    if (peak > 255) {
      const t = (peak - 255) / (peak - before);
      out = out.map((v) => v * (1 - t) + before * t);
    }
  }
  return out.map((v) => Math.max(0, Math.min(255, Math.round(v))));
}

const relLum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
