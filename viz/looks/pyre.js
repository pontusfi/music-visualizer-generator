/**
 * PYRE — the record burning, over the course of the track.
 *
 * Flame tongues climb the front of the artwork, a rim of char eats inward from
 * its edges as the song runs (`progress`, so a two-minute single and a
 * twelve-minute epic both finish just as burnt), and every kick throws a flare
 * up the face of it. The heat haze is a per-band horizontal offset, the same
 * trick Furnace uses, but shallower — here the fire in front is doing the work.
 *
 * All of it is expressions in the frame index. Nothing accumulates; the char
 * is a function of progress, not something that has been painted on.
 */

import { off } from "../assets.js";
import { CREDIT, CREDIT_FIT, creditAlpha, fitSize } from "../credit.js";
import { css, shiftHue } from "../palette.js";
import { creditFloor } from "../services.js";

export const id = "pyre";
export const name = "Pyre";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.18;
/** Tongues licking up the face of the cover. */
const LICKS = 11;
/**
 * How much smaller the flame layer is drawn than the frame.
 *
 * The tongues are the whole cost of this look: eleven large blurred fills at
 * 1080p cost about 150 ms a frame drawn at full size under software raster,
 * which is ten times what the rest of the draw costs put together. A blur is a
 * low-pass filter, so everything a third-size buffer throws away is detail the
 * blur was about to destroy anyway — but the fill area drops ninefold, and the
 * blur radius shrinks with it.
 */
const FLAME_SCALE = 3;

const mix = (a, b, t) => a.map((v, n) => v + (b[n] - v) * t);

