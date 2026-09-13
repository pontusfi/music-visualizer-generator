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
 * The reflection's ripple phase is `sin(band + i * rate)`, sheared sideways by
 * the beat so the water under the record is running one way; a sweep of light
 * off that water crosses the face once a bar, and the scrim comes off
 * completely on a downbeat rather than merely thinning. Nothing here carries
 * between frames.
 */

import { CREDIT, CREDIT_FIT, creditAlpha, fitSize } from "../credit.js";
import { creditFloor } from "../services.js";
import { HORIZON } from "../backgrounds/bloodtide.js";
import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

export const id = "wake";
export const name = "Wake";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.08;
/** Slices in the reflection. */
export const SLICES = 40;
/** Frames the tear takes to close. */
const TEAR_LIFE = 9;

/**
 * How far the record is knocked back toward silhouette.
 *
 * The sea's light does not reach the front of it, so the plate is a cut-out
 * between hits and only comes forward on the loud parts. A downbeat now takes
 * the scrim off entirely rather than merely thinning it: for a few frames the
 * artwork is a photograph, and it falls back before the next bar.
 */
export function plateDark(s) {
  return Math.max(0, 0.66 - s.rms * 0.45 - s.arc * 0.12 - s.kick * 0.10
    - s.downbeatPulse * 0.30);
}

/**
 * Where the moonlight sweep has reached across the plate, once a bar.
 *
 * Deliberately over-travelled at both ends: the highlight has to be clear of
 * the plate at barPhase 0 and 1, or the wrap parks a stationary stripe on the
 * record and it reads as paint rather than as light.
 */
export function sweepX(barPhase, w, h) {
  return barPhase * (w + h) * 1.6 - h * 0.8;
}

/**
 * One slice of the reflection: how far it has slid, how far it has stretched,
 * and how much of it survives at that depth.
 *
 * `dx` is bounded well inside a tenth of the short edge, which is what keeps
 * the reflection in the record's own column however hard the track is hitting
 * — an inverted cover that shears out from under the plate stops reading as a
 * reflection at all.
 */
