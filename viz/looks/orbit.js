/**
 * ORBIT — the record, spinning.
 *
 * The cover becomes a disc and the spectrum wraps round it as a ring. The
 * rotation is locked to the beat grid rather than to the frame counter, so it
 * turns at whatever tempo the track is actually at and slows with it, and the
 * twelve chroma classes sit outside the ring as spokes in circle-of-fifths
 * order — the same order that produces the ember's hue, so a key change turns
 * the wheel and moves the colour together.
 *
 * The blur is analytic, not a feedback buffer: the angle at frame i-k is
 * computable, so the ghosts are drawn at the positions the disc actually held.
 * Frame i still depends on nothing but i.
 */

import { css, shiftHue } from "../palette.js";
import { decay } from "../signals.js";

/** Turns of the disc per beat. A quarter turn per beat reads as deliberate. */
const TURN_PER_BEAT = 0.25;
/** How many trailing positions the disc is smeared across. */
const GHOSTS = 5;
const HUE_SPREAD = 0.20;

/** Pitch classes round the circle of fifths — the same order analyze.py uses. */
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const id = "orbit";
export const name = "Orbit";

export function init(a) {
  // the cover, once, as a disc: clipping a circle every frame costs more than
  // the memory, and at 4K it shows
  const size = Math.round(Math.min(a.W, a.H) * 0.52);
  const disc = document.createElement("canvas");
  disc.width = size;
  disc.height = size;
  const c = disc.getContext("2d");
  c.save();
  c.beginPath();
  c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  c.clip();
  // cover the square with the artwork, cropping the long side
  const r = a.art.width / a.art.height;
  const dw = r > 1 ? size * r : size;
  const dh = r > 1 ? size : size / r;
  c.drawImage(a.art, (size - dw) / 2, (size - dh) / 2, dw, dh);
  c.restore();
  a.disc = disc;
  a.discR = size / 2;
}

/** The angle the disc holds at a given frame. Pure, so ghosts are exact. */
function angleAt(sig, i) {
  const s = sig.at(i);
  return (s.beatOrdinal + s.beatPhase) * TURN_PER_BEAT * Math.PI * 2;
}

export function draw(ctx, s, a) {
  const { W, H, palette, disc, discR, tint, burnMasks, grain, vignette, signals } = a;
  const cx = W / 2;
  const cy = H * 0.47;

  const emberRgb = shiftHue(palette.ember, (s.hue - 0.5) * HUE_SPREAD * s.tonal);
  const ember = css(emberRgb);

  ctx.fillStyle = palette.groundCss;
  ctx.fillRect(0, 0, W, H);

  const swell = 1 + s.kick * 0.030 + s.wall * 0.010 + a.seat.scale - 1;
  const R = discR * swell;

  // --- the disc, smeared across where it has just been --------------------
  const now = angleAt(signals, s.i);
  for (let k = GHOSTS; k >= 1; k -= 1) {
    const past = angleAt(signals, s.i - k);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(past);
    ctx.globalAlpha = 0.10 * (1 - k / (GHOSTS + 1)) * (0.4 + s.drive);
    ctx.drawImage(disc, -R, -R, R * 2, R * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(now);
  ctx.drawImage(disc, -R, -R, R * 2, R * 2);
  // the burn, still igniting from the artwork's own highlights
  if (s.kick > 0.03) {
    const level = Math.min(burnMasks.length - 1, Math.floor(s.kick * (burnMasks.length - 0.01)));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, s.kick * 0.85);
    const bloom = R * (1.02 + s.kick * 0.06);
    ctx.drawImage(tint.burn(burnMasks[level], ember), -bloom, -bloom, bloom * 2, bloom * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();

  // the spindle hole, so it reads as a record and not a ball
  ctx.fillStyle = palette.groundCss;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.055, 0, Math.PI * 2);
  ctx.fill();

  // --- the spectrum, wrapped round the rim --------------------------------
  const bands = s.spectrum.length || 1;
  const inner = R * 1.06;
  const reach = Math.min(W, H) * 0.17;
  ctx.strokeStyle = ember;
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(1, (Math.PI * 2 * inner) / bands * 0.62);
  for (let b = 0; b < bands; b += 1) {
    const v = Math.pow(s.spectrum[b], 1.6);
    if (v <= 0.015) continue;
    // start at the top and run clockwise, so band 0 reads as "the bottom end"
    const th = -Math.PI / 2 + (b / bands) * Math.PI * 2 + now * 0.15;
    ctx.globalAlpha = 0.18 + v * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(th) * inner, cy + Math.sin(th) * inner);
    ctx.lineTo(cx + Math.cos(th) * (inner + v * reach), cy + Math.sin(th) * (inner + v * reach));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // a ring that flares on the downbeat
  const flare = s.downbeatPulse * 0.75 + s.beatPulse * 0.25;
  ctx.strokeStyle = ember;
  ctx.lineWidth = Math.max(1, H * 0.0012 * (1 + flare * 4));
  ctx.globalAlpha = 0.16 + flare * 0.45;
  ctx.beginPath();
  ctx.arc(cx, cy, inner * (1 + flare * 0.012), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // --- chroma, as twelve spokes outside the ring --------------------------
  const spokeAt = inner + reach * 1.18;
  const spokeLen = Math.min(W, H) * 0.035;
  ctx.lineWidth = Math.max(1, H * 0.0035);
  ctx.strokeStyle = palette.boneCss;
  for (let n = 0; n < 12; n += 1) {
    const v = s.chroma[FIFTHS[n]] ?? 0;
    if (v <= 0.05) continue;
    const th = -Math.PI / 2 + (n / 12) * Math.PI * 2;
    ctx.globalAlpha = 0.10 + v * 0.55 * (0.3 + s.tonal);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(th) * spokeAt, cy + Math.sin(th) * spokeAt);
    ctx.lineTo(
      cx + Math.cos(th) * (spokeAt + spokeLen * v),
      cy + Math.sin(th) * (spokeAt + spokeLen * v),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- a stab of light on the hardest transients --------------------------
  const stab = decay(s.sinceOnset, 7) * Math.max(0, s.hit - 0.45) * 2;
  if (stab > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = stab * 0.5;
    ctx.fillStyle = ember;
    ctx.fillRect(0, cy - H * 0.0016, W, H * 0.0032);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- credit line, sitting under the disc --------------------------------
  if (a.artist || a.title) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${Math.round(H * 0.008)}px`;
    ctx.fillStyle = ember;
    ctx.font = `${Math.round(H * 0.016)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.globalAlpha = 0.5 + s.crack * 0.3;
    ctx.fillText(a.artist.toUpperCase(), cx, H * 0.90);
    ctx.fillStyle = palette.boneCss;
    ctx.font = `${Math.round(H * 0.030)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.globalAlpha = 0.72 + s.crack * 0.24;
    ctx.fillText(a.title.toUpperCase(), cx, H * 0.955);
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
    ctx.textAlign = "left";
  }

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.03;
  ctx.drawImage(grain[s.i % grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.75 + (1 - s.arc) * 0.25;
  ctx.drawImage(vignette, 0, 0);
  ctx.globalAlpha = 1;
}
