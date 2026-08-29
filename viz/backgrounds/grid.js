/**
 * GRID — a perspective floor, receding to a horizon.
 *
 * Advances on the beat grid rather than the frame counter: the horizontal
 * lines march forward by a fixed distance per beat, so the recession keeps
 * time with the track rather than with the clock. Cheap enough that nothing
 * needs baking at init — the whole thing is strokes, drawn fresh every frame.
 */
import { css } from "../palette.js";

export const id = "grid";
export const name = "Grid";

const H_LINES = 22;
const V_LINES = 18;
/** How far a horizontal line advances, in z (0 = horizon, 1 = frame edge),
 *  for one full beat. */
const ADVANCE_PER_BEAT = 0.15;
/** Perspective bunching near the horizon. */
const RECESSION = 2.2;

/** The z-depth (0..1) of each horizontal line at this point in the beat grid
 *  — pure, and testable without a canvas or a real Signals object. */
export function horizonLines(beatOrdinal = 0, beatPhase = 0, count = H_LINES) {
  const phase = (beatOrdinal + beatPhase) * ADVANCE_PER_BEAT;
  const zs = [];
  for (let k = 0; k < count; k += 1) {
    zs.push((((k / count + phase) % 1) + 1) % 1);
  }
  return zs;
}

export function draw(ctx, s, a) {
  const { W, H, palette } = a;
  const unit = Math.min(W, H);
  const horizonY = H * 0.60;

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = css(palette.ember);
  ctx.lineWidth = Math.max(1, unit * 0.0016);

  // verticals, converging on the horizon's centre — static, so only the
  // recession itself carries the beat
  for (let k = 0; k <= V_LINES; k += 1) {
    const t = k / V_LINES;
    const bx = W * (t * 1.6 - 0.3);
    ctx.globalAlpha = 0.08 + 0.14 * (1 - Math.abs(t - 0.5) * 2);
    ctx.beginPath();
    ctx.moveTo(W / 2, horizonY);
    ctx.lineTo(bx, H);
    ctx.stroke();
  }

  // horizontals, receding toward the viewer on the beat
  for (const z of horizonLines(s.beatOrdinal, s.beatPhase)) {
    const y = horizonY + (H - horizonY) * z ** RECESSION;
    const half = W * 0.9 * z ** 1.3;
    ctx.globalAlpha = 0.06 + 0.32 * z;
    ctx.beginPath();
    ctx.moveTo(W / 2 - half, y);
    ctx.lineTo(W / 2 + half, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