export function sliceAt(n, slices, i, unit, swell, tear, shear) {
  const t = n / slices;
  return {
    t,
    dx: Math.sin(t * 11 - i * 0.06) * unit * 0.010 * swell * (0.25 + t * 1.8)
      + tear * Math.sin(t * 31) * unit * 0.014
      + shear * t * unit * 0.02,
    stretch: 1 + t * 0.5,
    // the old ramp reached zero at t = 0.94, so the deepest slices were drawn
    // and then multiplied out of existence
    alpha: Math.max(0, 0.38 - t * 0.34),
  };
}

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
  // the loudness, so quiet passages are close to a cut-out and a downbeat
  // takes it off entirely
  ctx.fillStyle = `rgba(6,2,4,${plateDark(s)})`;
  ctx.fillRect(x, y, w, h);

  ctx.globalCompositeOperation = "lighter";

  // the light off the water crossing the face once a bar
  const sweep = sweepX(s.barPhase, w, h);
  const band = Math.max(2, w * 0.16);
  const gloss = ctx.createLinearGradient(x + sweep - band, y, x + sweep + band, y + h);
  gloss.addColorStop(0, "rgba(0,0,0,0)");
  gloss.addColorStop(0.5, `rgba(255,190,170,${0.05 + s.rms * 0.10 + s.bright * 0.06})`);
  gloss.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, h);

  // rim light: the moon behind the plate spilling around its edges. The left
  // edge carries more of it than the right — the light in this composition
  // comes from that side whatever background is under it.
  const rim = Math.max(1, unit * 0.004 * (1 + s.downbeatPulse * 2.2));
  ctx.fillStyle = ember;
  ctx.globalAlpha = 0.45 + s.downbeatPulse * 0.45;
  ctx.fillRect(x - rim, y - rim, w + rim * 2, rim);
  ctx.fillRect(x + w, y - rim, rim, h + rim);
  ctx.globalAlpha = Math.min(1, 0.6 + s.downbeatPulse * 0.4 + s.rms * 0.2);
  ctx.fillRect(x - rim * 1.6, y - rim, rim * 1.6, h + rim);
  // and a soft spill off that edge, so the record is lit rather than outlined
  const spill = ctx.createLinearGradient(x - rim, 0, x + w * 0.42, 0);
  spill.addColorStop(0, `rgba(255,120,96,${0.10 + s.rms * 0.14 + s.downbeatPulse * 0.12})`);
  spill.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spill;
  ctx.globalAlpha = 1;
  ctx.fillRect(x, y, w * 0.42, h);

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
  const swell = 1 + s.kick * 1.6 + s.wall * 0.7;
  const tear = decay(s.sinceOnset, TEAR_LIFE) * s.hit;
  // the water is running one way under the record: the deeper slices lag the
  // shallow ones sideways instead of only rippling in place
  const shear = (s.beatPhase - 0.5) * s.kick;
  for (let n = 0; n < SLICES; n += 1) {
    const { dx, stretch, alpha } = sliceAt(n, SLICES, s.i, unit, swell, tear, shear);
    ctx.globalAlpha = alpha * (0.6 + s.rms * 0.6);
    ctx.drawImage(
      art,
      0, art.height - (n + 1) * srcH, art.width, srcH,
      x + dx, horizon + n * sliceH * stretch, w, sliceH * stretch + 1,
    );
  }
  ctx.globalAlpha = 1;

  // caustics: the moon's light bent by the same water the reflection is in,
  // so the surface reads as having a thickness
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = ember;
  for (let n = 0; n < 14; n += 1) {
    const t = n / 14;
    const cy = horizon + h * (0.06 + t * 0.8);
    const cw = w * (0.10 + Math.abs(Math.sin(t * 9 + s.i * 0.04)) * 0.34);
    const cx = x + w * 0.5 + Math.sin(t * 17 - s.i * 0.055) * w * 0.44;
    ctx.globalAlpha = (0.05 + s.rms * 0.11 + s.crack * 0.07) * (1 - t) ;
    ctx.fillRect(cx - cw * 0.5, cy, cw, Math.max(1, unit * 0.0018));
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // the reflection is under water, not on it — and the water gets heavier as
  // the track does
  const murk = 0.24 + s.kick * 0.10 + (1 - s.rms) * 0.08;
  const wash = ctx.createLinearGradient(0, horizon, 0, horizon + h * 0.9);
  wash.addColorStop(0, `rgba(90,10,14,${murk})`);
  wash.addColorStop(1, `rgba(8,2,4,${Math.min(0.95, 0.78 + s.arc * 0.14)})`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, horizon, W, h * 0.9);

  // --- type: standing in the sky, above the waterline ----------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title * 0.98);
  const artistSize = Math.round(unit * CREDIT.artist * 0.84);
  // Centred on the frame, not on the plate. Wake seats the record right of
  // centre so the moon owns the left of the picture, and hanging the type off
  // the plate carried that offset into the credit — barely noticeable at 16:9,
  // and at 9:16 it pushed a long title clean off the right edge.
  const cx = W / 2;
  const maxTextW = W * CREDIT_FIT;
  // held above the badge row when any service is picked: the row is drawn
  // after the look and owns the bottom of the frame
  const titleY = Math.min(H - unit * 0.070, creditFloor(a));

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.letterSpacing = `${Math.round(unit * 0.030)}px`;
    ctx.font = `${fitSize(ctx, a.artist.toUpperCase(), FONT, artistSize, maxTextW)}px ${FONT}`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist * 0.9;
    ctx.fillText(a.artist.toUpperCase(), cx, titleY - titleSize * 0.95);
  }

  if (a.title) {
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle * 2)}px`;
    ctx.font = `${fitSize(ctx, a.title.toUpperCase(), FONT, titleSize, maxTextW)}px ${FONT}`;
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
