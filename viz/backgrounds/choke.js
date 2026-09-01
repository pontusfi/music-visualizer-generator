/**
 * CHOKE — smoke, and one hard light trying to get through it.
 *
 * Two cloud sheets at different scales crossing each other, a bank of god rays
 * over the top, and a gust that shoves the whole thing sideways on a transient
 * and lets it drift back. The rays are the reason this reads as a room and not
 * as a texture: they give the smoke something to be in front of.
 */
import { blobSheet, particles, raySheet, scroll } from "../fields.js";
import { css } from "../palette.js";
import { decay } from "../signals.js";

export const id = "choke";
export const name = "Choke";

/** Frames a gust takes to settle. */
const GUST_LIFE = 40;

export function init(a) {
  const r = a.rng(4441);
  const g = a.palette.ground;
  const pale = a.palette.bone.map((v) => Math.round(v * 0.55 + 20)).join(",");
  const murk = [Math.round(g[0] * 1.4 + 14), Math.round(g[1] * 1.3 + 13), Math.round(g[2] * 1.3 + 16)].join(",");

  a.chokeNear = blobSheet(Math.round(a.W * 0.9), Math.round(a.H * 0.9), r, {
    count: 60,
    radius: [0.16, 0.52],
    colours: [`rgba(${murk},1)`, `rgba(${pale},1)`],
    alpha: [0.14, 0.44],
    squash: 0.62,
  });
  a.chokeFar = blobSheet(Math.round(a.W * 0.6), Math.round(a.H * 0.6), r, {
    count: 76,
    radius: [0.10, 0.32],
    colours: [`rgba(${murk},1)`, `rgba(${pale},1)`],
    alpha: [0.10, 0.30],
    squash: 0.8,
  });
  a.chokeRays = raySheet(a.W, a.H, r, {
    count: 9,
    colour: a.palette.bone.map(Math.round).join(","),
    angle: 0.38,
    alpha: [0.10, 0.34],
  });
  a.chokeDust = particles(r, 90, { speed: [0.0002, 0.0009], size: [0.5, 1.8], dim: [0.1, 0.45] });
}

export function draw(ctx, s, a) {
  const { W, H, palette } = a;
  const g = palette.ground;

  ctx.fillStyle = css([g[0] * 0.95 + 9, g[1] * 0.95 + 9, g[2] * 1.05 + 12]);
  ctx.fillRect(0, 0, W, H);

  // a gust every transient, walking itself back over about two thirds of a
  // second — the age of the onset drives it, so it is still pure in i
  const gust = decay(s.sinceOnset, GUST_LIFE) * s.hit * W * 0.05;

  ctx.globalAlpha = 0.85;
  scroll(ctx, a.chokeFar, s.i * 0.55 + gust * 0.5, Math.sin(s.i * 0.003) * H * 0.02, W * 0.6, H * 0.6);
  ctx.globalAlpha = 0.95;
  scroll(ctx, a.chokeNear, -s.i * 0.95 - gust, Math.sin(s.i * 0.0021 + 1) * H * 0.03, W * 0.9, H * 0.9);

  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.55 + s.arc * 0.40 + s.downbeatPulse * 0.25;
  ctx.drawImage(a.chokeRays, 0, 0);

  ctx.fillStyle = css(palette.bone);
  for (const p of a.chokeDust) {
    const y = (((p.y + s.i * p.speed) % 1) + 1) % 1;
    const x = p.x + Math.sin(s.i * p.sway * 0.5 + p.phase) * 0.02;
    ctx.globalAlpha = p.dim * (0.3 + s.rms * 0.4);
    const px = Math.max(1, p.size * (W / 1920) * 2);
    ctx.fillRect(x * W, y * H, px, px);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
