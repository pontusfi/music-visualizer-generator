/**
 * WAKE — the record held over a red sea, and its reflection in it.
 *
 * The companion to the Bloodtide background: the cover sits on the horizon
 * line so the moon rises behind it, its edges bleed into the corona, and the
 * water below carries an inverted, rippling copy of it that breaks apart on
 * every kick. The plate is knocked back toward silhouette between hits and
 * only comes fully forward on the loud parts, so the frame reads as one
 * photograph rather than as artwork pasted on a painting.
 *
 * The reflection's ripple phase is `sin(band + i * rate)` and the eclipse
 * halo comes from `downbeatPulse`; nothing here carries between frames.
 */

import { CREDIT, creditAlpha } from "../credit.js";
import { creditFloor } from "../services.js";
import { HORIZON } from "../backgrounds/bloodtide.js";
import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

export const id = "wake";
export const name = "Wake";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.08;
/** Slices in the reflection. */
const SLICES = 40;
/** Frames the tear takes to close. */
const TEAR_LIFE = 9;

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, burnMasks, grain, vignette, tint } = a;
  const { unit } = layout;

  const ember = css(shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal));
  const bone = palette.boneCss ?? css(palette.bone);

  a.bg.draw(ctx, s, a);

  // the background owns the horizon; if it is paired with something else, fall
  // back to the same proportion so the composition still stands
  const horizon = H * HORIZON;

  // --- composition: the plate meets the water ------------------------------
  const seat = a.seat;
  const scale = seat.scale * 0.74 * (1 + a.progress * 0.02) * (1 + s.kick * 0.014);
  const w = layout.w * scale;
  const h = layout.h * scale;
  // right of centre: the moon owns the left of the frame
  const x = W * 0.60 - w / 2 + seat.dx * W * 0.25;
  const y = horizon - h + seat.dy * H * 0.18;

  // --- the plate, mostly silhouette ----------------------------------------
  ctx.drawImage(art, x, y, w, h);
  // the sea's light does not reach the front of it: a scrim that lifts with
  // the loudness, so quiet passages are close to a cut-out
  const dark = Math.max(0, 0.62 - s.rms * 0.45 - s.arc * 0.12 - s.kick * 0.10);
  ctx.fillStyle = `rgba(6,2,4,${dark})`;
  ctx.fillRect(x, y, w, h);

  // rim light: the moon behind the plate spilling around its edges
  ctx.globalCompositeOperation = "lighter";
  const rim = Math.max(1, unit * 0.004 * (1 + s.downbeatPulse * 2.2));
  ctx.fillStyle = ember;
  ctx.globalAlpha = 0.45 + s.downbeatPulse * 0.45;
  ctx.fillRect(x - rim, y - rim, w + rim * 2, rim);
  ctx.fillRect(x - rim, y - rim, rim, h + rim);
  ctx.fillRect(x + w, y - rim, rim, h + rim);

  if (s.kick > 0.03) {
    const level = Math.min(burnMasks.length - 1, Math.floor(s.kick * (burnMasks.length - 0.01)));
    ctx.globalAlpha = Math.min(1, s.kick * 0.6);
    ctx.drawImage(tint.burn(burnMasks[level], ember), x, y, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- the reflection -------------------------------------------------------
  const sliceH = h / SLICES;
  const srcH = art.height / SLICES;
  const swell = 1 + s.kick * 1.4 + s.wall * 0.6;
  const tear = decay(s.sinceOnset, TEAR_LIFE) * s.hit;
  for (let n = 0; n < SLICES; n += 1) {
    const t = n / SLICES;
    const ripple = Math.sin(t * 11 - s.i * 0.06) * unit * 0.010 * swell * (0.25 + t * 1.8)
      + tear * Math.sin(t * 31) * unit * 0.014;
    const stretch = 1 + t * 0.5;
    ctx.globalAlpha = Math.max(0, 0.34 - t * 0.36) * (0.6 + s.rms * 0.6);
    ctx.drawImage(
      art,
      0, art.height - (n + 1) * srcH, art.width, srcH,
      x + ripple, horizon + n * sliceH * stretch, w, sliceH * stretch + 1,
    );
  }
  ctx.globalAlpha = 1;

  // the reflection is under water, not on it
  const wash = ctx.createLinearGradient(0, horizon, 0, horizon + h * 0.9);
  wash.addColorStop(0, "rgba(90,10,14,0.28)");
  wash.addColorStop(1, "rgba(8,2,4,0.85)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, horizon, W, h * 0.9);

  // --- type: standing in the sky, above the waterline ----------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title * 0.98);
  const artistSize = Math.round(unit * CREDIT.artist * 0.84);
  const cx = x + w / 2;
  // held above the badge row when any service is picked: the row is drawn
  // after the look and owns the bottom of the frame
  const titleY = Math.min(H - unit * 0.070, creditFloor(a));

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.font = `${artistSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * 0.030)}px`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist * 0.9;
    ctx.fillText(a.artist.toUpperCase(), cx, titleY - titleSize * 0.95);
  }

  if (a.title) {
    ctx.font = `${titleSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle * 2)}px`;
    // lit from below by the water: an ember pass under a bone face
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35 + s.rms * 0.35;
    ctx.fillStyle = ember;
    ctx.fillText(a.title.toUpperCase(), cx, titleY + Math.max(1, unit * 0.003));
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha.title;
    ctx.fillStyle = bone;
    ctx.fillText(a.title.toUpperCase(), cx, titleY);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.85 + (1 - s.arc) * 0.15;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
