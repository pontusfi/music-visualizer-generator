/**
 * BLOODTIDE — a red moon on the horizon, and the sea it is lighting.
 *
 * The moon sits low and splits open on the low end; cinders climb the sky and
 * two cloud decks cross it; below the horizon the water is forty-six bands of
 * sine, compressed toward the horizon for perspective, with the moon's
 * glitter path broken across the crests. The whole field is red, so a look
 * drawn over it has to be a silhouette — which is the point.
 *
 * The waves really are `sin(band * k + i * rate)`: the bands hold position and
 * only their brightness moved until the heave in `crestAt` was added, which is
 * what the sentence above used to describe. The amplitude is damped by `t^3`,
 * which pins the band on the horizon — `wake` stands its plate there — and
 * keeps the stack from reordering where the bands sit a third of a pixel
 * apart.
 *
 * The glitter is a seeded table sampled by band, and the two things that are
 * not — the spray thrown off a transient and the lightning answering a
 * downbeat — are seeded from the frame index of the event that started them
 * rather than from the current frame. So nothing accumulates, every burst
 * keeps its shape for its whole life, and any frame can still be drawn alone.
 */
import { off } from "../assets.js";
import { blobSheet, boltPath, particles, scroll, strokeBolt } from "../fields.js";
import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

export const id = "bloodtide";
export const name = "Bloodtide";

/** Water bands from the horizon to the bottom edge. */
export const BANDS = 46;
/** Glitter dashes per band. */
const GLINTS = 7;
/** Where the horizon sits. */
export const HORIZON = 0.56;

/**
 * The ceiling on how hard the sea is allowed to heave.
 *
 * Not a taste knob: `crestAt` stays strictly ordered only while the heave
 * term's slope is smaller than the baseline's, and that comparison is made
 * against this number. Raising it without redoing the sum reorders the bands
 * near the horizon, where they sit about a third of a pixel apart.
 */
export const HEAVE_MAX = 3.0;
/** Heave amplitude at the near edge, as a fraction of the sea's depth. */
const HEAVE_K = 0.038;
/** Radians per frame the swell travels at. */
const HEAVE_RATE = 0.055;
/** Frames a transient keeps the crests broken for. */
const TEAR_LIFE = 12;
/** Droplets in the spray table, and how long one burst lives. */
const SPRAY = 36;
const SPRAY_LIFE = 34;
/** Cinders drifting across the sky, split into this many batched tiers. */
const EMBERS = 54;
const EMBER_TIERS = 3;
/** Frames the section shockwave takes to cross the sky. */
const RING_LIFE = 72;
/** Frames of heat lightning on the far horizon. */
const STRIKE_LIFE = 9;

const mix = (a, b, t) => a.map((v, n) => v + (b[n] - v) * t);

/**
 * How hard the water is moving this frame. 1 is a sea at rest — never 0,
 * because a mirror-flat sea under a moon is the one thing that would give the
 * whole picture away as a gradient.
 */
export function heaveOf(s) {
  return Math.min(HEAVE_MAX, 1 + s.kick * 1.1 + s.wall * 0.45 + s.arc * 0.35);
}

/**
 * Where band `n` sits this frame, and how thick it is.
 *
 * The baseline `t^1.9` is the perspective compression; the heave rides on top
 * of it with a `t^3` amplitude, which does two jobs at once. It pins band 0 to
 * exactly the horizon — `wake` stands its plate there, and a waterline that
 * moved would leave the record floating — and it damps the displacement fast
 * enough toward the horizon that the bands cannot cross where they are packed
 * a third of a pixel apart. At HEAVE_K the displacement slope peaks at about
 * half the baseline's, so the stack stays ordered with room to spare.
 *
 * `span` is the raw distance to the next band, unscaled: the crests take 55%
 * of it and the trough shadows 40%, and both loops read it from here so the
 * two can never drift out of register.
 */
