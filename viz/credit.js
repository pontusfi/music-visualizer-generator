/**
 * CREDIT — the artist / title line, and the plate it sits on.
 *
 * Four looks used to each draw this block themselves, at a size and opacity
 * nothing kept in step between them — and none of it matched what the preview
 * promised. One shared renderer now owns it: sized off `unit` like everything
 * else, and floored rather than ranged for opacity, so the credit reads as
 * information rather than as decoration.
 */

const FONT = `Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;

/** Shares of `unit` = min(W, H). ~28px / 56px artist / title at 1080p. */
export const CREDIT = {
  artist: 0.026,
  title: 0.052,
  label: 0.011,
  // letter tracking, per line — proportionally tighter as the type grows
  trackArtist: 0.008,
  trackTitle: 0.004,
};

/** Gap between the artist and title baselines, and the plate's own padding.
 *  All in shares of `unit`. */
const LINE_GAP = 0.030;
const PAD_X = 0.018;
const PAD_TOP = 0.030;
const PAD_BOTTOM = 0.016;

/**
 * { artist, title } alpha for the current frame.
 *
 * A floor, not a range: the music still moves the type, but only ever upward
 * from a level that is already legible on its own. That is the whole fix —
 * the old ranges opened as low as 0.30.
 */
export function creditAlpha(s) {
  const crack = Math.max(0, Math.min(1, s?.crack ?? 0));
  return {
    artist: Math.min(1, 0.80 + crack * 0.20),
    title: Math.min(1, 0.92 + crack * 0.08),
  };
}

/**
 * Where the credit block sits, and how tall it is — pure, so the plate behind
 * the type and the type itself can never drift apart.
 *
 * `place` is `{ x, y, align, width? }`: `y` is the *title* baseline (the
 * line nearest the anchor edge in every look that uses this), `x` the anchor,
 * `align` which edge of the block that anchor is ("left" or "center"), and
 * `width` an optional override of the plate's width share of `unit`.
 *
 * Returns `null` when there is nothing to draw — an empty artist and title
 * produce no box, not a blank plate.
 */
export function creditBox(a, place) {
  if (!a.artist && !a.title) return null;

  const unit = a.layout.unit;
  const titleSize = unit * CREDIT.title;
  const artistSize = unit * CREDIT.artist;
  const gap = unit * LINE_GAP;
  const artistY = place.y - artistSize - gap;

  const top = artistY - artistSize * 0.85 - unit * PAD_TOP;
  const bottom = place.y + titleSize * 0.25 + unit * PAD_BOTTOM;
  const h = Math.max(0, bottom - top);

  // the exact width of either line is unknown without a context to measure
  // with, so the plate takes a share of `unit` instead — wide enough for a
  // long line at every resolution tier, tight enough not to paint half the
  // frame behind a two-word title
  const w = Math.min(a.W, place.width ?? unit * 0.62);
  const padX = unit * PAD_X;
  const left =
    place.align === "center" ? place.x - w / 2 - padX : place.x - padX;
  const x = Math.max(0, Math.min(a.W - (w + padX * 2), left));
  const y = Math.max(0, Math.min(a.H - h, top));

  return { x, y, w: w + padX * 2, h };
}

/** The credit line itself, plate included. `place` is as in `creditBox`. */
export function drawCredit(ctx, s, a, place) {
  const box = creditBox(a, place);
  if (!box) return;

  const unit = a.layout.unit;
  const alpha = creditAlpha(s);
  const align = place.align === "center" ? "center" : "left";

  const titleSize = Math.round(unit * CREDIT.title);
  const artistSize = Math.round(unit * CREDIT.artist);
  const gap = unit * LINE_GAP;
  const artistY = place.y - artistSize - gap;
  const padX = unit * PAD_X;

  // creditBox's width is an estimate — good enough for the tests, which have
  // no canvas to measure with — but a long line needs the plate to actually
  // reach it, or the type sits half off its own scrim. Widen to whichever is
  // bigger now that a real context is in hand.
  let plateX = box.x;
  let plateW = box.w;
  ctx.font = `${artistSize}px ${FONT}`;
  const artistW = a.artist ? ctx.measureText(a.artist.toUpperCase()).width : 0;
  ctx.font = `${titleSize}px ${FONT}`;
  const titleW = a.title ? ctx.measureText(a.title.toUpperCase()).width : 0;
  const textW = Math.max(artistW, titleW) + padX * 2;
  if (textW > plateW) {
    plateW = Math.min(a.W, textW);
    const anchorX = align === "center" ? place.x : place.x - padX;
    const left = align === "center" ? anchorX - plateW / 2 : anchorX;
    plateX = Math.max(0, Math.min(a.W - plateW, left));
  }

  if (a.creditScrim) {
    ctx.drawImage(a.creditScrim, 0, 0, 1, 256, plateX, box.y, plateW, box.h);
  }

  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = a.palette.boneCss;

  if (a.artist) {
    ctx.font = `${artistSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackArtist)}px`;
    ctx.globalAlpha = alpha.artist;
    ctx.fillText(a.artist.toUpperCase(), place.x, artistY);
  }

  if (a.title) {
    ctx.font = `${titleSize}px ${FONT}`;
    ctx.letterSpacing = `${Math.round(unit * CREDIT.trackTitle)}px`;
    ctx.globalAlpha = alpha.title;
    ctx.fillText(a.title.toUpperCase(), place.x, place.y);
  }

  ctx.globalAlpha = 1;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
}
