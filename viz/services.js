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
import { CREDIT } from "./credit.js";

const FONT = `Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function markSpotify(ctx, x, y, r) {
  circle(ctx, x, y, r);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineWidth = r * 0.16;
  for (const dy of [-0.22, 0.06, 0.34]) {
    ctx.beginPath();
    ctx.arc(x - r * 0.08, y + dy * r, r * 0.58, -0.6, 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function markApple(ctx, x, y, r) {
  circle(ctx, x, y, r);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x + r * 0.5, y - r * 0.5, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(x + r * 0.05, y - r * 0.82, r * 0.14, r * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function markYouTube(ctx, x, y, r) {
  const w = r * 1.9;
  const h = r * 1.3;
  const rad = r * 0.34;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + rad, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, rad);
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, rad);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, rad);
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, rad);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.18, y - r * 0.34);
  ctx.lineTo(x - r * 0.18, y + r * 0.34);
  ctx.lineTo(x + r * 0.42, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function bars(ctx, x, y, r, heights, widthShare, gapShare, riseShare) {
  const bw = r * widthShare;
  const gap = r * gapShare;
  const total = heights.length * bw + (heights.length - 1) * gap;
  let bx = x - total / 2;
  for (const level of heights) {
    const bh = r * riseShare * level;
    ctx.fillRect(bx, y + r * 0.6 - bh, bw, bh);
    bx += bw + gap;
  }
}

function markSoundCloud(ctx, x, y, r) {
  bars(ctx, x, y, r, [0.5, 0.85, 1, 0.7, 0.9, 0.45], 0.22, 0.10, 1.5);
}

function markBandcamp(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r * 0.75, y - r * 0.65);
  ctx.lineTo(x + r * 0.85, y);
  ctx.lineTo(x - r * 0.75, y + r * 0.65);
  ctx.closePath();
  ctx.fill();
}

function markTidal(ctx, x, y, r) {
  const d = r * 0.44;
  for (const dx of [-1.6, 0, 1.6]) {
    ctx.save();
    ctx.translate(x + dx * d, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-d * 0.55, -d * 0.55, d * 1.1, d * 1.1);
    ctx.restore();
  }
}

function markDeezer(ctx, x, y, r) {
  bars(ctx, x, y, r, [0.5, 0.75, 1, 0.65], 0.34, 0.12, 1.3);
}

function markAmazon(ctx, x, y, r) {
  circle(ctx, x, y, r);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.15, r * 0.55, 0.25, Math.PI - 0.25);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.55, y + r * 0.62);
  ctx.lineTo(x + r * 0.80, y + r * 0.50);
  ctx.lineTo(x + r * 0.68, y + r * 0.78);
  ctx.closePath();
  ctx.fill();
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

/** The whole row: label, marks and names, on the shared scrim. Draws nothing
 *  for an empty selection. */
export function drawServices(ctx, ids, a, s) {
  const unit = a.layout.unit;
  const layout = layoutServices(ids, a.W, unit);
  if (layout.length === 0) return;

  const rows = Math.max(...layout.map((it) => it.y)) / (unit * (GLYPH + ROW_GAP)) + 1;
  const labelH = unit * CREDIT.label * 2.4;
  const blockH = labelH + rows * unit * (GLYPH + ROW_GAP);
  const blockW = Math.max(...layout.map((it) => it.x + it.w / 2)) * 2;

  const cx = a.W / 2;
  const bottom = a.H * 0.975;
  const top = bottom - blockH;

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
    ctx.fillStyle = a.palette.boneCss;
    svc.mark(ctx, x, markY, r);
    ctx.font = `${Math.round(unit * (CREDIT.label * 0.95))}px ${FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(svc.name.toUpperCase(), x, markY + r + unit * 0.020);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}
