/**
 * EMBERSTORM — the frame is on fire.
 *
 * Three plume sheets, baked once and scrolled upward at different rates with
 * a horizontal wobble, are what makes the body of the flame; a row of tongues
 * along the bottom edge, drawn as quadratics whose control points are sines of
 * the frame index, is what makes it read as fire rather than as fog. Sparks
 * come off the top of the tongues, and the whole thing swells on the kick.
 *
 * Nothing is simulated. Every position is an expression in `i`, which is what
 * lets the renderer jump to frame 12,000 and get the same flame the sequential
 * walk would have drawn.
 */
import { off } from "../assets.js";
import { blobSheet, particles, scroll } from "../fields.js";
import { css } from "../palette.js";

export const id = "emberstorm";
export const name = "Emberstorm";

const TONGUES = 15;
/**
 * How much smaller the flame layer is drawn than the frame.
 *
 * Fifteen large blurred fills at 1080p cost about 220 ms a frame at full size
 * under software raster — an order of magnitude more than everything else in
 * this background put together. A blur is a low-pass filter, so a third-size
 * buffer discards only what the blur would have discarded, at a ninth of the
 * fill area and a third of the blur radius.
 */
const FLAME_SCALE = 3;

/** A little sideways lean at the tip, different for every tongue. */
const wob = (t, i) => Math.sin(i * t.rate * 1.7 + t.phase * 2) * 3;

const mix = (a, b, t) => a.map((v, n) => v + (b[n] - v) * t);

export function init(a) {
  const r = a.rng(7717);
  const e = a.palette.ember;
  const hot = mix(e, [255, 238, 186], 0.72).map(Math.round).join(",");
  const mid = e.map(Math.round).join(",");
  const deep = mix(e, [64, 8, 4], 0.55).map(Math.round).join(",");

  a.fireBody = blobSheet(Math.round(a.W * 0.7), Math.round(a.H * 0.7), r, {
    count: 84,
    radius: [0.06, 0.30],
    colours: [`rgba(${mid},1)`, `rgba(${deep},1)`, `rgba(${hot},1)`],
    alpha: [0.06, 0.26],
    bias: 1.1,
    additive: true,
    squash: 1.7,
  });
  a.fireSmoke = blobSheet(Math.round(a.W * 0.8), Math.round(a.H * 0.8), r, {
    count: 46,
    radius: [0.12, 0.42],
    colours: ["rgba(24,16,14,1)", "rgba(48,30,22,1)"],
    alpha: [0.14, 0.40],
    squash: 1.3,
  });
  a.fireSparks = particles(r, 150, { speed: [0.0016, 0.0075], size: [0.8, 2.8], dim: [0.3, 1] });
  a.fireHot = `rgb(${hot})`;
  a.fireMid = `rgb(${mid})`;
  a.fireTongue = Array.from({ length: TONGUES }, () => ({
    x: r(),
    w: 0.03 + r() * 0.09,
    h: 0.10 + r() * 0.30,
    rate: 0.02 + r() * 0.05,
    phase: r() * Math.PI * 2,
  }));

  // allocated once and repainted in place, like every other surface here
  a.fireFlame = off(Math.ceil(a.W / FLAME_SCALE), Math.ceil(a.H / FLAME_SCALE));
  a.fireFlameCtx = a.fireFlame.getContext("2d");
}

