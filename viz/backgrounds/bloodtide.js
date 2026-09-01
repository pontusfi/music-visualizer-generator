/**
 * BLOODTIDE — a red moon on the horizon, and the sea it is lighting.
 *
 * The moon sits low and pulses with the low end; cloud bands cross it; below
 * the horizon the water is forty bands of sine, compressed toward the horizon
 * for perspective, with the moon's glitter path broken across the crests. The
 * whole field is red, so a look drawn over it has to be a silhouette — which
 * is the point.
 *
 * The waves are `sin(band * k + i * rate)` and the glitter is a seeded table
 * sampled by band, so nothing accumulates and any frame can be drawn alone.
 */
import { off } from "../assets.js";
import { blobSheet, scroll } from "../fields.js";

export const id = "bloodtide";
export const name = "Bloodtide";

/** Water bands from the horizon to the bottom edge. */
const BANDS = 46;
/** Glitter dashes per band. */
const GLINTS = 7;
/** Where the horizon sits. */
export const HORIZON = 0.56;

const mix = (a, b, t) => a.map((v, n) => v + (b[n] - v) * t);

export function init(a) {
  const r = a.rng(1913);
  const e = a.palette.ember;
  // pulled toward arterial red whatever the cover's own ember is: this
  // background has one colour and the artwork does not get a vote
  const blood = mix(e, [168, 18, 22], 0.72).map(Math.round);
  const moonRgb = mix(e, [150, 24, 22], 0.86).map(Math.round);
  a.tideBlood = blood;
  a.tideMoonCss = `rgb(${moonRgb.join(",")})`;
  a.tideBloodCss = `rgb(${blood.join(",")})`;

  // the disc, baked: a flat fill plus mottling, so it is a body and not a dot
  const d = Math.round(Math.min(a.W, a.H) * 0.48);
  const moon = off(d, d);
  const m = moon.getContext("2d");
  m.beginPath();
  m.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
  m.clip();
  const face = m.createLinearGradient(0, 0, d * 0.4, d);
  face.addColorStop(0, `rgb(${mix(moonRgb, [222, 96, 62], 0.30).map(Math.round).join(",")})`);
  face.addColorStop(0.55, `rgb(${mix(moonRgb, [96, 12, 14], 0.35).map(Math.round).join(",")})`);
  face.addColorStop(1, `rgb(${mix(moonRgb, [34, 4, 7], 0.78).map(Math.round).join(",")})`);
  m.fillStyle = face;
  m.fillRect(0, 0, d, d);
  for (let n = 0; n < 30; n += 1) {
    const cx = r() * d;
    const cy = r() * d;
    const rad = d * (0.05 + r() * 0.20);
    const g = m.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(40,5,8,${0.06 + r() * 0.14})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = g;
    m.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  // limb darkening — without it the disc reads as a flat circle of paint
  const limb = m.createRadialGradient(d * 0.42, d * 0.40, d * 0.10, d * 0.5, d * 0.5, d * 0.52);
  limb.addColorStop(0, "rgba(0,0,0,0)");
  limb.addColorStop(0.62, "rgba(24,2,5,0.18)");
  limb.addColorStop(1, "rgba(14,1,3,0.86)");
  m.fillStyle = limb;
  m.fillRect(0, 0, d, d);
  a.tideMoon = moon;
  a.tideMoonSize = d;

  a.tideClouds = blobSheet(Math.round(a.W * 0.9), Math.round(a.H * 0.45), r, {
    count: 46,
    radius: [0.08, 0.36],
    colours: ["rgba(18,4,7,1)", `rgba(${blood.join(",")},1)`],
    alpha: [0.18, 0.52],
    squash: 0.22,
  });

  // one seeded offset per glint, so the glitter path is broken rather than a
  // clean column — a mirror-flat sea under a moon is the one thing that would
  // give this away as a gradient
  a.tideGlints = Array.from({ length: BANDS * GLINTS }, () => ({
    off: (r() - 0.5) * 2,
    len: 0.2 + r() * 1.0,
    rate: 0.02 + r() * 0.06,
    phase: r() * Math.PI * 2,
  }));

  // per-band irregularity, so the crest stack never reads as scanlines
  a.tideBandJitter = Array.from({ length: BANDS }, () => 0.35 + r() * 1.3);
}

export function draw(ctx, s, a) {
  const { W, H } = a;
  const horizon = H * HORIZON;
  // The sky and the sea between them are this background's ground fill, and a
  // ground fill has to cover every pixel: nothing clears the canvas between
  // frames. Split on the raw fractional horizon and the row it lands in gets
  // 80% of one fill and 20% of the other, which leaves a sixth of the previous
  // frame showing through that row — enough to make the same frame differ
  // depending on what was drawn before it. So the two fills meet on a whole
  // pixel. `horizon` itself stays fractional for everything else, and HORIZON
  // stays the exported proportion `wake` stands its plate on.
  const edge = Math.round(horizon);
  const blood = a.tideBlood;

  // --- sky ------------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "rgb(9,4,6)");
  sky.addColorStop(0.55, `rgb(${Math.round(blood[0] * 0.22)},${Math.round(blood[1] * 0.18)},${Math.round(blood[2] * 0.22)})`);
  sky.addColorStop(1, `rgb(${Math.round(blood[0] * 0.55)},${Math.round(blood[1] * 0.3)},${Math.round(blood[2] * 0.3)})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, edge);

  // --- the moon -------------------------------------------------------------
  const d = a.tideMoonSize * (1 + s.kick * 0.03 + s.wall * 0.012);
  // off-centre, so the record (which the companion look stands on the horizon)
  // never eclipses it
  const mx = W * 0.29 + Math.sin(a.progress * Math.PI) * W * 0.03;
  // rides a little through the track, but never clears the horizon
  const my = horizon - d * (0.34 + a.progress * 0.10) + Math.sin(s.sectionPhase * Math.PI) * H * 0.01;

  ctx.globalCompositeOperation = "lighter";
  const corona = ctx.createRadialGradient(mx, my, d * 0.46, mx, my, d * (1.15 + s.rms * 0.35));
  corona.addColorStop(0, `rgba(${blood.join(",")},${0.30 + s.kick * 0.26})`);
  corona.addColorStop(0.5, `rgba(${blood.join(",")},0.08)`);
  corona.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = corona;
  ctx.fillRect(mx - d * 2, my - d * 2, d * 4, d * 4);
  ctx.globalCompositeOperation = "source-over";

  ctx.drawImage(a.tideMoon, mx - d / 2, my - d / 2, d, d);

  // cloud bands crossing it
  ctx.globalAlpha = 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  ctx.clip();
  scroll(ctx, a.tideClouds, -s.i * 0.42, Math.sin(s.i * 0.0013) * H * 0.008, W * 0.9, H * 0.45);
  ctx.restore();
  ctx.globalAlpha = 1;

  // --- the sea --------------------------------------------------------------
  const sea = ctx.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, `rgb(${Math.round(blood[0] * 0.42)},${Math.round(blood[1] * 0.16)},${Math.round(blood[2] * 0.18)})`);
  sea.addColorStop(0.35, `rgb(${Math.round(blood[0] * 0.20)},${Math.round(blood[1] * 0.06)},${Math.round(blood[2] * 0.08)})`);
  sea.addColorStop(1, "rgb(10,2,4)");
  ctx.fillStyle = sea;
  ctx.fillRect(0, edge, W, H - edge);

  const depth = H - horizon;
  const swell = 1 + s.kick * 0.7 + s.wall * 0.4;

  // crests: darker troughs and lit tops, bunched toward the horizon
  ctx.globalCompositeOperation = "lighter";
  for (let n = 0; n < BANDS; n += 1) {
    const t = n / BANDS;
    const z = Math.pow(t, 1.9);
    const y = horizon + depth * z;
    const bh = Math.max(1, (depth * (Math.pow((n + 1) / BANDS, 1.9) - z)) * 0.55);
    const wave = Math.sin(t * 26 + s.i * 0.05) * 0.5 + 0.5;
    const j = a.tideBandJitter[n];

    ctx.globalAlpha = (0.05 + wave * 0.12) * (0.35 + t * 1.1) * j;
    ctx.fillStyle = a.tideBloodCss;
    ctx.fillRect(0, y, W, bh);

    // the glitter path: dashes clustered on the moon's column, spreading and
    // brightening as the water comes toward the camera
    const spread = W * (0.02 + t * 0.42);
    for (let k = 0; k < GLINTS; k += 1) {
      const g = a.tideGlints[n * GLINTS + k];
      const jitter = Math.sin(s.i * g.rate + g.phase);
      const gx = mx + g.off * spread + jitter * W * 0.01;
      const gw = W * 0.004 * g.len * (0.5 + t * 3) * swell;
      const near = 1 - Math.min(1, Math.abs(g.off) * 0.85);
      ctx.globalAlpha = near * (0.22 + t * 0.62) * (0.55 + jitter * 0.45) * (0.6 + s.rms * 0.6);
      ctx.fillStyle = a.tideMoonCss;
      ctx.fillRect(gx - gw / 2, y, gw, Math.max(1, bh * 0.7));
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // trough shadows: the crests above are additive, so without a subtractive
  // pass the sea flattens into a gradient at distance
  ctx.fillStyle = "rgba(6,1,3,0.5)";
  for (let n = 0; n < BANDS; n += 1) {
    const t = n / BANDS;
    const z = Math.pow(t, 1.9);
    const y = horizon + depth * z;
    const bh = Math.max(1, (depth * (Math.pow((n + 1) / BANDS, 1.9) - z)) * 0.4);
    const wave = Math.sin(t * 26 + s.i * 0.05 + Math.PI) * 0.5 + 0.5;
    ctx.globalAlpha = wave * 0.22 * (0.3 + t) * a.tideBandJitter[n];
    ctx.fillRect(0, y + bh * 0.7, W, bh);
  }
  ctx.globalAlpha = 1;

  // the horizon itself, hot where the moon touches it
  const line = ctx.createLinearGradient(mx - W * 0.4, 0, mx + W * 0.4, 0);
  line.addColorStop(0, "rgba(0,0,0,0)");
  line.addColorStop(0.5, `rgba(${blood.join(",")},${0.5 + s.downbeatPulse * 0.4})`);
  line.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = line;
  ctx.fillRect(0, horizon - Math.max(1, H * 0.0012), W, Math.max(1, H * 0.0024));
}
