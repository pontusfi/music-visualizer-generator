/**
 * BURN — the original signature, taught the song.
 *
 * Ten luminance thresholds of the cover ignite from the highlights inward on
 * every kick. That is still the one thing the piece is remembered by, so
 * nothing else is allowed to shout. What changed is that the restraint is now
 * *informed*: the ember drifts with the harmony, the composition shifts between
 * sections, and the transient split fires on real onsets instead of on a
 * threshold crossing.
 */

import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

/** How far harmony may drag the ember round the wheel, in turns. */
const HUE_SPREAD = 0.16;
/** Frames a channel split takes to collapse back. */
const SPLIT_LIFE = 9;

export const id = "burn";
export const name = "Burn";

export function draw(ctx, sig, a) {
  const { W, H, art, layout, palette, burnMasks, channels, grain, vignette, tint } = a;
  const s = sig;

  // --- colour -------------------------------------------------------------
  // tonal is the confidence: an atonal wall leaves the artwork's own ember
  // alone, a clear key pulls it round the wheel. Centring on 0.5 means the
  // ember is the middle of the range, not one end of it.
  const emberRgb = shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal);
  const ember = css(emberRgb);

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  // --- composition --------------------------------------------------------
  // Each section gets its own resting size and drift, so a chorus does not sit
  // exactly where the verse sat. The offsets come from the section number, so
  // they are the same on every render of the same track.
  const seat = a.seat;
  // a very slow push across the whole track: eight minutes of almost nothing,
  // which is what stops a long video feeling like a still
  const push = 1 + a.progress * 0.03;
  const breathe = 1 + s.kick * 0.018 + s.wall * 0.006 + s.barPhase * 0.004;
  const scale = seat.scale * push * breathe;

  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = layout.x - (w - layout.w) / 2 + seat.dx * W;
  const y = layout.y - (h - layout.h) / 2 + seat.dy * H;

  // --- the cover ----------------------------------------------------------
  // Only real transients displace the image, and each one now runs out on its
  // own timeline. Thresholding a continuous envelope meant that at 240 BPM the
  // split never reset and the whole thing read as a badly converged CRT.
  const split = decay(s.sinceOnset, SPLIT_LIFE) * (0.4 + s.hit * 0.6) * W * 0.007;
  if (split > 0.5) {
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(channels.r, x - split, y, w, h);
    ctx.drawImage(channels.g, x, y, w, h);
    ctx.drawImage(channels.b, x + split, y, w, h);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.drawImage(art, x, y, w, h);
  }

  // --- the burn -----------------------------------------------------------
  if (s.kick > 0.03) {
    const level = Math.min(burnMasks.length - 1, Math.floor(s.kick * (burnMasks.length - 0.01)));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, s.kick * 1.05);
    ctx.drawImage(tint.burn(burnMasks[level], ember), x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- exposure -----------------------------------------------------------
  // rms was computed from the first commit and never read. It belongs here:
  // loud passages sit brighter, quiet ones sink, over the whole track.
  const scrim = 0.20 - s.rms * 0.14 - s.arc * 0.06;
  if (scrim > 0.005) {
    ctx.fillStyle = `rgba(0,0,0,${scrim})`;
    ctx.fillRect(0, 0, W, H);
  }

  // --- spectrum, as the shadow the cover casts ----------------------------
  const strip = tint.bar(ember);
  const base = y + h;
  const gap = W * 0.0022;
  const bands = s.spectrum.length || 1;
  const bw = (w - gap * (bands - 1)) / bands;
  const maxH = Math.max(0, H - base) * 0.92;
  for (let b = 0; b < bands; b += 1) {
    const v = Math.pow(s.spectrum[b], 1.7); // dB-flat looks inert
    if (v <= 0.015) continue;
    ctx.globalAlpha = 0.14 + v * 0.5;
    ctx.drawImage(strip, 0, 0, 1, 256, x + b * (bw + gap), base, bw, v * maxH);
  }
  ctx.globalAlpha = 1;

  // a tick on the baseline, on the beat — the only thing locked to the grid,
  // and small enough that you feel it before you notice it
  if (maxH > 0) {
    const tick = s.downbeatPulse * 0.7 + s.beatPulse * 0.3;
    ctx.globalAlpha = 0.28 + tick * 0.5;
    ctx.fillStyle = ember;
    ctx.fillRect(x, base, w, Math.max(1, H * 0.0022 * (1 + tick * 2.2)));
    ctx.globalAlpha = 1;
  }

  // --- credit line --------------------------------------------------------
  if (a.artist || a.title) {
    ctx.font = `${Math.round(H * 0.0135)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.fillStyle = palette.boneCss;
    ctx.letterSpacing = `${Math.round(H * 0.006)}px`;
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.30 + s.crack * 0.25;
    ctx.fillText(a.artist.toUpperCase(), x, y - H * 0.028);
    ctx.globalAlpha = 0.62 + s.crack * 0.30;
    ctx.fillText(a.title.toUpperCase(), x, y - H * 0.010);
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
  }

  // --- grain and vignette -------------------------------------------------
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.055 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // the vignette closes in as the track quietens, so a breakdown feels smaller
  ctx.globalAlpha = 0.75 + (1 - s.arc) * 0.25;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
