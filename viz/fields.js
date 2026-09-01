/**
 * Baked fields: the expensive textures the atmospheric backgrounds are made of.
 *
 * Everything here runs once, at init, and returns a canvas or a plain array.
 * Nothing in this file may be called from a draw path — the whole point is
 * that a background can scroll, wrap and light a baked sheet for the price of
 * two drawImage calls, instead of laying down four hundred gradients a frame.
 *
 * The sheets are all built to wrap vertically or horizontally: a blob that
 * would cross an edge is drawn a second time on the opposite side, so a
 * scrolling sheet has no seam and needs no per-frame bookkeeping.
 */

import { off } from "./assets.js";

/**
 * Soft overlapping blobs — smoke, cloud, plume, whatever the colours say.
 *
 * `bias` skews the vertical distribution: 0 spreads evenly, 1 packs everything
 * against the bottom edge (which is how fire is shaped).
 */
export function blobSheet(w, h, rng, {
  count = 90,
  radius = [0.08, 0.34],
  colours = ["rgba(255,255,255,0.5)"],
  alpha = [0.10, 0.45],
  bias = 0,
  additive = false,
  squash = 1,
} = {}) {
  const c = off(w, h);
  const x = c.getContext("2d");
  if (additive) x.globalCompositeOperation = "lighter";
  const unit = Math.min(w, h);

  for (let n = 0; n < count; n += 1) {
    const t = rng();
    const cy = bias > 0 ? h * (1 - Math.pow(t, 1 + bias * 2)) : h * t;
    const cx = rng() * w;
    const rad = unit * (radius[0] + rng() * (radius[1] - radius[0]));
    const a = alpha[0] + rng() * (alpha[1] - alpha[0]);
    const colour = colours[Math.floor(rng() * colours.length)];

    // Drawn a second time on the opposite side only when it actually crosses
    // an edge, so the sheet wraps without a seam. Listing `0` twice instead
    // would paint every interior blob four times over itself, at four times
    // the alpha it was given.
    // the blob reaches `rad` sideways but `rad * squash` vertically, and the
    // edge test has to use the extent it actually has: measured with `rad` on
    // both axes, a squashed-tall blob crosses the top or bottom without being
    // copied, and the sheet gets a visible seam where it is scrolled
    const ry = rad * squash;
    const dxs = cx - rad < 0 ? [0, w] : cx + rad > w ? [0, -w] : [0];
    const dys = cy - ry < 0 ? [0, h] : cy + ry > h ? [0, -h] : [0];
    for (const dx of dxs) {
      for (const dy of dys) {
        // The gradient is built at the origin, not at (gx, gy): a canvas
        // gradient is resolved in the user space in force when it is painted,
        // so one centred on (gx, gy) and then filled under a translate to
        // (gx, gy) lands at twice that — the blob comes out as a hard-edged
        // rectangle showing a slab of some other part of the ramp. Centred at
        // the origin, the same transform that squashes the circle into an
        // ellipse carries the gradient with it, which is the intent.
        const g = x.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, colour.replace(/[\d.]+\)$/, `${a})`));
        g.addColorStop(0.55, colour.replace(/[\d.]+\)$/, `${a * 0.35})`));
        g.addColorStop(1, colour.replace(/[\d.]+\)$/, "0)"));
        x.save();
        x.translate(cx + dx, cy + dy);
        x.scale(1, squash);
        x.fillStyle = g;
        // the full circle in local space, which the transform then squashes
        // into the ellipse. Scaling the rect by 1/squash instead — to hold the
        // device height constant — crops the ramp before it reaches zero
        // wherever squash > 1, and a gradient cut short is a hard edge.
        x.fillRect(-rad, -rad, rad * 2, rad * 2);
        x.restore();
      }
    }
  }
  return c;
}

