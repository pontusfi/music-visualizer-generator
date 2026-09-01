/**
 * MIASMA — the cover, being taken by the smoke.
 *
 * The artwork is composited through a moving smoke mask, so pieces of it are
 * eaten away and handed back as the bank drifts across; how much survives is
 * the loudness, so a breakdown nearly erases the record and the chorus brings
 * it back whole. One rim light along the top edge keeps it legible when the
 * smoke is thickest.
 *
 * The mask work happens on a scratch canvas allocated once at init. Compositing
 * with `destination-out` directly on the frame would eat the background too.
 */

import { off } from "../assets.js";
import { blobSheet, scroll } from "../fields.js";
import { CREDIT, CREDIT_FIT, creditAlpha, fitSize } from "../credit.js";
import { css, shiftHue } from "../palette.js";
import { creditFloor } from "../services.js";
import { decay } from "../signals.js";

export const id = "miasma";
export const name = "Miasma";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.16;
/** Frames a gust takes to run out. */
const GUST_LIFE = 34;

export function init(a) {
  const { w, h } = a.layout;
  const r = a.rng(8663);
  a.miasmaScratch = off(w, h);
  a.miasmaCtx = a.miasmaScratch.getContext("2d");
  // the eraser: high-contrast blobs, drawn as pure white so only their alpha
  // matters when they are used as a destination-out stencil
  a.miasmaMask = blobSheet(Math.round(w * 0.9), Math.round(h * 0.9), r, {
    count: 34,
    radius: [0.20, 0.55],
    colours: ["rgba(255,255,255,1)"],
    alpha: [0.55, 1],
    squash: 0.7,
  });

  // Smoke that passes in *front* of the record. Without a foreground pass the
  // cover reads as sitting behind a window rather than inside the bank, and no
  // amount of erasing on the plate itself fixes that.
  const pale = a.palette.bone.map((v) => Math.round(v * 0.6 + 18)).join(",");
  a.miasmaFront = blobSheet(Math.round(a.W * 0.75), Math.round(a.H * 0.75), r, {
    count: 42,
    radius: [0.16, 0.50],
    colours: [`rgba(${pale},1)`, "rgba(22,18,20,1)"],
    alpha: [0.10, 0.34],
    squash: 0.55,
  });
}

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, grain, vignette } = a;
  const { unit } = layout;

  const ember = css(shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal));
  const bone = palette.boneCss ?? css(palette.bone);

  a.bg.draw(ctx, s, a);

  // --- composition: the cover breathes with the section --------------------
  const seat = a.seat;
  const breath = 1 + Math.sin(s.sectionPhase * Math.PI * 2) * 0.012;
  const scale = seat.scale * 1.0 * breath * (1 + s.kick * 0.010);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = (W - w) / 2 + seat.dx * W * 0.5;
  const y = layout.y - (h - layout.h) / 2 + seat.dy * H * 0.5;

  // --- eaten by the smoke --------------------------------------------------
  const c = a.miasmaCtx;
  const sw = a.miasmaScratch.width;
  const sh = a.miasmaScratch.height;
  c.globalCompositeOperation = "copy";
  c.globalAlpha = 1;
  c.drawImage(art, 0, 0, sw, sh);

  // how much gets taken: quiet passages lose the record, loud ones keep it
  const eat = Math.max(0.15, 1.05 - s.rms * 0.7 - s.kick * 0.15);
  const gust = decay(s.sinceOnset, GUST_LIFE) * s.hit;
  const mw = a.miasmaMask.width;
  const mh = a.miasmaMask.height;
  const ox = ((-s.i * 0.7 - gust * sw * 0.12) % mw + mw) % mw;
  const oy = ((Math.sin(s.i * 0.004) * sh * 0.10) % mh + mh) % mh;
  c.globalCompositeOperation = "destination-out";
  c.globalAlpha = eat;
  for (const dx of [ox - mw, ox]) for (const dy of [oy - mh, oy]) c.drawImage(a.miasmaMask, dx, dy, mw, mh);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;

  ctx.drawImage(a.miasmaScratch, x, y, w, h);

  // rim light along the top edge: the one thing the smoke cannot take
  ctx.globalCompositeOperation = "lighter";
  const rim = ctx.createLinearGradient(0, y, 0, y + h * 0.22);
  rim.addColorStop(0, ember);
  rim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rim;
  ctx.globalAlpha = 0.32 + s.crack * 0.35;
  ctx.fillRect(x, y, w, h * 0.22);

  // and a hard hairline, so the plate always has an edge to be found by.
  // Filled on whole pixels rather than stroked: a stroke is centred on its
  // path, so at the plate's fractional top edge it lands half in one row and
  // half in the next, and under `lighter` that half-covered row is where GPU
  // raster and software raster stop agreeing with each other about the same
  // frame. A rect on a rounded y covers one row exactly, and reads crisper.
  ctx.fillStyle = bone;
  ctx.globalAlpha = 0.45 + s.downbeatPulse * 0.4;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(1, unit * 0.0014));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- the bank passing in front -------------------------------------------
  ctx.globalAlpha = 0.75 + (1 - s.rms) * 0.25;
  scroll(ctx, a.miasmaFront, -s.i * 1.35 - gust * W * 0.08, Math.sin(s.i * 0.0026) * H * 0.04, W * 0.75, H * 0.75);
  ctx.globalAlpha = 1;

  // --- type: it comes and goes with the bank -------------------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title);
  const artistSize = Math.round(unit * CREDIT.artist * 0.9);
  const cx = x + w / 2;
  const maxTextW = W * CREDIT_FIT;
  // held above the badge row when any service is picked: the row is drawn
  // after the look and owns the bottom of the frame
  const titleY = Math.min(H - unit * 0.07, y + h + unit * 0.12, creditFloor(a));
  const veil = 0.55 + s.rms * 0.45;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.letterSpacing = `${Math.round(unit * 0.030)}px`;
    ctx.font = `${fitSize(ctx, a.artist.toUpperCase(), FONT, artistSize, maxTextW)}px ${FONT}`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist * veil;
    ctx.fillText(a.artist.toUpperCase(), cx, titleY - titleSize * 0.95);
  }

  if (a.title) {
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle * 2)}px`;
    ctx.font = `${fitSize(ctx, a.title.toUpperCase(), FONT, titleSize, maxTextW)}px ${FONT}`;
    // three passes, each a little offset — the type is in the smoke, not on it
    ctx.fillStyle = bone;
    ctx.globalAlpha = alpha.title * veil * 0.35;
    ctx.fillText(a.title.toUpperCase(), cx - unit * 0.0025, titleY);
    ctx.fillText(a.title.toUpperCase(), cx + unit * 0.0025, titleY);
    ctx.globalAlpha = alpha.title * veil;
    ctx.fillText(a.title.toUpperCase(), cx, titleY);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.025;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.85 + (1 - s.arc) * 0.15;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
