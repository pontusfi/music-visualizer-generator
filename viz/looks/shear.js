/**
 * SHEAR — the cover, torn along the spectrum.
 *
 * The artwork is sliced into horizontal bands and each one is displaced by its
 * own frequency band, so the image literally comes apart along the shape of the
 * mix: the low end shoves the bottom of the picture, the cymbals rattle the
 * top. Onsets tear it wider and it walks itself back together over the frames
 * that follow.
 *
 * Cheap despite appearances — one drawImage of a sub-rectangle per slice, and
 * nothing is allocated per frame.
 */

import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

/** Horizontal slices. More reads as scanlines, fewer as broken glass. */
const SLICES = 44;
/** Frames a tear takes to close. */
const TEAR_LIFE = 16;
const HUE_SPREAD = 0.24;

export const id = "shear";
export const name = "Shear";

/** Margin the credit line and the rule keep off the frame edge. */
const MARGIN = 0.055;

/**
 * Where the cover and the furniture under it sit.
 *
 * This look wants the artwork bigger than the shared layout gives it, which is
 * fine on a 16:9 frame where the cover is nowhere near the edges. On a phone
 * frame the layout is already width-bound, so blowing it up again takes the
 * picture off both sides and the credit line with it. So the scale is capped at
 * the frame width, and the furniture is inset rather than hung off a cover edge
 * that may now be at zero. Neither clamp can bite at 16:9.
 */
export function composition(layout, W, wanted, dx) {
  const scale = Math.min(wanted, W / layout.w);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = (W - w) / 2 + dx;
  const margin = W * MARGIN;
  const left = Math.max(x, margin);
  const right = Math.min(x + w, W - margin);
  return { x, w, h, textX: left, ruleX: left, ruleW: Math.max(0, right - left) };
}

export function init(a) {
  // a fixed per-slice direction and weight, seeded so the tear is the same
  // shape on every render of this track
  const r = a.rng(4703);
  a.shearBias = Array.from({ length: SLICES }, () => (r() - 0.5) * 2);
}

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, tint, burnMasks, channels, grain, vignette } = a;
  // sizes off the short edge; the cover's own placement stays proportional
  const { unit } = layout;

  const emberRgb = shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal);
  const ember = css(emberRgb);

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  // this look wants the cover big: it is the only subject on screen
  const box = composition(
    layout,
    W,
    a.seat.scale * (1 + s.kick * 0.02) * 1.18,
    a.seat.dx * W * 0.6,
  );
  const { w, h, x } = box;
  const y = H * 0.16 + a.seat.dy * H;

  const tear = decay(s.sinceOnset, TEAR_LIFE);
  // a tear that has just landed is violent and then settles; drive keeps a
  // blast section permanently unstable while a clean passage sits still
  const amp = W * (0.006 + tear * tear * 0.055 * (0.4 + s.hit) + s.drive * 0.004);

  const bands = s.spectrum.length || 1;
  const sliceH = h / SLICES;
  const srcH = art.height / SLICES;

  for (let n = 0; n < SLICES; n += 1) {
    // slice 0 is the top of the picture and should be driven by the top of the
    // spectrum, so the cymbals rattle the sky and the kick shoves the ground
    const band = Math.min(bands - 1, Math.floor(((SLICES - 1 - n) / SLICES) * bands));
    const v = s.spectrum[band] ?? 0;
    const dx = a.shearBias[n] * amp * (0.25 + v);

    ctx.drawImage(
      art,
      0, n * srcH, art.width, srcH,
      x + dx, y + n * sliceH, w, sliceH + 1, // +1 hides seams from rounding
    );
  }

  // --- the burn, over the reassembled whole -------------------------------
  if (s.kick > 0.03) {
    const level = Math.min(burnMasks.length - 1, Math.floor(s.kick * (burnMasks.length - 0.01)));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, s.kick * 0.9);
    ctx.drawImage(tint.burn(burnMasks[level], ember), x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- channel separation on the hardest tears ----------------------------
  const split = tear * Math.max(0, s.hit - 0.35) * W * 0.010;
  if (split > 0.5) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(channels.r, x - split, y, w, h);
    ctx.drawImage(channels.b, x + split, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.22 - s.rms * 0.14 - s.arc * 0.06)})`;
  ctx.fillRect(0, 0, W, H);

  // --- a rule that snaps to the bar --------------------------------------
  // one horizontal line whose length is the bar position: the only thing in
  // this look that is calm, which is what makes the rest read as violent
  const ruleY = y + h + unit * 0.045;
  ctx.fillStyle = ember;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(box.ruleX, ruleY, box.ruleW, Math.max(1, unit * 0.0014));
  ctx.globalAlpha = 0.85;
  ctx.fillRect(box.ruleX, ruleY, box.ruleW * s.barPhase, Math.max(1, unit * 0.0014 * (1 + s.downbeatPulse * 3)));
  ctx.globalAlpha = 1;

  // --- credit line --------------------------------------------------------
  if (a.artist || a.title) {
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${Math.round(unit * 0.006)}px`;
    ctx.font = `${Math.round(unit * 0.0135)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.fillStyle = palette.boneCss;
    ctx.globalAlpha = 0.34 + s.crack * 0.26;
    ctx.fillText(a.artist.toUpperCase(), box.textX, y - unit * 0.028);
    ctx.globalAlpha = 0.66 + s.crack * 0.28;
    ctx.fillText(a.title.toUpperCase(), box.textX, y - unit * 0.010);
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
  }

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.06 + s.hit * 0.04;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.8 + (1 - s.arc) * 0.2;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
