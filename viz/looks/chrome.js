/**
 * CHROME — the record in polished steel, over liquid metal.
 *
 * The cover hangs above a mirror pool: the reflection is the artwork redrawn
 * upside down in forty slices, each displaced by a travelling sine, so the
 * surface moves like mercury rather than like water. A specular sweep crosses
 * the plate once per bar — the highlight is on `barPhase`, so it wipes in time
 * whatever the tempo — and the type is filled with a real chrome ramp.
 *
 * Ripple phase comes from the frame index, sweep position from the bar. No
 * feedback buffer anywhere, so any frame can be drawn on its own.
 */

import { CREDIT, CREDIT_FIT, creditAlpha, fitSize } from "../credit.js";
import { css, shiftHue } from "../palette.js";
import { creditFloor } from "../services.js";

export const id = "chrome";
export const name = "Chrome";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.14;
/** Slices in the reflection. */
const SLICES = 44;

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, grain, vignette } = a;
  const { unit } = layout;

  const ember = css(shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal));
  const bone = palette.boneCss ?? css(palette.bone);

  a.bg.draw(ctx, s, a);

  // --- composition: high, to leave the pool room ---------------------------
  const seat = a.seat;
  const scale = seat.scale * 0.88 * (1 + s.kick * 0.012);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const x = (W - w) / 2 + seat.dx * W * 0.4;
  const y = H * 0.075 + seat.dy * H * 0.3;

  // --- the reflection, first (it sits behind everything) -------------------
  const surface = y + h + unit * 0.012;
  const sliceH = h / SLICES;
  const srcH = art.height / SLICES;
  const swell = 1 + s.kick * 0.8 + s.wall * 0.5;
  for (let n = 0; n < SLICES; n += 1) {
    const t = n / SLICES;
    // n = 0 is the slice nearest the surface, which is the *bottom* of the art
    const ripple = Math.sin(t * 9 - s.i * 0.055) * unit * 0.006 * swell * (0.25 + t * 1.5);
    const stretch = 1 + t * 0.25;
    ctx.globalAlpha = Math.max(0, 0.42 - t * 0.44);
    ctx.drawImage(
      art,
      0, art.height - (n + 1) * srcH, art.width, srcH,
      x + ripple, surface + n * sliceH * stretch, w, sliceH * stretch + 1,
    );
  }
  ctx.globalAlpha = 1;

  // the surface line itself, and a mercury sheen over the reflection
  const sheen = ctx.createLinearGradient(0, surface, 0, surface + h * 0.7);
  sheen.addColorStop(0, `rgba(${palette.bone.map(Math.round).join(",")},0.06)`);
  sheen.addColorStop(0.35, "rgba(0,0,0,0.55)");
  sheen.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, surface, W, h * 0.75);

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = bone;
  ctx.globalAlpha = 0.35 + s.downbeatPulse * 0.5;
  ctx.fillRect(x - w * 0.06, surface, w * 1.12, Math.max(1, unit * 0.0016 * (1 + s.kick * 2)));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- the plate -----------------------------------------------------------
  ctx.drawImage(art, x, y, w, h);

  // bevel: light above, dark below — the whole reason it reads as metal
  const bev = Math.max(1, unit * 0.0035);
  ctx.fillStyle = bone;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x - bev, y - bev, w + bev * 2, bev);
  ctx.fillRect(x - bev, y - bev, bev, h + bev * 2);
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "#000";
  ctx.fillRect(x - bev, y + h, w + bev * 2, bev);
  ctx.fillRect(x + w, y - bev, bev, h + bev * 2);
  ctx.globalAlpha = 1;

  // --- specular sweep, once per bar ---------------------------------------
  const sweep = s.barPhase * (w + h) * 1.6 - h * 0.8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const band = unit * 0.055;
  const gsw = ctx.createLinearGradient(x + sweep - band, y, x + sweep + band, y + h);
  gsw.addColorStop(0, "rgba(255,255,255,0)");
  gsw.addColorStop(0.5, `rgba(255,255,255,${0.22 + s.crack * 0.35})`);
  gsw.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gsw;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // --- type: filled with a chrome ramp ------------------------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title * 1.06);
  const artistSize = Math.round(unit * CREDIT.artist * 0.9);
  const cx = x + w / 2;
  const maxTextW = W * CREDIT_FIT;
  // held above the badge row when any service is picked: the row is drawn
  // after the look and owns the bottom of the frame
  const titleY = Math.min(H - unit * 0.062, creditFloor(a));

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.letterSpacing = `${Math.round(unit * 0.024)}px`;
    ctx.font = `${fitSize(ctx, a.artist.toUpperCase(), FONT, artistSize, maxTextW)}px ${FONT}`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist;
    ctx.fillText(a.artist.toUpperCase(), cx, titleY - titleSize * 0.92);
  }

  if (a.title) {
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle)}px`;
    ctx.font = `${fitSize(ctx, a.title.toUpperCase(), FONT, titleSize, maxTextW)}px ${FONT}`;
    const top = titleY - titleSize * 0.78;
    const ramp = ctx.createLinearGradient(0, top, 0, titleY + titleSize * 0.12);
    ramp.addColorStop(0.00, bone);
    ramp.addColorStop(0.30, "#8d919b");
    ramp.addColorStop(0.48, "#33363d");
    ramp.addColorStop(0.56, ember);
    ramp.addColorStop(0.76, bone);
    ramp.addColorStop(1.00, "#9aa0aa");
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#000";
    ctx.fillText(a.title.toUpperCase(), cx, titleY + Math.max(1, unit * 0.0035));
    ctx.globalAlpha = alpha.title;
    ctx.fillStyle = ramp;
    ctx.fillText(a.title.toUpperCase(), cx, titleY);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.04 + s.hit * 0.02;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.7 + (1 - s.arc) * 0.2;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
