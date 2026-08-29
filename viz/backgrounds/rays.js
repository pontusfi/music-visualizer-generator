/**
 * RAYS — light from behind the cover.
 *
 * A starburst of soft wedges, centred on wherever the cover sits, turning
 * with the bar rather than the frame counter and flaring outward on the
 * downbeat. Built once as a square sprite oversized enough that a full
 * rotation never reveals a corner; one rotated `drawImage` a frame.
 */
import { off } from "../assets.js";

export const id = "rays";
export const name = "Rays";

const WEDGES = 14;

/** The sprite's rotation and scale at frame `i` — pure, and the whole reason
 *  this is testable without a canvas. */
export function rayTransform(barPhase = 0, downbeatPulse = 0) {
  const angle = (barPhase % 1) * Math.PI * 2;
  const scale = 1 + Math.max(0, Math.min(1, downbeatPulse)) * 0.12;
  return { angle, scale };
}

export function init(a) {
  const { W, H, palette } = a;
  // oversized so rotating it never brings a corner into frame
  const size = Math.round(Math.max(W, H) * 2.2);
  const c = off(size, size);
  const x = c.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const [er, eg, eb] = palette.ember;

  for (let n = 0; n < WEDGES; n += 1) {
    const a0 = (n / WEDGES) * Math.PI * 2;
    const a1 = a0 + ((Math.PI * 2) / WEDGES) * 0.48;
    const alpha = n % 2 === 0 ? 0.16 : 0.06;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    g.addColorStop(0, `rgba(${er},${eg},${eb},${alpha})`);
    g.addColorStop(1, `rgba(${er},${eg},${eb},0)`);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, size / 2, a0, a1);
    x.closePath();
    x.fill();
  }
  a.bgRays = c;
}

export function draw(ctx, s, a) {
  const { W, H, bgRays, palette, layout } = a;

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  const cx = layout.x + layout.w / 2;
  const cy = layout.y + layout.h / 2;
  const { angle, scale } = rayTransform(s.barPhase, s.downbeatPulse);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.55 + (s.downbeatPulse ?? 0) * 0.35;
  ctx.drawImage(bgRays, -bgRays.width / 2, -bgRays.height / 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
