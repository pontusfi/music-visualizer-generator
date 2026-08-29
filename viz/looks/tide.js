/**
 * TIDE — the cover above a horizon, reflected in moving water below it.
 *
 * Offered as a GL look, it would have cost what Refract costs; a liquid
 * reflection does not need per-pixel work, so this is Canvas2D instead. The
 * flipped cover is baked once at init, and each frame is ~110 `drawImage`
 * calls of a one-pixel-tall source strip — the same shape of cost as Shear's
 * 44 slices, an order of magnitude cheaper than a shader would have been.
 */
import { off } from "../assets.js";
import { drawCredit } from "../credit.js";
import { css, shiftHue } from "../palette.js";

export const id = "tide";
export const name = "Tide";

const ROWS = 110;
const HUE_SPREAD = 0.18;

function bandAvg(spectrum, from, to) {
  let sum = 0;
  let n = 0;
  for (let b = from; b < to; b += 1) {
    sum += spectrum[b] ?? 0;
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * The horizontal displacement of the reflection at depth `d` (0 = the
 * waterline, 1 = the bottom of the reflection), frame `i`.
 *
 * Pure — a sum of three sines whose phases advance with the frame index and
 * whose amplitudes come from the low, mid and high thirds of the spectrum,
 * plus a `kick` term. The testable half of the look, in the idiom of
 * Shear's `composition` and Refract's `uniformsFor`.
 */
export function waveOffset(d, i, s) {
  const spectrum = s?.spectrum ?? [];
  const bands = spectrum.length || 1;
  const third = Math.max(1, Math.floor(bands / 3));
  const low = bandAvg(spectrum, 0, third);
  const mid = bandAvg(spectrum, third, third * 2);
  const high = bandAvg(spectrum, third * 2, bands);
  const kick = s?.kick ?? 0;

  // deeper rows ripple harder, the way real chop grows with distance from a
  // calm waterline
  const reach = 1 + d * 2.2;
  const p1 = i * 0.050 + d * 9.0;
  const p2 = i * 0.083 - d * 5.0;
  const p3 = i * 0.021 + d * 14.0;

  const amp =
    (low * 0.55 + kick * 0.5) * Math.sin(p1) +
    mid * 0.35 * Math.sin(p2) +
    high * 0.18 * Math.sin(p3);

  return amp * reach;
}

/**
 * The horizon's y and how far the reflection reaches below it — pure, so the
 * geometry can be checked to stay inside the frame without a canvas.
 */
export function reflectionGeometry(y, h, H, arc, unit) {
  const horizonY = y + h - unit * 0.030 * (arc ?? 0);
  const reach = Math.max(0, Math.min(H - horizonY, h * 1.3));
  return { horizonY, reach };
}

export function init(a) {
  const { art, layout } = a;
  const flipped = off(layout.w, layout.h);
  const c = flipped.getContext("2d");
  c.save();
  c.translate(0, layout.h);
  c.scale(1, -1);
  c.drawImage(art, 0, 0, layout.w, layout.h);
  c.restore();
  a.tideFlipped = flipped;
}

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, grain, vignette } = a;
  const unit = layout.unit;

  a.bg.draw(ctx, s, a);

  const emberRgb = shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal);
  const ember = css(emberRgb);

  const seat = a.seat;
  const scale = seat.scale * (1 + s.kick * 0.015);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = layout.x - (w - layout.w) / 2 + seat.dx * W;
  const y = layout.y - (h - layout.h) / 2 + seat.dy * H;

  // the horizon sits at the cover's own bottom edge, rising a little as the
  // track's dynamic arc opens up
  const { horizonY, reach } = reflectionGeometry(y, h, H, s.arc, unit);

  // --- the reflection, below the horizon -----------------------------------
  if (reach > 1) {
    for (let k = 0; k < ROWS; k += 1) {
      const d = k / ROWS;
      const alpha = 0.40 * (1 - d) ** 1.4;
      if (alpha <= 0.004) continue;

      const srcH = Math.max(1, layout.h);
      const srcY = Math.min(srcH - 1, Math.floor((d * 0.92 * srcH) % srcH));
      const rowH = 1 + d * 3.4;
      const dy = horizonY + d * reach;
      const offset = waveOffset(d, s.i, s);

      ctx.globalAlpha = alpha;
      ctx.drawImage(a.tideFlipped, 0, srcY, layout.w, 1, x + offset, dy, w, rowH);

      // a specular glint on the occasional crest, brighter on the downbeat
      if (k % 9 === 0) {
        const glint = 0.16 + (s.downbeatPulse ?? 0) * 0.5;
        ctx.globalAlpha = alpha * glint;
        ctx.fillStyle = ember;
        ctx.fillRect(x + offset + w * 0.15, dy, w * 0.28, Math.max(1, rowH * 0.5));
      }
    }
    ctx.globalAlpha = 1;

    // a soft fade from the horizon into whatever the background is doing
    const fade = ctx.createLinearGradient(0, horizonY, 0, horizonY + reach);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, `${palette.groundCss.replace("rgb", "rgba").replace(")", ",0.55)")}`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizonY, W, reach);
  }

  // --- the cover itself, above the horizon ---------------------------------
  ctx.drawImage(art, x, y, w, h);

  // a hairline waterline, flaring on the downbeat
  ctx.globalAlpha = 0.35 + (s.downbeatPulse ?? 0) * 0.45;
  ctx.fillStyle = ember;
  ctx.fillRect(x, horizonY, w, Math.max(1, unit * 0.0018));
  ctx.globalAlpha = 1;

  // --- credit line ------------------------------------------------------------
  // pulled up when the services row is also drawn, so the two never collide
  drawCredit(ctx, s, a, { x: W / 2, y: H * (a.services.length ? 0.82 : 0.955), align: "center" });

  // --- grain and vignette ----------------------------------------------------
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.75 + (1 - s.arc) * 0.25;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