export function crestAt(n, i, horizon, depth, heave, lift) {
  const t = n / BANDS;
  const z = Math.pow(t, 1.9);
  const span = depth * (Math.pow((n + 1) / BANDS, 1.9) - z);
  const amp = depth * HEAVE_K * t * t * t * heave;
  return {
    t,
    y: horizon + depth * z + Math.sin(t * 7.3 + i * HEAVE_RATE) * amp,
    h: Math.max(1, span * 0.55 * lift),
    span,
  };
}

/**
 * A seed that is constant for the whole life of one event.
 *
 * Seeding from the frame index of the strike rather than from the current
 * frame is what lets a burst keep its shape while it plays without carrying
 * any state: every frame inside the window recomputes the same number. The
 * guard is for `NONE` (1e9), which would otherwise seed from a wild negative
 * before the first event of the track.
 */
export function eventSeed(i, since, salt) {
  return salt + Math.round(i - (since > 1e8 ? 0 : since)) * 131;
}

/** Where one droplet is in its arc, and how bright it still is. */
export function sprayAt(p, age, life, lift) {
  const t = life > 0 ? Math.min(1, Math.max(0, age / life)) : 1;
  // a parabola in the droplet's own age: thrown up out of the water and
  // falling back into it, never a straight rise
  const arc = 4 * t * (1 - t);
  return {
    dx: (t - 0.5) * p.sway * 2,
    dy: -arc * (0.05 + p.dim * 0.22) * lift,
    alpha: p.dim * (1 - t),
  };
}

/**
 * Where the disc sits and how big it is.
 *
 * It stays left of centre because `wake` seats the record at W * 0.60, and it
 * stays partly under the waterline because the sea fill is drawn after it —
 * that cut is what seats the moon in the water rather than hanging it in the
 * sky. Both are asserted rather than assumed: growing `d` with the low end
 * pushes the disc down as well as out, and it is the bottom edge that gives
 * first.
 */
export function moonPlace(s, progress, base, W, H) {
  const d = base * (1 + s.kick * 0.10 + s.wall * 0.035);
  return {
    x: W * 0.29 + Math.sin(progress * Math.PI) * W * 0.03,
    y: H * HORIZON - d * (0.34 + progress * 0.10)
      + Math.sin(s.sectionPhase * Math.PI) * H * 0.01,
    d,
  };
}