export function draw(ctx, s, a) {
  const { W, H, palette } = a;
  const g = palette.ground;
  const heat = 0.5 + s.kick * 0.5 + s.wall * 0.3;

  ctx.fillStyle = css([g[0] * 0.8 + 4, g[1] * 0.6 + 2, g[2] * 0.55 + 2]);
  ctx.fillRect(0, 0, W, H);

  // --- the body of the fire ------------------------------------------------
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.75 + s.rms * 0.45;
  scroll(ctx, a.fireBody, Math.sin(s.i * 0.006) * W * 0.03, -s.i * 2.4 * (1 + s.drive * 0.5), W, H);
  ctx.globalAlpha = 0.45 + s.kick * 0.35;
  scroll(ctx, a.fireBody, Math.sin(s.i * 0.011 + 2) * W * 0.05 + W * 0.3, -s.i * 4.6, W * 0.72, H * 0.72);

  // --- tongues along the floor --------------------------------------------
  // blurred, because a fire silhouette with a hard edge reads as cut paper.
  // The filter is deterministic under software raster, which is the raster the
  // determinism test runs on.
  // Into the third-size flame buffer, in frame coordinates — the transform
  // scales, so the geometry reads as if it were going onto the frame — then
  // added back in one blit. `lighter` is associative, so accumulating there
  // and adding once is the same picture as adding each tongue directly.
  const f = a.fireFlameCtx;
  const fs = a.fireFlame.width / W;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.filter = "none";
  f.globalAlpha = 1;
  f.globalCompositeOperation = "copy";
  f.fillStyle = "rgba(0,0,0,0)";
  f.fillRect(0, 0, a.fireFlame.width, a.fireFlame.height);
  f.globalCompositeOperation = "lighter";
  f.setTransform(fs, 0, 0, fs, 0, 0);
  // a canvas filter is in device pixels and ignores the transform, so the
  // radius is scaled by hand to blur by the same amount as at full size
  f.filter = `blur(${Math.max(1, W * 0.006 * fs)}px)`;

  const base = H * 1.02;
  for (const t of a.fireTongue) {
    const lick = 0.6 + 0.4 * Math.sin(s.i * t.rate + t.phase);
    const th = H * t.h * lick * heat;
    const tw = W * t.w;
    const tipX = W * t.x + Math.sin(s.i * t.rate * 0.6 + t.phase) * W * 0.02;
    const grad = f.createLinearGradient(0, base, 0, base - th);
    grad.addColorStop(0, `rgba(255,255,255,${0.16 * lick})`);
    grad.addColorStop(0.18, a.fireHot);
    grad.addColorStop(0.55, a.fireMid);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = grad;
    f.globalAlpha = 0.30 + lick * 0.35 * heat;
    f.beginPath();
    f.moveTo(tipX - tw / 2, base);
    f.quadraticCurveTo(tipX - tw * 0.55, base - th * 0.45, tipX - tw * 0.12, base - th * 0.72);
    f.quadraticCurveTo(tipX + tw * 0.05, base - th * 0.92, tipX + tw * 0.06 * wob(t, s.i), base - th);
    f.quadraticCurveTo(tipX + tw * 0.34, base - th * 0.62, tipX + tw * 0.52, base - th * 0.3);
    f.quadraticCurveTo(tipX + tw * 0.6, base - th * 0.12, tipX + tw / 2, base);
    f.closePath();
    f.fill();
  }
  f.filter = "none";
  f.setTransform(1, 0, 0, 1, 0, 0);

  // still under `lighter` from the plume above
  ctx.globalAlpha = 1;
  ctx.drawImage(a.fireFlame, 0, 0, W, H);

  // --- sparks --------------------------------------------------------------
  ctx.fillStyle = a.fireHot;
  for (const p of a.fireSparks) {
    const y = (((p.y - s.i * p.speed * (1 + s.drive)) % 1) + 1) % 1;
    const x = p.x + Math.sin(s.i * p.sway + p.phase) * 0.05;
    ctx.globalAlpha = p.dim * (1 - y) * (0.4 + s.rms * 0.6);
    const px = Math.max(1, p.size * (W / 1920) * 2.4);
    ctx.fillRect(x * W, y * H, px, px * (1.4 + p.dim));
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- smoke over the top of it -------------------------------------------
  ctx.globalAlpha = 0.5 + (1 - s.arc) * 0.3;
  scroll(ctx, a.fireSmoke, Math.sin(s.i * 0.004) * W * 0.06, -s.i * 0.9, W * 0.8, H * 0.8);
  ctx.globalAlpha = 1;
}
