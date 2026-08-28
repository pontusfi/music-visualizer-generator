/** The shell takes its colour from the cover.
 *
 * Not the average colour — an average is always mud. This bins the saturated,
 * mid-lit pixels by hue and picks the heaviest bin, which is how you find the
 * one ember in an otherwise black sleeve.
 */

const BINS = 24;
const BIN_DEG = 360 / BINS;

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const q = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${q(r)}${q(g)}${q(b)}`;
}

/** @param pixels RGBA bytes, as they come out of getImageData. */
export function extractAccent(pixels: Uint8ClampedArray, fallback: string): string {
  const weight = new Float64Array(BINS);
  const saturation = new Float64Array(BINS);
  const lightness = new Float64Array(BINS);

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue; // invisible pixels have no say
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const chroma = mx - mn;
    // grey, crushed black and blown white carry no usable hue
    if (chroma < 0.06 || l < 0.08 || l > 0.95) continue;

    const s = chroma / (1 - Math.abs(2 * l - 1));
    let hue: number;
    if (mx === r) hue = ((g - b) / chroma) % 6;
    else if (mx === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;

    // favour vivid pixels near mid-lightness: the ones that read as "the colour"
    const w = s * s * (1 - Math.abs(l - 0.55));
    const bin = Math.floor(hue / BIN_DEG) % BINS;
    weight[bin] += w;
    saturation[bin] += s * w;
    lightness[bin] += l * w;
  }

  let best = 0;
  let winner = -1;
  for (let i = 0; i < BINS; i += 1) {
    if (weight[i] > best) {
      best = weight[i];
      winner = i;
    }
  }
  if (winner < 0 || best <= 0) return fallback;

  const hue = winner * BIN_DEG + BIN_DEG / 2;
  // clamped so the accent is always legible against the near-black shell
  const s = Math.min(0.88, Math.max(0.48, saturation[winner] / best));
  const l = Math.min(0.64, Math.max(0.52, lightness[winner] / best));
  return hslToHex(hue, s, l);
}