export function init(a) {
  const r = a.rng(1913);
  const e = a.palette.ember;
  // pulled toward arterial red whatever the cover's own ember is: this
  // background has one colour and the artwork does not get a vote
  const blood = mix(e, [168, 18, 22], 0.72).map(Math.round);
  const moonRgb = mix(e, [150, 24, 22], 0.86).map(Math.round);
  a.tideBlood = blood;
  a.tideMoonCss = `rgb(${moonRgb.join(",")})`;

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

  // The unlit limb, baked rather than clipped per frame. Cross-fading a second
  // disc in and out reads the same as a shadow sliding across the face, and
  // costs one drawImage instead of a save/arc/clip/restore in a draw path that
  // runs before every look — a clip left in force would take the next frame's
  // sky fill with it.
  const dark = off(d, d);
  const k = dark.getContext("2d");
  k.beginPath();
  k.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
  k.clip();
  const bite = k.createRadialGradient(d * 0.80, d * 0.28, d * 0.26, d * 0.80, d * 0.28, d * 0.98);
  bite.addColorStop(0, "rgba(5,1,3,0.96)");
  bite.addColorStop(0.55, "rgba(5,1,3,0.52)");
  bite.addColorStop(1, "rgba(5,1,3,0)");
  k.fillStyle = bite;
  k.fillRect(0, 0, d, d);
  a.tideMoonDark = dark;

  // and the other direction: a hot core behind a craquelure, so the heavy
  // parts split the disc open instead of merely brightening it
  const veins = off(d, d);
  const v = veins.getContext("2d");
  v.beginPath();
  v.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
  v.clip();
  // a broad warmth rather than a lamp in the middle: a core bright enough to
  // read as a source turns the disc into a plasma ball instead of a moon
  const core = v.createRadialGradient(d * 0.46, d * 0.52, d * 0.05, d * 0.5, d * 0.5, d * 0.62);
  core.addColorStop(0, "rgba(220,90,50,0.22)");
  core.addColorStop(0.55, "rgba(180,40,26,0.12)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  v.fillStyle = core;
  v.fillRect(0, 0, d, d);
  // Cracks seeded all over the face and running chord-wise, not spokes off a
  // hub. Fissures in a surface do not share an origin.
  for (let n = 0; n < 13; n += 1) {
    const ang = r() * Math.PI * 2;
    const rad = d * (0.10 + r() * 0.34);
    const x0 = d / 2 + Math.cos(ang) * rad;
    const y0 = d / 2 + Math.sin(ang) * rad;
    const run = d * (0.10 + r() * 0.26);
    const dir = ang + (r() - 0.5) * 2.4;
    const pts = boltPath(r, x0, y0, x0 + Math.cos(dir) * run, y0 + Math.sin(dir) * run,
      d * 0.035, 4);
    strokeBolt(v, pts, "rgba(150,30,20,0.28)", "rgba(255,150,96,0.42)",
      Math.max(1, d * 0.0022));
  }
  a.tideVeins = veins;

  a.tideClouds = blobSheet(Math.round(a.W * 0.9), Math.round(a.H * 0.45), r, {
    count: 46,
    radius: [0.08, 0.36],
    colours: ["rgba(18,4,7,1)", `rgba(${blood.join(",")},1)`],
    alpha: [0.18, 0.52],
    squash: 0.22,
  });

  // a second, smaller deck crossing faster: one sheet is weather, two is
  // distance. Built small because everything below `edge` is covered by the
  // sea fill anyway.
  a.tideDeck = blobSheet(Math.round(a.W * 0.55), Math.round(a.H * 0.28), r, {
    count: 26,
    radius: [0.06, 0.26],
    colours: ["rgba(12,3,5,1)", `rgba(${blood.join(",")},1)`],
    alpha: [0.12, 0.34],
    squash: 0.3,
  });

  // cinders climbing the sky, pre-sorted into tiers so the draw path can put
  // each tier down as one batched path instead of 54 separate rects
  const drift = particles(r, EMBERS, {
    speed: [0.0008, 0.0042],
    size: [0.5, 2.0],
    dim: [0.12, 1],
    sway: [0.006, 0.034],
  });
  a.tideEmbers = Array.from({ length: EMBER_TIERS }, (_, n) =>
    drift.filter((_p, idx) => idx % EMBER_TIERS === n));

  a.tideSpray = particles(r, SPRAY, {
    speed: [0.004, 0.02],
    size: [0.8, 2.4],
    dim: [0.25, 1],
    sway: [0.01, 0.05],
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
  // The artwork still gets no real vote — this is a thirty-fifth of a turn at
  // its widest, and weighted by `tonal` so a dense atonal wall does not swing
  // it at all. Enough that a long track breathes between sections instead of
  // sitting on one flat red.
  const blood = shiftHue(a.tideBlood, (s.hue - 0.5) * 0.035 * s.tonal).map(Math.round);
  const bloodCss = css(blood);

  // --- sky ------------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "rgb(9,4,6)");
  sky.addColorStop(0.55, `rgb(${Math.round(blood[0] * 0.22)},${Math.round(blood[1] * 0.18)},${Math.round(blood[2] * 0.22)})`);
  sky.addColorStop(1, `rgb(${Math.round(blood[0] * 0.55)},${Math.round(blood[1] * 0.3)},${Math.round(blood[2] * 0.3)})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, edge);

  // --- cinders climbing the sky ---------------------------------------------
  // The sky used to be a static gradient with clouds on it, which left the top
  // half of the frame with nothing happening in it. One batched path per tier:
  // 54 separate rects a frame would cost five times as much for the same
  // picture.
  ctx.globalCompositeOperation = "lighter";
  // the moon's colour rather than the sea's: blood on a near-black sky under
  // `lighter` barely registers, and this layer exists to stop the top of the
  // frame being dead
  ctx.strokeStyle = a.tideMoonCss;
  ctx.lineWidth = Math.max(1, W * 0.0012);
  for (let tier = 0; tier < EMBER_TIERS; tier += 1) {
    const set = a.tideEmbers[tier];
    if (!set.length) continue;
    ctx.globalAlpha = Math.min(0.42, (0.12 + tier * 0.07) * (0.55 + s.rms * 0.85));
    ctx.beginPath();
    for (const p of set) {
      // rising and wrapping analytically: the cinder at frame i does not
      // depend on where it was at frame i-1
      const up = (((p.y - s.i * p.speed * (1 + s.drive)) % 1) + 1) % 1;
      const x = p.x + Math.sin(s.i * 0.01 + p.phase) * p.sway;
      const px = ((x % 1) + 1) % 1 * W;
      const py = up * edge;
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - p.size * (H / 1080) * 2.2);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- the moon -------------------------------------------------------------
  const { x: mx, y: my, d } = moonPlace(s, a.progress, a.tideMoonSize, W, H);

  // The radius is deliberately capped. Under `lighter` this gradient lifts the
  // whole left of the frame, and it is drawn under every look, not just wake —
  // so the violence goes into the alpha and into pulling the inner stop tight
  // on the hit, which reads as a harder flash without growing the footprint.
  ctx.globalCompositeOperation = "lighter";
  const corona = ctx.createRadialGradient(
    mx, my, d * (0.46 - s.kick * 0.10),
    mx, my, d * (1.15 + s.rms * 0.30 + s.kick * 0.25),
  );
  corona.addColorStop(0, `rgba(${blood.join(",")},${0.26 + s.kick * 0.30 + s.downbeatPulse * 0.06})`);
  corona.addColorStop(0.5, `rgba(${blood.join(",")},${0.08 + s.kick * 0.05})`);
  corona.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = corona;
  ctx.fillRect(mx - d * 2, my - d * 2, d * 4, d * 4);
  ctx.globalCompositeOperation = "source-over";

  ctx.drawImage(a.tideMoon, mx - d / 2, my - d / 2, d, d);
  // the unlit limb, deepest through the quiet parts and burning back off as
  // the track comes up
  ctx.globalAlpha = Math.min(0.9, 0.55 * (1 - s.arc) + 0.25 * (1 - s.rms));
  ctx.drawImage(a.tideMoonDark, mx - d / 2, my - d / 2, d, d);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.min(0.78, s.kick * 0.6 + s.drive * 0.24 + s.downbeatPulse * 0.2);
  ctx.drawImage(a.tideVeins, mx - d / 2, my - d / 2, d, d);
  ctx.globalAlpha = 1;

  // --- the section turning over ---------------------------------------------
  const ring = decay(s.sinceSection, RING_LIFE);
  if (ring > 0.01) {
    const spread = 1 - ring;
    ctx.strokeStyle = a.tideMoonCss;
    ctx.lineWidth = Math.max(1, H * 0.005 * ring);
    ctx.globalAlpha = ring * 0.45;
    ctx.beginPath();
    ctx.ellipse(mx, my, d * (0.5 + spread * 3.4), d * (0.5 + spread * 3.4) * 0.5,
      0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";

  // --- cloud, two decks -----------------------------------------------------
  // No clip: the sea fill below covers everything these could spill onto, and
  // one fewer save/restore is one fewer way to leave a clip in force.
  const gust = decay(s.sinceOnset, 40) * s.hit * W * 0.04;
  ctx.globalAlpha = Math.min(1, 0.75 + s.arc * 0.3);
  scroll(ctx, a.tideClouds, -s.i * 0.42 * (1 + s.drive * 0.8) - gust,
    Math.sin(s.i * 0.0013) * H * 0.008, W * 0.9, H * 0.45);
  ctx.globalAlpha = Math.min(1, 0.5 + s.arc * 0.25 + s.wall * 0.2);
  scroll(ctx, a.tideDeck, -s.i * 0.95 * (1 + s.drive * 0.8) + gust * 0.5,
    Math.sin(s.i * 0.0021 + 1.7) * H * 0.006, W * 0.55, H * 0.28);
  ctx.globalAlpha = 1;

  // --- heat lightning, far right --------------------------------------------
  // The moon owns the left and wake stands its record at W * 0.60, so the
  // right of the horizon is the emptiest part of the frame. Red rather than
  // white, and short, so it reads as weather a long way off over water rather
  // than as Storm's bolt moved house.
  const strike = decay(s.sinceDownbeat, STRIKE_LIFE) * Math.max(0, s.kick - 0.4) / 0.6;
  if (strike > 0.02) {
    const r = a.rng(eventSeed(s.i, s.sinceDownbeat, 7717));
    const x0 = W * (0.62 + r() * 0.34);
    const pts = boltPath(r, x0, horizon - H * (0.16 + r() * 0.12),
      x0 + (r() - 0.5) * W * 0.12, horizon - H * 0.005, W * 0.035, 4);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, strike * 0.8);
    strokeBolt(ctx, pts, `rgba(${blood.join(",")},0.5)`,
      `rgba(255,150,120,0.85)`, Math.max(1, W * 0.0011));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- the sea --------------------------------------------------------------
  // the tide coming in: the whole surface lifts through a loud passage rather
  // than only its crests brightening
  const surge = 1 + s.arc * 0.35 + s.rms * 0.2;
  const sea = ctx.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, `rgb(${Math.round(blood[0] * 0.42 * surge)},${Math.round(blood[1] * 0.16 * surge)},${Math.round(blood[2] * 0.18 * surge)})`);
  sea.addColorStop(0.35, `rgb(${Math.round(blood[0] * 0.20 * surge)},${Math.round(blood[1] * 0.06 * surge)},${Math.round(blood[2] * 0.08 * surge)})`);
  sea.addColorStop(1, "rgb(10,2,4)");
  ctx.fillStyle = sea;
  ctx.fillRect(0, edge, W, H - edge);

  const depth = H - horizon;
  const heave = heaveOf(s);
  const lift = 1 + s.kick * 0.5 + s.wall * 0.25;
  // a transient does not just brighten the water, it breaks it: for a dozen
  // frames the near crests come apart laterally and the glitter scatters with
  // them
  const tear = decay(s.sinceOnset, TEAR_LIFE) * s.hit;

  // crests: darker troughs and lit tops, bunched toward the horizon
  ctx.globalCompositeOperation = "lighter";
  for (let n = 0; n < BANDS; n += 1) {
    const { t, y, h: bh } = crestAt(n, s.i, horizon, depth, heave, lift);
    const wave = Math.sin(t * 26 + s.i * 0.05) * 0.5 + 0.5;
    const j = a.tideBandJitter[n];

    ctx.globalAlpha = (0.04 + wave * 0.10 + s.kick * 0.07 + s.drive * 0.04)
      * (0.35 + t * 1.1) * j * (0.8 + s.arc * 0.45);
    ctx.fillStyle = bloodCss;
    if (tear > 0.01 && t > 0.45) {
      // two halves sliding opposite ways, both overhanging the frame edge so
      // no gap can open at the sides
      const slip = tear * W * 0.05 * j;
      ctx.fillRect(-W * 0.1 + slip, y, W * 0.62, bh);
      ctx.fillRect(W * 0.48 - slip, y, W * 0.62, bh);
    } else {
      ctx.fillRect(0, y, W, bh);
    }

    // the glitter path: dashes clustered on the moon's column, spreading and
    // brightening as the water comes toward the camera
    const spread = W * (0.02 + t * 0.42);
    for (let k = 0; k < GLINTS; k += 1) {
      const g = a.tideGlints[n * GLINTS + k];
      const writhe = Math.sin(s.i * g.rate + g.phase);
      const gx = mx + g.off * spread + writhe * W * 0.01
        + tear * g.off * W * 0.03;
      const gw = W * 0.004 * g.len * (0.5 + t * 3) * (1 + s.kick * 0.9 + tear * 1.2);
      const near = 1 - Math.min(1, Math.abs(g.off) * 0.85);
      ctx.globalAlpha = near * (0.22 + t * 0.62) * (0.55 + writhe * 0.45)
        * (0.45 + s.rms * 0.5 + s.beatPulse * 0.35 + s.crack * 0.4);
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
    // the same crestAt as the pass above, so the shadow can never drift out of
    // register with the crest it belongs to
    const { t, y, span } = crestAt(n, s.i, horizon, depth, heave, lift);
    const bh = Math.max(1, span * 0.4);
    const wave = Math.sin(t * 26 + s.i * 0.05 + Math.PI) * 0.5 + 0.5;
    ctx.globalAlpha = wave * 0.22 * (0.3 + t) * a.tideBandJitter[n];
    ctx.fillRect(0, y + bh * 0.7, W, bh);
  }
  ctx.globalAlpha = 1;

  // --- rings running out from under the moon --------------------------------
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = a.tideMoonCss;
  ctx.lineWidth = Math.max(1, W * 0.0012);
  for (let k = 0; k < 3; k += 1) {
    const rt = (s.i * 0.0045 + k / 3) % 1;
    ctx.globalAlpha = (1 - rt) * (0.07 + s.kick * 0.26);
    ctx.beginPath();
    ctx.ellipse(mx, horizon + depth * 0.16, W * 0.08 + rt * W * 0.55,
      H * 0.006 + rt * H * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- spray, thrown off the crests on a transient --------------------------
  // gated hard: outside a burst this loop does not run at all
  const sprayAge = s.sinceOnset > 1e8 ? SPRAY_LIFE : s.sinceOnset;
  if (sprayAge < SPRAY_LIFE && s.hit > 0.12) {
    const r = a.rng(eventSeed(s.i, s.sinceOnset, 4409));
    const base = horizon + depth * 0.10;
    ctx.fillStyle = a.tideMoonCss;
    for (const p of a.tideSpray) {
      const { dx, dy, alpha } = sprayAt(p, sprayAge, SPRAY_LIFE, lift);
      // the burst is placed on the glitter column, where the light is
      const px = mx + (r() - 0.5) * W * 0.5 + dx * W;
      const py = base + dy * H;
      ctx.globalAlpha = alpha * s.hit * 0.7;
      const size = Math.max(1, p.size * (W / 1920) * 2.0);
      ctx.fillRect(px, py, size, size * 1.4);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // the horizon itself, hot where the moon touches it, and shoved wide open on
  // a downbeat — drawn on the fixed horizon, never a heaved one
  const flare = 0.4 + s.downbeatPulse * 0.6;
  const line = ctx.createLinearGradient(mx - W * flare, 0, mx + W * flare, 0);
  line.addColorStop(0, "rgba(0,0,0,0)");
  line.addColorStop(0.5, `rgba(${blood.join(",")},${0.5 + s.downbeatPulse * 0.45})`);
  line.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = line;
  const lh = Math.max(1, H * 0.0024 * (1 + s.downbeatPulse * 2.2));
  ctx.fillRect(0, horizon - lh * 0.5, W, lh);

  // This background draws before every look, and strokeBolt leaves lineWidth
  // where it found it. Anything left set here lands in someone else's frame.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1;
}