/** Angled light wedges — god rays, window light, a searchlight through smoke. */
export function raySheet(w, h, rng, {
  count = 7,
  colour = "255,236,208",
  angle = 0.42,
  alpha = [0.04, 0.16],
} = {}) {
  const c = off(w, h);
  const x = c.getContext("2d");
  x.globalCompositeOperation = "lighter";
  x.translate(w * 0.5, h * 0.5);
  x.rotate(angle);
  for (let n = 0; n < count; n += 1) {
    const cx = (rng() - 0.5) * w * 1.8;
    const half = w * (0.006 + rng() * 0.055);
    const a = alpha[0] + rng() * (alpha[1] - alpha[0]);
    const g = x.createLinearGradient(cx - half, 0, cx + half, 0);
    g.addColorStop(0, `rgba(${colour},0)`);
    g.addColorStop(0.5, `rgba(${colour},${a})`);
    g.addColorStop(1, `rgba(${colour},0)`);
    // fade along the ray as well, so it does not read as a painted stripe
    const fade = x.createLinearGradient(0, -h, 0, h);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    x.save();
    x.fillStyle = g;
    x.fillRect(cx - half, -h, half * 2, h * 2);
    x.globalCompositeOperation = "destination-in";
    x.fillStyle = fade;
    x.fillRect(cx - half, -h, half * 2, h * 2);
    x.restore();
    x.globalCompositeOperation = "lighter";
  }
  return c;
}

/** A field of particles with analytic motion — sparks, rain, dust, cinders. */
export function particles(rng, count, {
  speed = [0.0006, 0.0030],
  size = [0.6, 2.4],
  dim = [0.2, 1],
  sway = [0.005, 0.03],
} = {}) {
  return Array.from({ length: count }, () => ({
    x: rng(),
    y: rng(),
    speed: speed[0] + rng() * (speed[1] - speed[0]),
    size: size[0] + rng() * (size[1] - size[0]),
    dim: dim[0] + rng() * (dim[1] - dim[0]),
    sway: sway[0] + rng() * (sway[1] - sway[0]),
    phase: rng() * Math.PI * 2,
  }));
}

/**
 * A jagged path between two points, by midpoint displacement.
 *
 * Takes an rng rather than making one, so the caller decides what the bolt is
 * a function of — seed it with the frame index of the strike and the same
 * strike draws identically on every render.
 */
export function boltPath(rng, x0, y0, x1, y1, jitter, depth = 5) {
  let pts = [[x0, y0], [x1, y1]];
  for (let d = 0; d < depth; d += 1) {
    const next = [pts[0]];
    const amp = jitter / Math.pow(1.8, d);
    for (let n = 1; n < pts.length; n += 1) {
      const [ax, ay] = pts[n - 1];
      const [bx, by] = pts[n];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const nx = -(by - ay);
      const ny = bx - ax;
      const len = Math.hypot(nx, ny) || 1;
      const k = (rng() - 0.5) * 2 * amp;
      next.push([mx + (nx / len) * k, my + (ny / len) * k]);
      next.push([bx, by]);
    }
    pts = next;
  }
  return pts;
}

/** Draw a polyline, hot core over a wide glow. */
export function strokeBolt(ctx, pts, glow, core, width) {
  const run = () => {
    ctx.beginPath();
    pts.forEach(([px, py], n) => (n === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.stroke();
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = glow;
  ctx.lineWidth = width * 4.5;
  run();
  ctx.strokeStyle = core;
  ctx.lineWidth = width;
  run();
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
}

/** Scroll a wrapping sheet: two draws, no seam, no state. */
export function scroll(ctx, sheet, dx, dy, w, h) {
  const ox = ((dx % w) + w) % w;
  const oy = ((dy % h) + h) % h;
  ctx.drawImage(sheet, ox - w, oy - h, w, h);
  ctx.drawImage(sheet, ox, oy - h, w, h);
  ctx.drawImage(sheet, ox - w, oy, w, h);
  ctx.drawImage(sheet, ox, oy, w, h);
}