export function init(a) {
  const r = a.rng(4177);
  const { w, h } = a.layout;

  // The char: a baked inward burn, drawn at an alpha that rises through the
  // track. Baked because it is four gradients and never changes shape.
  const char = off(w, h);
  const c = char.getContext("2d");
  const edges = [
    [0, 0, 0, h * 0.42, 0],
    [0, h, 0, h * 0.55, 0],
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(6,4,4,0.96)");
    g.addColorStop(0.45, "rgba(12,7,6,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  for (const [x0, x1] of [[0, w * 0.34], [w, w * 0.66]]) {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "rgba(6,4,4,0.9)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  a.pyreChar = char;

  a.pyreLicks = Array.from({ length: LICKS }, () => ({
    x: r(),
    w: 0.06 + r() * 0.16,
    h: 0.30 + r() * 0.55,
    rate: 0.035 + r() * 0.06,
    phase: r() * Math.PI * 2,
  }));

  const e = a.palette.ember;
  a.pyreHot = `rgb(${mix(e, [255, 240, 190], 0.75).map(Math.round).join(",")})`;

  // allocated once, repainted in place: an eight-minute render must not leave
  // 28,800 dead canvases behind it
  a.pyreFlame = off(Math.ceil(a.W / FLAME_SCALE), Math.ceil(a.H / FLAME_SCALE));
  a.pyreFlameCtx = a.pyreFlame.getContext("2d");
}

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, burnMasks, grain, vignette, tint } = a;
  const { unit } = layout;

  const emberRgb = shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal);
  const ember = css(emberRgb);
  const bone = palette.boneCss ?? css(palette.bone);

  a.bg.draw(ctx, s, a);

  // --- composition --------------------------------------------------------
  const seat = a.seat;
  const scale = seat.scale * 1.02 * (1 + s.kick * 0.014);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = (W - w) / 2 + seat.dx * W * 0.5;
  const y = layout.y - (h - layout.h) / 2 + seat.dy * H * 0.5 - unit * 0.03;

  // --- the cover, shimmering ----------------------------------------------
  const BANDS = 26;
  const amp = unit * (0.001 + s.wall * 0.004 + s.kick * 0.004);
  const bandH = h / BANDS;
  const srcH = art.height / BANDS;
  for (let n = 0; n < BANDS; n += 1) {
    const t = n / BANDS;
    const dx = Math.sin(t * 6.1 + s.i * 0.05) * amp * (1.4 - t);
    ctx.drawImage(art, 0, n * srcH, art.width, srcH, x + dx, y + n * bandH, w, bandH + 1);
  }

  // char, eating in as the track runs
  ctx.globalAlpha = 0.25 + a.progress * 0.55;
  ctx.drawImage(a.pyreChar, x, y, w, h);
  ctx.globalAlpha = 1;

  // --- flare on the kick ---------------------------------------------------
  if (s.kick > 0.02) {
    const fl = ctx.createLinearGradient(0, y + h, 0, y);
    fl.addColorStop(0, a.pyreHot);
    fl.addColorStop(0.5, ember);
    fl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = s.kick * 0.35;
    ctx.fillStyle = fl;
    ctx.fillRect(x, y, w, h);
    const level = Math.min(burnMasks.length - 1, Math.floor(s.kick * (burnMasks.length - 0.01)));
    ctx.globalAlpha = Math.min(1, s.kick * 0.8);
    ctx.drawImage(tint.burn(burnMasks[level], a.pyreHot), x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- rim of fire ---------------------------------------------------------
  ctx.globalCompositeOperation = "lighter";
  const rim = 0.35 + s.rms * 0.4;
  ctx.strokeStyle = ember;
  ctx.lineWidth = Math.max(1, unit * 0.0035 * (1 + s.kick));
  ctx.globalAlpha = rim;
  ctx.strokeRect(x, y, w, h);

  // --- tongues climbing the face -------------------------------------------
  // Drawn into the third-size flame buffer in frame coordinates — the
  // transform does the scaling, so the geometry below is written as if it
  // were going straight onto the frame — then composited back up. `lighter`
  // is associative, so accumulating the tongues in the buffer and adding the
  // buffer once is the same picture as adding each tongue to the frame.
  const f = a.pyreFlameCtx;
  const fs = a.pyreFlame.width / W;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.filter = "none";
  f.globalAlpha = 1;
  f.globalCompositeOperation = "copy";
  f.fillStyle = "rgba(0,0,0,0)";
  f.fillRect(0, 0, a.pyreFlame.width, a.pyreFlame.height);
  f.globalCompositeOperation = "lighter";
  f.setTransform(fs, 0, 0, fs, 0, 0);
  // a canvas filter is specified in device pixels and ignores the transform,
  // so the radius has to be scaled down by hand to blur by the same amount
  f.filter = `blur(${Math.max(1, unit * 0.005 * fs)}px)`;

  const base = y + h + unit * 0.006;
  for (const L of a.pyreLicks) {
    const lick = 0.55 + 0.45 * Math.sin(s.i * L.rate + L.phase);
    const th = h * L.h * lick * (0.55 + s.kick * 0.5 + s.wall * 0.3);
    const tw = w * L.w;
    const cx = x + w * L.x + Math.sin(s.i * L.rate * 0.7 + L.phase) * w * 0.02;
    const g = f.createLinearGradient(0, base, 0, base - th);
    g.addColorStop(0, `rgba(255,255,255,${0.20 * lick})`);
    g.addColorStop(0.22, a.pyreHot);
    g.addColorStop(0.6, ember);
    g.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = g;
    f.globalAlpha = 0.28 + lick * 0.34;
    f.beginPath();
    f.moveTo(cx - tw / 2, base);
    f.quadraticCurveTo(cx - tw * 0.52, base - th * 0.48, cx - tw * 0.10, base - th * 0.74);
    f.quadraticCurveTo(cx + tw * 0.04, base - th * 0.93, cx + Math.sin(s.i * L.rate * 1.6 + L.phase) * tw * 0.14, base - th);
    f.quadraticCurveTo(cx + tw * 0.36, base - th * 0.6, cx + tw * 0.5, base - th * 0.26);
    f.quadraticCurveTo(cx + tw * 0.56, base - th * 0.1, cx + tw / 2, base);
    f.closePath();
    f.fill();
  }
  f.filter = "none";
  f.setTransform(1, 0, 0, 1, 0, 0);

  // still under `lighter` from the rim above
  ctx.globalAlpha = 1;
  ctx.drawImage(a.pyreFlame, 0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // --- type ----------------------------------------------------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title * 1.1);
  const artistSize = Math.round(unit * CREDIT.artist);
  const left = Math.max(unit * 0.06, x);
  // left-aligned, so what it has to fit into is whatever the frame has left of
  // that anchor rather than the full width
  const maxTextW = Math.min(W * CREDIT_FIT, W - left - unit * 0.04);
  // held above the badge row when any service is picked: the row is drawn
  // after the look and owns the bottom of the frame
  const titleY = Math.min(H - unit * 0.070, creditFloor(a));
  const wob = Math.sin(s.i * 0.09) * unit * 0.0016 * (0.4 + s.wall);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.letterSpacing = `${Math.round(unit * 0.018)}px`;
    ctx.font = `${fitSize(ctx, a.artist.toUpperCase(), FONT, artistSize, maxTextW)}px ${FONT}`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist;
    ctx.fillText(a.artist.toUpperCase(), left, titleY - titleSize * 0.95);
  }

  if (a.title) {
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle)}px`;
    ctx.font = `${fitSize(ctx, a.title.toUpperCase(), FONT, titleSize, maxTextW)}px ${FONT}`;
    // scorched: a black cut under the face, offset by the same wobble as the
    // heat, so the type sits in the air the fire is heating
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.globalAlpha = alpha.title;
    ctx.fillText(a.title.toUpperCase(), left + wob + unit * 0.003, titleY + unit * 0.003);
    ctx.fillStyle = bone;
    ctx.fillText(a.title.toUpperCase(), left + wob, titleY);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.18 + s.kick * 0.3;
    ctx.fillStyle = ember;
    ctx.fillText(a.title.toUpperCase(), left + wob, titleY);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.055 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.6 + (1 - s.arc) * 0.25;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
