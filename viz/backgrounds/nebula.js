/**
 * NEBULA — four glows, orbiting slowly behind everything.
 *
 * Seeded per section, so a chorus does not glow in the same place the verse
 * did, and brightening with `rms` and `arc` rather than any one transient —
 * this sits behind the look, not on the beat with it.
 *
 * Each glow is one soft radial sprite, built once at init; four `drawImage`
 * calls a frame, composited with `lighter` so overlapping glows add light
 * instead of occluding each other.
 */
import { off } from "../assets.js";
import { css } from "../palette.js";
import { mulberry32 } from "../rng.js";

export const id = "nebula";
export const name = "Nebula";

const GLOWS = 4;
/** Frames for one full orbit at a glow's own base rate. */
const ORBIT_PERIOD = 2200;
/** How far a glow strays from its seat, as a share of the short edge. */
const ORBIT_RADIUS = 0.10;

/** The seat, size and orbit rate each glow holds for one section — seeded off
 *  the section number, so it is the same on every render of this track but
 *  different between sections. */
export function glowSeedsFor(section) {
  const r = mulberry32(51301 + (section | 0) * 733);
  return Array.from({ length: GLOWS }, (_, n) => ({
    cx: 0.18 + r() * 0.64,
    cy: 0.16 + r() * 0.6,
    radius: 0.20 + r() * 0.16,
    rate: 0.5 + r() * 0.7,
    phase: r() * Math.PI * 2,
    dir: n % 2 === 0 ? 1 : -1,
    mix: r(),
  }));
}

/** Where each glow sits at frame `i` — pure, so it is testable without a
 *  canvas and without a real Signals object. */
export function nebulaGlows(i, section) {
  const seeds = glowSeedsFor(section);
  const t = i / ORBIT_PERIOD;
  return seeds.map((g) => {
    const angle = g.phase + t * g.rate * Math.PI * 2 * g.dir;
    return {
      x: g.cx + Math.cos(angle) * ORBIT_RADIUS,
      y: g.cy + Math.sin(angle) * ORBIT_RADIUS * 0.6,
      radius: g.radius,
      mix: g.mix,
    };
  });
}

function sprite(colour) {
  const size = 512;
  const c = off(size, size);
  const x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, colour);
  g.addColorStop(0.55, colour.replace(")", ",0.35)").replace("rgb", "rgba"));
  g.addColorStop(1, colour.replace(")", ",0)").replace("rgb", "rgba"));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

export function init(a) {
  const ground = css(a.palette.ground.map((v) => Math.min(255, v * 2.2 + 12)));
  const ember = css(a.palette.ember);
  a.bgNebula = { ground: sprite(ground), ember: sprite(ember) };
}

export function draw(ctx, s, a) {
  const { W, H, bgNebula, palette } = a;
  const unit = Math.min(W, H);

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  const glows = nebulaGlows(s.i, s.section ?? 0);
  const bright = 0.30 + (s.rms ?? 0) * 0.35 + (s.arc ?? 0) * 0.20;

  ctx.globalCompositeOperation = "lighter";
  for (const glow of glows) {
    const img = glow.mix > 0.5 ? bgNebula.ember : bgNebula.ground;
    const r = unit * glow.radius;
    ctx.globalAlpha = bright * (0.5 + glow.mix * 0.5);
    ctx.drawImage(img, glow.x * W - r, glow.y * H - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
