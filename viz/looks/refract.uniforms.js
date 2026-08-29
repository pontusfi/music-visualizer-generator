/**
 * What Refract asks its shaders to draw, as plain numbers.
 *
 * Kept out of refract.js so it can be tested without a WebGL context: the
 * shader is arithmetic on these values, and this is where the decisions are.
 * Same split as `composition` in shear.js.
 *
 * Nothing here reads a clock or calls Math.random — `s` is already a pure
 * function of the frame index, and so is everything below.
 */

import { shiftHue } from "../palette.js";
import { lerp, mulberry32, smoothstep } from "../rng.js";

/** How far the harmony may drag the ember round the wheel. As in orbit.js. */
const HUE_SPREAD = 0.20;
/** Seconds a section change takes to settle. Matches main.js's seat easing. */
const FIELD_EASE = 1.2;

const norm = (c) => c.map((v) => v / 255);

/** Mean of a slice of the spectrum; 0 for a v1 file that has none. */
function bandMean(spectrum, from, to) {
  const n = spectrum.length;
  if (!n) return 0;
  const a = Math.floor(n * from);
  const b = Math.max(a + 1, Math.floor(n * to));
  let sum = 0;
  for (let i = a; i < b && i < n; i += 1) sum += spectrum[i] || 0;
  return sum / (b - a);
}

/**
 * Where the background field sits during a given section.
 *
 * The visual analogue of `seatFor` in main.js: derived from the section number
 * through a seeded generator, so a chorus does not stand on the same ground as
 * the verse, and every render of the track puts it in the same place.
 */
export function fieldSeedFor(section) {
  const r = mulberry32(4177 + section * 7919);
  return [r() * 64, r() * 64];
}

export function uniformsFor(s, a) {
  const { W, H, layout, palette, seat } = a;
  const fps = a.signals?.fps || 60;

  const low = bandMean(s.spectrum, 0, 1 / 3);
  const mid = bandMean(s.spectrum, 1 / 3, 2 / 3);
  const high = bandMean(s.spectrum, 2 / 3, 1);

  // A section change is a cut in the music and must not be a cut on screen,
  // so the field drifts to its new seat over about a second. sinceSection
  // makes that an analytic function of i rather than state carried forward.
  const here = fieldSeedFor(s.section);
  const prev = fieldSeedFor(Math.max(0, s.section - 1));
  const t = smoothstep(s.sinceSection / Math.max(1, fps * FIELD_EASE));
  const uSeed = [lerp(prev[0], here[0], t), lerp(prev[1], here[1], t)];

  // the cover, positioned by the same seat the other looks use, in texture
  // coordinates — and flipped, because vUv.y = 0 is the bottom of the frame
  const cw = layout.w * seat.scale;
  const ch = layout.h * seat.scale;
  const cx = layout.x - (cw - layout.w) / 2 + seat.dx * W;
  const cyTop = layout.y - (ch - layout.h) / 2 + seat.dy * H;

  return {
    uFrame: s.i,
    uRes: [W, H],
    uCover: [cx / W, 1 - (cyTop + ch) / H, cw / W, ch / H],
    uSeed,

    // --- the background ---------------------------------------------------
    // it breathes with the bass, and `arc` opens it up over the track
    uWarp: 0.15 + low * 0.55,
    uField: 0.35 + s.arc * 0.40,

    // --- the cover --------------------------------------------------------
    // displacement in uv, so it is resolution-independent
    uDisplace: 0.004 + s.kick * 0.020 + mid * 0.008,
    // the split follows the transient rather than a threshold on `hit`, which
    // is what made the old channelSplit fire in clumps
    uAberration: 0.0008 + s.onsetPulse * Math.max(0, s.hit - 0.3) * 0.010,

    // --- light ------------------------------------------------------------
    uBloom: 0.25 + s.kick * 0.50 + s.drive * 0.25,
    // exposure on the cover, about 1.0 at rest: the shader multiplies
    // straight through, so this is the whole range and 2x clipped it flat
    uBright: 0.85 + s.bright * 0.25 + high * 0.15,

    uGround: norm(palette.ground),
    uEmber: norm(shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal)),
  };
}
