/**
 * SERVICES — where the track can be streamed, burned into the frame.
 *
 * Simplified monochrome marks, tinted to the artwork's bone colour, beside
 * each service's name. No trademarked logo assets enter the repo, and a path
 * scales cleanly from 720p to 4K where a bitmap would not.
 *
 * Drawn once a frame from `viz/main.js`, after the look itself — the row is
 * the same whichever look is chosen, the way the credit line used to be
 * before four looks each drew it slightly differently.
 */
import { off } from "./assets.js";
import { CREDIT } from "./credit.js";

const FONT = `Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A rounded rectangle centred on (x, y), as a filled path. */
function roundedRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + rad, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, rad);
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, rad);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, rad);
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, rad);
  ctx.closePath();
  ctx.fill();
}

/** Start knocking a hole in the mark; `closeKnockout` puts the context back. */
function knockout(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
}

function closeKnockout(ctx) {
  ctx.restore();
}

function markSpotify(ctx, x, y, r) {
  circle(ctx, x, y, r);
  knockout(ctx);
  ctx.lineCap = "round";
  // Three arcs bowing up, widest at the top, concentric about a point below
  // the centre — that shared centre is what stacks them the way the real mark
  // does. How far below decides where the ink lands: too close and they
  // collapse into one squiggle, too far and all three crowd into the lower
  // half and leave a bald gap across the top of the disc. These radii put the
  // ink from 0.42 radii above the centre to 0.42 below it, so the group is
  // balanced in the disc; services.test.js measures exactly that.
  const cy = y + r * 0.83;
  const SPAN = 0.876;
  for (const [rad, width] of [[1.250, 0.170], [0.892, 0.145], [0.534, 0.120]]) {
    ctx.lineWidth = r * width;
    ctx.beginPath();
    ctx.arc(x, cy, r * rad, -Math.PI + SPAN, -SPAN);
    ctx.stroke();
  }
  closeKnockout(ctx);
}

function markApple(ctx, x, y, r) {
  circle(ctx, x, y, r);
  knockout(ctx);
  // a beamed pair of notes: two heads, two stems, one slanted beam
  ctx.beginPath();
  ctx.moveTo(x - r * 0.34, y - r * 0.46);
  ctx.lineTo(x + r * 0.42, y - r * 0.64);
  ctx.lineTo(x + r * 0.42, y - r * 0.40);
  ctx.lineTo(x - r * 0.34, y - r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - r * 0.34, y - r * 0.46, r * 0.11, r * 0.80);
  ctx.fillRect(x + r * 0.31, y - r * 0.64, r * 0.11, r * 0.78);
  for (const [hx, hy] of [[-0.46, 0.34], [0.19, 0.14]]) {
    ctx.beginPath();
    ctx.ellipse(x + r * hx, y + r * hy, r * 0.23, r * 0.17, -0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  closeKnockout(ctx);
}

function markYouTube(ctx, x, y, r) {
  roundedRect(ctx, x, y, r * 1.9, r * 1.3, r * 0.34);
  knockout(ctx);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.18, y - r * 0.34);
  ctx.lineTo(x - r * 0.18, y + r * 0.34);
  ctx.lineTo(x + r * 0.42, y);
  ctx.closePath();
  ctx.fill();
  closeKnockout(ctx);
}

function markSoundCloud(ctx, x, y, r) {
  // a cloud with the waveform running into it, rather than the bare row of
  // bars this used to draw — which was the same glyph Deezer gets
  const base = y + r * 0.52;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = r * 0.15;
  for (const [bx, height] of [[-0.88, 0.34], [-0.68, 0.62], [-0.48, 0.88], [-0.28, 0.72]]) {
    ctx.beginPath();
    ctx.moveTo(x + r * bx, base);
    ctx.lineTo(x + r * bx, base - r * height);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x - r * 0.02, y - r * 0.06, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.44, y + r * 0.14, r * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - r * 0.02, y + r * 0.14, r * 0.46, r * 0.38);
}

function markBandcamp(ctx, x, y, r) {
  roundedRect(ctx, x, y, r * 1.78, r * 1.78, r * 0.30);
  knockout(ctx);
  // the slanted band of the Bandcamp mark, not a generic play triangle
  ctx.beginPath();
  ctx.moveTo(x - r * 0.62, y + r * 0.34);
  ctx.lineTo(x - r * 0.16, y - r * 0.34);
  ctx.lineTo(x + r * 0.62, y - r * 0.34);
  ctx.lineTo(x + r * 0.16, y + r * 0.34);
  ctx.closePath();
  ctx.fill();
  closeKnockout(ctx);
}

function markTidal(ctx, x, y, r) {
  // three diamonds meeting at their vertices, the way the real mark
  // interlocks — they used to float apart with a gap between them
  const d = r * 0.32;
  for (const cx of [x - 2 * d, x, x + 2 * d]) {
    ctx.beginPath();
    ctx.moveTo(cx, y - d);
    ctx.lineTo(cx + d, y);
    ctx.lineTo(cx, y + d);
    ctx.lineTo(cx - d, y);
    ctx.closePath();
    ctx.fill();
  }
}

function markDeezer(ctx, x, y, r) {
  // flat-topped blocks of equal width: Deezer's own shape, and the thing that
  // keeps it readable next to SoundCloud's cloud
  const bw = r * 0.30;
  const gap = r * 0.14;
  const heights = [0.42, 0.72, 1.06, 0.60];
  const total = heights.length * bw + (heights.length - 1) * gap;
  let bx = x - total / 2;
  const base = y + r * 0.56;
  for (const level of heights) {
    ctx.fillRect(bx, base - r * level, bw, r * level);
    bx += bw + gap;
  }
}

function markAmazon(ctx, x, y, r) {
  circle(ctx, x, y, r);
  knockout(ctx);
  ctx.lineCap = "butt";
  ctx.lineWidth = r * 0.15;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.10, r * 0.60, 0.40, Math.PI - 0.40);
  ctx.stroke();
  // the arrowhead the smile ends in — it was drawn a fifth of this size and
  // vanished at badge scale
  ctx.beginPath();
  ctx.moveTo(x + r * 0.34, y + r * 0.02);
  ctx.lineTo(x + r * 0.82, y - r * 0.02);
  ctx.lineTo(x + r * 0.50, y + r * 0.40);
  ctx.closePath();
  ctx.fill();
  closeKnockout(ctx);
}

/** Registry order is draw order: a picker's click order must not reorder the
 *  row on re-render. */
export const SERVICES = {
  spotify: { name: "Spotify", mark: markSpotify },
  apple: { name: "Apple Music", mark: markApple },
  youtube: { name: "YouTube", mark: markYouTube },
  soundcloud: { name: "SoundCloud", mark: markSoundCloud },
  bandcamp: { name: "Bandcamp", mark: markBandcamp },
  tidal: { name: "Tidal", mark: markTidal },
  deezer: { name: "Deezer", mark: markDeezer },
  amazon: { name: "Amazon Music", mark: markAmazon },
};

export const SERVICE_IDS = Object.keys(SERVICES);

/** Share of the frame height the badge row's bottom edge sits at. */
const BOTTOM = 0.975;
const GLYPH = 0.052; // mark diameter, share of unit
const GAP = 0.030; // between items in a row
const ROW_GAP = 0.024; // between rows
const CHAR = 0.0095; // rough width per label character, share of unit

function itemWidth(id, unit) {
  const name = SERVICES[id]?.name ?? "";
  return unit * GLYPH + unit * 0.014 + name.length * unit * CHAR;
}

/**
 * Where each service's mark sits, relative to the centre of the block —
 * pure, and wrapped to a second row rather than overflowing when many
 * services are picked at 9:16.
 *
 * Unknown ids are dropped rather than throwing; an empty selection is an
 * empty layout. Order follows the registry, not the order services were
 * clicked in, so the row is stable.
 */
export function layoutServices(ids, W, unit) {
  const known = new Set(ids.filter((id) => SERVICES[id]));
  const ordered = SERVICE_IDS.filter((id) => known.has(id));
  if (ordered.length === 0) return [];

  const gap = unit * GAP;
  const maxRowW = Math.max(unit * (GLYPH + 0.03), W * 0.86);

  const rows = [[]];
  let rowW = 0;
  for (const id of ordered) {
    const w = itemWidth(id, unit);
    const row = rows[rows.length - 1];
    const next = rowW + (row.length ? gap : 0) + w;
    if (next > maxRowW && row.length > 0) {
      rows.push([{ id, w }]);
      rowW = w;
    } else {
      row.push({ id, w });
      rowW = next;
    }
  }

  const rowH = unit * (GLYPH + ROW_GAP);
  const out = [];
  rows.forEach((row, r) => {
    const totalW = row.reduce((sum, it) => sum + it.w, 0) + gap * (row.length - 1);
    let x = -totalW / 2;
    for (const it of row) {
      out.push({ id: it.id, x: x + it.w / 2, y: r * rowH, w: it.w });
      x += it.w + gap;
    }
  });
  return out;
}

/** How tall the whole block is: the label, plus a row per wrapped row. */
function blockHeight(layout, unit) {
  const rows = Math.max(...layout.map((it) => it.y)) / (unit * (GLYPH + ROW_GAP)) + 1;
  return unit * CREDIT.label * 2.4 + rows * unit * (GLYPH + ROW_GAP);
}

/**
 * The y the badge row begins at, or the frame bottom when nothing is selected.
 *
 * A look asks for this to know where its credit line has to stop. Every look
 * used to hard-code a baseline near the bottom of the frame, which is exactly
 * where the badges go, so picking any service drew the title straight through
 * the row. Pure, and shares `blockHeight` with the drawing below so the space
 * a look reserves and the space the row actually takes cannot drift apart.
 */
export function servicesTop(ids, W, H, unit) {
  const layout = layoutServices(ids, W, unit);
  if (layout.length === 0) return H;
  return H * BOTTOM - blockHeight(layout, unit);
}

/**
 * One mark, baked into its own transparent canvas and cached.
 *
 * The marks knock their detail out with `destination-out`, and the render
 * canvas is created `alpha: false` — so drawing them straight onto the frame
 * erases to *black* rather than to what is behind, and every hole in a mark
 * came out as a black blob. That went unnoticed while the badge row only ever
 * sat on dark ground, but the row sits at 0.975 of the frame height and looks
 * like `pyre` and `emberstorm` put bright fire exactly there.
 *
 * On a surface that has an alpha channel the same knockout is genuinely
 * transparent, so the frame shows through the way it should. Baked once per
 * render — radius and colour are fixed for the whole track — and blitted after.
 */
function markSprite(a, id, r, colour) {
  const cache = (a.serviceMarks ??= new Map());
  const key = `${id}|${Math.round(r)}|${colour}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // the glyph box the layout reserves, plus the slack a round line cap or a
  // stroke's outer half needs
  const pad = Math.ceil(r * 1.15);
  const canvas = off(pad * 2, pad * 2);
  const mc = canvas.getContext("2d");
  mc.fillStyle = colour;
  mc.strokeStyle = colour;
  SERVICES[id].mark(mc, pad, pad, r);

  const sprite = { canvas, pad };
  cache.set(key, sprite);
  return sprite;
}

