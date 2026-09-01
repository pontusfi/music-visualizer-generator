/**
 * SMELT — a pour, and the floor it lands on.
 *
 * Molten streams fall from the top of the frame at their own rates, widening
 * where they land into a bright pool line that ripples on the low end. Slag
 * spits back up out of the pool. It is the same family as Emberstorm and a
 * completely different shape: vertical, ordered, industrial — fire with a
 * process behind it rather than fire as weather.
 */
import { blobSheet, particles, scroll } from "../fields.js";
import { css } from "../palette.js";

export const id = "smelt";
export const name = "Smelt";

const STREAMS = 7;
const RIPPLES = 4;

const mix = (a, b, t) => a.map((v, n) => v + (b[n] - v) * t);

export function init(a) {
  const r = a.rng(2903);
  const e = a.palette.ember;
  a.smeltHot = `rgb(${mix(e, [255, 244, 208], 0.78).map(Math.round).join(",")})`;
  a.smeltMid = `rgb(${e.map(Math.round).join(",")})`;

  a.smeltStreams = Array.from({ length: STREAMS }, (_, k) => ({
    x: (k + 0.5) / STREAMS + (r() - 0.5) * 0.05,
    w: 0.004 + r() * 0.010,
    rate: 0.03 + r() * 0.05,
    phase: r() * Math.PI * 2,
    lag: r(),
  }));
  a.smeltSpit = particles(r, 70, { speed: [0.0022, 0.0075], size: [0.8, 2.6], dim: [0.35, 1] });
  a.smeltHaze = blobSheet(Math.round(a.W * 0.7), Math.round(a.H * 0.5), r, {
    count: 34,
    radius: [0.10, 0.34],
    colours: [`rgba(${e.map(Math.round).join(",")},1)`, "rgba(30,16,10,1)"],
    alpha: [0.05, 0.18],
    bias: 1.4,
    additive: true,
    squash: 1.5,
  });
}

export function draw(ctx, s, a) {
  const { W, H, palette } = a;
  const g = palette.ground;
  const poolY = H * 0.90;

  ctx.fillStyle = css([g[0] * 0.75 + 5, g[1] * 0.68 + 4, g[2] * 0.68 + 5]);
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = "lighter";

  // --- the streams ---------------------------------------------------------
  for (const st of a.smeltStreams) {
    const wob = Math.sin(s.i * st.rate + st.phase);
    const flow = 0.55 + 0.45 * Math.sin(s.i * st.rate * 0.4 + st.lag * 6.28);
    const cx = st.x * W + wob * W * 0.006;
    const half = W * st.w * (0.6 + flow * 0.7) * (1 + s.kick * 0.5);
    const grad = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.35, a.smeltMid);
    grad.addColorStop(0.5, a.smeltHot);
    grad.addColorStop(0.65, a.smeltMid);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.30 + flow * 0.35 + s.wall * 0.20;
    ctx.fillRect(cx - half, -H * 0.05, half * 2, poolY + H * 0.05);

    // the splash where it lands
    const sr = half * (5 + s.kick * 4);
    const sp = ctx.createRadialGradient(cx, poolY, 0, cx, poolY, sr);
    sp.addColorStop(0, a.smeltHot);
    sp.addColorStop(0.4, a.smeltMid);
    sp.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sp;
    ctx.globalAlpha = 0.30 + flow * 0.3;
    ctx.fillRect(cx - sr, poolY - sr * 0.5, sr * 2, sr);
  }

  // --- the pool ------------------------------------------------------------
  const poolGrad = ctx.createLinearGradient(0, poolY - H * 0.06, 0, H);
  poolGrad.addColorStop(0, "rgba(0,0,0,0)");
  poolGrad.addColorStop(0.55, a.smeltMid);
  poolGrad.addColorStop(1, a.smeltHot);
  ctx.fillStyle = poolGrad;
  ctx.globalAlpha = 0.35 + s.rms * 0.30 + s.kick * 0.20;
  ctx.fillRect(0, poolY - H * 0.06, W, H - poolY + H * 0.06);

  // ripples running out across the surface on every kick
  ctx.strokeStyle = a.smeltHot;
  for (let k = 0; k < RIPPLES; k += 1) {
    const t = ((s.i * 0.004 + k / RIPPLES) % 1);
    ctx.globalAlpha = (1 - t) * (0.10 + s.kick * 0.30);
    ctx.lineWidth = Math.max(1, W * 0.0012);
    ctx.beginPath();
    ctx.ellipse(W * 0.5, poolY + H * 0.03, W * 0.1 + t * W * 0.6, H * 0.008 + t * H * 0.02, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- spit ----------------------------------------------------------------
  ctx.fillStyle = a.smeltHot;
  for (const p of a.smeltSpit) {
    // thrown up out of the pool and falling back: a parabola in the age of the
    // particle's own cycle, not a straight rise
    const t = (((p.y + s.i * p.speed) % 1) + 1) % 1;
    const arc = 4 * t * (1 - t);
    const y = poolY - arc * H * (0.10 + p.dim * 0.42);
    const x = (p.x + (t - 0.5) * 0.12 * (p.phase > 3 ? 1 : -1)) * W;
    ctx.globalAlpha = p.dim * (1 - t * 0.7) * (0.35 + s.drive * 0.5);
    const px = Math.max(1, p.size * (W / 1920) * 2.2);
    ctx.fillRect(x, y, px, px * 1.5);
  }

  ctx.globalAlpha = 0.5 + s.wall * 0.3;
  scroll(ctx, a.smeltHaze, Math.sin(s.i * 0.005) * W * 0.02, -s.i * 1.6, W * 0.7, H * 0.5);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
