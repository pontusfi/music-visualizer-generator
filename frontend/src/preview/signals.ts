/** The maths behind the preview meters.
 *
 * This is only the monitor, not the render. The mp4 is drawn from the
 * frame table analyse.py wrote; nothing here ever reaches it.
 */

/** Lowest band the spectrum draws, and how many octaves it spans. */
export const BAND_LOW_HZ = 40;
export const BAND_SPREAD = 340;

/** One step of an attack/release envelope follower. */
export function follow(
  current: number,
  target: number,
  attack: number,
  release: number,
): number {
  const c = Number.isFinite(current) ? current : 0;
  const t = Number.isFinite(target) ? target : 0;
  const rate = t > c ? attack : release;
  return c + (t - c) * Math.min(1, Math.max(0, rate));
}

/** The inclusive FFT bin range covering a frequency band. */
export function bandBins(
  loHz: number,
  hiHz: number,
  fftSize: number,
  sampleRate: number,
): [number, number] {
  const top = fftSize / 2 - 1;
  const at = (hz: number) => (hz * fftSize) / sampleRate;
  const [low, high] = loHz <= hiHz ? [loHz, hiHz] : [hiHz, loHz];
  const lo = Math.min(top, Math.max(0, Math.floor(at(low))));
  const hi = Math.min(top, Math.max(lo, Math.ceil(at(high))));
  return [lo, hi];
}

/** The log-spaced edges of one bar in a `count`-band spectrum. */
export function bandEdges(
  index: number,
  count: number,
  low = BAND_LOW_HZ,
  spread = BAND_SPREAD,
): [number, number] {
  return [
    low * Math.pow(spread, index / count),
    low * Math.pow(spread, (index + 1) / count),
  ];
}

/** A seeded PRNG. The grain has to be the same on every reload, or the
 *  preview crawls while the render — which has no random at all — sits still. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