/** The whole row: label, marks and names, on the shared scrim. Draws nothing
 *  for an empty selection. */
export function drawServices(ctx, ids, a, s) {
  const unit = a.layout.unit;
  const layout = layoutServices(ids, a.W, unit);
  if (layout.length === 0) return;

  const labelH = unit * CREDIT.label * 2.4;
  const blockH = blockHeight(layout, unit);
  const blockW = Math.max(...layout.map((it) => it.x + it.w / 2)) * 2;

  const cx = a.W / 2;
  const top = a.H * BOTTOM - blockH;

  if (a.creditScrim) {
    const x = Math.max(0, cx - blockW / 2 - unit * 0.02);
    const w = Math.min(a.W - x, blockW + unit * 0.04);
    ctx.drawImage(a.creditScrim, 0, 0, 1, 256, x, top, w, blockH);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = a.palette.boneCss;
  ctx.font = `${Math.round(unit * CREDIT.label)}px ${FONT}`;
  ctx.letterSpacing = `${Math.round(unit * 0.010)}px`;
  ctx.globalAlpha = 0.8;
  ctx.fillText("LISTEN ON", cx, top + labelH * 0.7);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;

  const r = unit * GLYPH * 0.5;
  const rowsTop = top + labelH;
  for (const item of layout) {
    const svc = SERVICES[item.id];
    if (!svc) continue;
    const x = cx + item.x;
    const markY = rowsTop + item.y + r;
    const sprite = markSprite(a, item.id, r, a.palette.boneCss);
    ctx.drawImage(sprite.canvas, x - sprite.pad, markY - sprite.pad);
    ctx.fillStyle = a.palette.boneCss;
    ctx.font = `${Math.round(unit * (CREDIT.label * 0.95))}px ${FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(svc.name.toUpperCase(), x, markY + r + unit * 0.020);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}
