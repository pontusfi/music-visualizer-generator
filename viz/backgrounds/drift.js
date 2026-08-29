/**
 * DRIFT — soft diagonal bands, sliding.
 *
 * The quietest of the five, and the default: nothing ignites, nothing flares
 * on a beat. Soft diagonal bands between the artwork's own ground and ember
 * colours cross the frame at a slow, constant pace, and the pitch between
 * them breathes with the low end. Chosen as the default because it changes
 * an existing render the least — every look used to open on a flat fill of
 * (roughly) this same ground colour.
 *
 * Baked once as a 2W-wide sheet at init; drawn as a single windowed
 * `drawImage` a frame, the way `buildGrain`'s sheets are.
 */
import { off } from "../assets.js";
import { css } from "../palette.js";

export const id = "drift";
export const name = "Drift";

/** Share of W one ground-to-ember-to-ground band pair spans. */
const PERIOD = 0.22;
/** How far the sheet slides per frame, as a share of W. */
const SPEED = 0.00042;
/** How far the diagonal rises over the sheet's width, as a share of H. */
const RISE = 0.22;

/** Where in the baked sheet frame `i` samples from, and how wide the window
 *  is stretched — pure, so it is testable without a canvas. */
export function driftWindow(i, W, wall = 0) {
  const w = Math.max(1, W | 0);
  const speed = w * SPEED;
  const offset = (((i * speed) % w) + w) % w;
  const pitch = 1 + Math.max(0, Math.min(1, wall)) * 0.35;
  return { offset, pitch };
}

export function init(a) {
  const { W, H, palette } = a;
  const bandW = Math.max(8, Math.round(W * PERIOD));
  const rise = Math.round(H * RISE);

  // built oversized and pre-rotated, so the per-frame draw is a single
  // upright windowed blit with no rotation cost at all
  const pad = Math.round(Math.max(W, H) * 0.6);
  const bigW = W * 2 + pad * 2;
  const bigH = H + pad * 2;
  const big = off(bigW, bigH);
  const bc = big.getContext("2d");
  const ground = css(palette.ground);
  const ember = css(palette.ember);
  for (let x = -bandW * 2; x < bigW; x += bandW * 2) {
    const g = bc.createLinearGradient(x, 0, x + bandW * 2, 0);
    g.addColorStop(0, ground);
    g.addColorStop(0.5, ember);
    g.addColorStop(1, ground);
    bc.fillStyle = g;
    bc.fillRect(x, 0, bandW * 2 + 1, bigH);
  }

  const sheet = off(W * 2, H);
  const sc = sheet.getContext("2d");
  sc.save();
  sc.translate(sheet.width / 2, H / 2);
  sc.rotate(Math.atan2(rise, W));
  sc.drawImage(big, -bigW / 2, -bigH / 2);
  sc.restore();

  a.bgDrift = sheet;
}

export function draw(ctx, s, a) {
  const { W, H, bgDrift } = a;
  const { offset, pitch } = driftWindow(s.i, W, s.wall);
  const dw = W * pitch;
  ctx.drawImage(bgDrift, offset, 0, W, H, (W - dw) / 2, 0, dw, H);
}
