/**
 * TOTEM — the record as a standing stone, taking hits.
 *
 * The cover is drawn as a leaning monolith: forty slices, each a little
 * narrower toward the top, which fakes just enough perspective to make it a
 * thing in a place rather than a rectangle on a background. Arcs crawl its
 * edges continuously, and on a transient one or three bolts strike it from the
 * frame edge and light the whole face.
 *
 * Every bolt is midpoint displacement seeded from the frame index of the strike
 * that threw it, so it is the same bolt on every render and a different one on
 * every hit.
 */

import { boltPath, strokeBolt } from "../fields.js";
import { CREDIT, creditAlpha } from "../credit.js";
import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

export const id = "totem";
export const name = "Totem";

const FONT = `Display, "Oswald", "Arial Narrow", sans-serif`;
const HUE_SPREAD = 0.12;
const SLICES = 40;
/** How much narrower the top of the stone is than its base. */
const LEAN = 0.13;
/** Frames a strike stays lit, and how often the crawl re-rolls. */
const STRIKE_LIFE = 8;
const CRAWL_HOLD = 5;

export function draw(ctx, s, a) {
  const { W, H, art, layout, palette, grain, vignette } = a;
  const { unit } = layout;

  const ember = css(shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal));
  const bone = palette.boneCss ?? css(palette.bone);

  a.bg.draw(ctx, s, a);

  // --- the stone -----------------------------------------------------------
  const seat = a.seat;
  const scale = seat.scale * 1.04 * (1 + s.kick * 0.010);
  const w = layout.w * scale;
  const h = layout.h * scale;
  const cx = W / 2 + seat.dx * W * 0.35;
  const y = layout.y - (h - layout.h) / 2 + seat.dy * H * 0.35;

  const sliceH = h / SLICES;
  const srcH = art.height / SLICES;
  const widthAt = (t) => w * (1 - LEAN * (1 - t));
  for (let n = 0; n < SLICES; n += 1) {
    const t = n / (SLICES - 1);
    const sw = widthAt(t);
    // slices overlap by two pixels: at a trapezoid's rate of change a one-pixel
    // overlap still leaves a visible ladder of seams down the face
    ctx.drawImage(
      art,
      0, n * srcH, art.width, srcH,
      Math.round(cx - sw / 2), Math.floor(y + n * sliceH), Math.ceil(sw), Math.ceil(sliceH) + 2,
    );
  }

  // the plinth it stands on, and its shadow
  const baseW = w * 1.10;
  const baseH = unit * 0.020;
  ctx.fillStyle = "#08080b";
  ctx.globalAlpha = 0.92;
  ctx.fillRect(cx - baseW / 2, y + h, baseW, baseH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = bone;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(cx - baseW / 2, y + h, baseW, Math.max(1, unit * 0.0012));
  ctx.globalAlpha = 1;

  // --- arcs crawling the edges ---------------------------------------------
  // re-rolled every few frames rather than every frame: at 60fps a new shape
  // per frame is a blur, and holding it is what makes it read as electricity
  const hold = Math.floor(s.i / CRAWL_HOLD);
  const cr = a.rng(3301 + hold * 977);
  const crawlN = 1 + Math.floor((s.wall + s.drive) * 2);
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < crawlN; k += 1) {
    const side = cr() > 0.5 ? -1 : 1;
    const t0 = cr();
    const t1 = Math.min(1, t0 + 0.12 + cr() * 0.3);
    const ex = (t) => cx + side * widthAt(1 - t) / 2;
    ctx.globalAlpha = 0.35 + s.wall * 0.4;
    strokeBolt(
      ctx,
      boltPath(cr, ex(t0), y + h * t0, ex(t1), y + h * t1, unit * 0.02, 3),
      `rgba(${palette.ember.map(Math.round).join(",")},0.35)`,
      bone,
      Math.max(1, unit * 0.0009),
    );
  }

  // --- the strike ----------------------------------------------------------
  const live = decay(s.sinceOnset, STRIKE_LIFE) * Math.max(0, s.hit - 0.3) / 0.7;
  if (live > 0.02) {
    const at = Math.round(s.i - (s.sinceOnset > 1e8 ? 0 : s.sinceOnset));
    const r = a.rng(5501 + at * 313);
    const bolts = 1 + Math.floor(r() * 2.6);
    ctx.globalAlpha = Math.min(1, live * 1.1);
    for (let k = 0; k < bolts; k += 1) {
      const fromTop = r() > 0.45;
      const sx = fromTop ? W * r() : (r() > 0.5 ? -W * 0.02 : W * 1.02);
      const sy = fromTop ? -H * 0.03 : H * r() * 0.8;
      const hitT = 0.1 + r() * 0.8;
      strokeBolt(
        ctx,
        boltPath(r, sx, sy, cx + (r() - 0.5) * widthAt(1 - hitT), y + h * hitT, unit * 0.06, 5),
        `rgba(${palette.ember.map(Math.round).join(",")},0.30)`,
        "#ffffff",
        Math.max(1, unit * 0.0016),
      );
    }
    // The face lights from the strike — as one trapezoid, not as the slice
    // stack. The slices overlap by two pixels so the artwork has no ladder of
    // seams down it, which is right for opaque images drawn over each other
    // and wrong for an additive wash: every overlap would be lit twice and the
    // stone would come out banded.
    ctx.globalAlpha = live * 0.28;
    ctx.fillStyle = bone;
    const topW = widthAt(0);
    const botW = widthAt(1);
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, y);
    ctx.lineTo(cx + topW / 2, y);
    ctx.lineTo(cx + botW / 2, y + h);
    ctx.lineTo(cx - botW / 2, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // --- type ----------------------------------------------------------------
  const alpha = creditAlpha(s);
  const titleSize = Math.round(unit * CREDIT.title);
  const artistSize = Math.round(unit * CREDIT.artist * 0.88);
  const titleY = Math.min(H - unit * 0.06, y + h + unit * 0.10);
  // the type flinches when the stone is struck
  const jolt = live * unit * 0.004;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (a.artist) {
    ctx.font = `${artistSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * 0.028)}px`;
    ctx.fillStyle = ember;
    ctx.globalAlpha = alpha.artist;
    ctx.fillText(a.artist.toUpperCase(), cx, titleY - titleSize * 0.9);
  }

  if (a.title) {
    ctx.font = `${titleSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle * 2)}px`;
    ctx.globalAlpha = alpha.title * 0.35;
    ctx.fillStyle = ember;
    ctx.fillText(a.title.toUpperCase(), cx + jolt, titleY);
    ctx.globalAlpha = alpha.title;
    ctx.fillStyle = bone;
    ctx.fillText(a.title.toUpperCase(), cx - jolt, titleY);
  }
  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.8 + (1 - s.arc) * 0.2;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
