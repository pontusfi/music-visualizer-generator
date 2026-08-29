/**
 * DUST — three layers of drifting specks.
 *
 * A cheap parallax: three tiles of seeded specks, each drifting sideways at
 * its own rate, wrapped the way `buildGrain`'s sheets tile a frame — except
 * here the wrap is horizontal motion rather than a static repeat, so each
 * layer needs two `drawImage` calls a frame to cover the seam.
 */
import { off } from "../assets.js";
import { css } from "../palette.js";
import { mulberry32 } from "../rng.js";

export const id = "dust";
export const name = "Dust";

const LAYERS = [
  { count: 46, size: 1.4, rate: 0.00016, alpha: 0.20 },
  { count: 28, size: 2.4, rate: 0.00031, alpha: 0.28 },
  { count: 14, size: 3.8, rate: 0.00052, alpha: 0.36 },
];

/** How far layer `n` has drifted at frame `i`, wrapped into one tile width —
 *  pure, so the wrap math is testable without a canvas. */
export function dustOffset(i, rate, tileW) {
  const w = Math.max(1, tileW);
  const raw = i * rate * w;
  return ((raw % w) + w) % w;
}

function speckleTile(w, h, count, size, seed, colour) {
  const c = off(w, h);
  const x = c.getContext("2d");
  const r = mulberry32(seed);
  x.fillStyle = colour;
  for (let n = 0; n < count; n += 1) {
    const px = r() * w;
    const py = r() * h;
    const rad = size * (0.6 + r() * 0.8);
    x.globalAlpha = 0.4 + r() * 0.6;
    x.beginPath();
    x.arc(px, py, rad, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  return c;
}

export function init(a) {
  const { W, H, palette } = a;
  const colour = css(palette.bone);
  a.bgDust = LAYERS.map((layer, n) =>
    speckleTile(W, H, layer.count, layer.size, 40210 + n * 977, colour),
  );
}

export function draw(ctx, s, a) {
  const { W, H, palette, bgDust } = a;

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = "lighter";
  LAYERS.forEach((layer, n) => {
    const tile = bgDust[n];
    const offset = dustOffset(s.i, layer.rate, W);
    ctx.globalAlpha = layer.alpha;
    ctx.drawImage(tile, -offset, 0);
    ctx.drawImage(tile, W - offset, 0);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
