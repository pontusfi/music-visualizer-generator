/**
 * Seeded noise. There is no Math.random anywhere in the render path: an
 * unseeded generator makes grain crawl between frames, which reads as encoder
 * noise and eats bitrate for nothing.
 */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ease in and out, for anything that has to arrive without a jolt. */
export const smoothstep = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

export const lerp = (a, b, t) => a + (b - a) * t;
