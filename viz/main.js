/**
 * The seam render.py drives.
 *
 *   window.vizReady        -> true once every asset is decoded
 *   window.renderFrame(i)  -> draws frame i synchronously
 *   window.meta            -> { frames, fps }
 *
 * Two rules hold everywhere below this point. The frame index is the only
 * clock — no requestAnimationFrame, no Date.now, nothing that would make the
 * same frame come out differently on a slower machine. And no Math.random:
 * every bit of noise is seeded, or the grain crawls and eats bitrate.
 */

import {
  buildBurnMasks,
  buildGrain,
  buildVignette,
  channelSplit,
  paletteFrom,
  Tint,
} from "./assets.js";
import { LOOKS, DEFAULT_LOOK } from "./looks/index.js";
import { css } from "./palette.js";
import { layoutFor } from "./palette.js";
import { lerp, mulberry32, smoothstep } from "./rng.js";
import { Signals } from "./signals.js";

const params = new URLSearchParams(location.search);
const W = +(params.get("w") || 1920);
const H = +(params.get("h") || 1080);
const PREVIEW = params.get("preview") === "1";
const TITLE = params.get("title") || "";
const ARTIST = params.get("artist") || "";
// the uploaded cover keeps its own extension; render.py passes the filename
const ART = params.get("art") || "artwork.jpg";
const LOOK = params.get("look") || DEFAULT_LOOK;

/** How long a section change takes to settle, in seconds. */
const SEAT_EASE = 1.2;

const canvas = document.getElementById("c");
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d", { alpha: false });

/**
 * Where the cover rests during a given section.
 *
 * Derived from the section number through a seeded generator, so it is the
 * same on every render of the same track but different between sections — a
 * chorus does not sit exactly where the verse sat.
 */
function seatFor(section) {
  const r = mulberry32(9781 + section * 5171);
  return {
    scale: 0.95 + r() * 0.09,
    dx: (r() - 0.5) * 0.030,
    dy: (r() - 0.5) * 0.018,
  };
}

async function init() {
  const F = await (await fetch("./frames.json")).json();

  const art = new Image();
  await new Promise((resolve, reject) => {
    art.onload = resolve;
    art.onerror = () => reject(new Error(`${ART} not found`));
    art.src = `./${ART}`;
  });

  const sig = new Signals(F);
  const layout = layoutFor(art.width, art.height, W, H);
  const palette = paletteFrom(art);
  palette.groundCss = css(palette.ground);
  palette.emberCss = css(palette.ember);
  palette.boneCss = css(palette.bone);

  const look = LOOKS[LOOK] ?? LOOKS[DEFAULT_LOOK];
  if (!LOOKS[LOOK]) {
    console.warn(`unknown look "${LOOK}"; falling back to ${DEFAULT_LOOK}`);
  }

  const a = {
    W,
    H,
    art,
    layout,
    palette,
    title: TITLE,
    artist: ARTIST,
    signals: sig,
    burnMasks: buildBurnMasks(art, layout.w, layout.h),
    channels: channelSplit(art, layout.w, layout.h),
    grain: buildGrain(W, H, mulberry32(1337)),
    vignette: buildVignette(W, H),
    tint: new Tint(layout.w, layout.h),
    rng: mulberry32,
    // filled in per frame, below
    seat: seatFor(0),
    progress: 0,
  };

  // seats are the same every frame of a section, so build them once
  const seats = new Map();
  const seat = (n) => {
    if (!seats.has(n)) seats.set(n, seatFor(n));
    return seats.get(n);
  };

  if (typeof look.init === "function") look.init(a);

  const ease = Math.max(1, sig.fps * SEAT_EASE);

  function renderFrame(i) {
    const s = sig.at(i);
    a.progress = sig.frames > 1 ? s.i / (sig.frames - 1) : 0;

    // A section change is a cut in the music but should not be a cut on
    // screen: blend out of the previous seat over about a second. Driven by
    // sinceSection, so it stays a pure function of the frame index.
    const here = seat(s.section);
    const t = smoothstep(s.sinceSection / ease);
    if (t >= 1 || s.section === 0) {
      a.seat = here;
    } else {
      const prev = seat(Math.max(0, s.section - 1));
      a.seat = {
        scale: lerp(prev.scale, here.scale, t),
        dx: lerp(prev.dx, here.dx, t),
        dy: lerp(prev.dy, here.dy, t),
      };
    }

    look.draw(ctx, s, a);
  }

  // A display font that arrived on frame 3 would leave frames 0-2 as the only
  // ones in the fallback face, so wait for it before declaring readiness.
  try {
    await document.fonts.load(`${Math.round(H * 0.0135)}px Display`);
    await document.fonts.ready;
  } catch {
    /* no display font: the fallback stack is the design */
  }

  window.meta = { frames: sig.frames, fps: sig.fps, look: look.id };
  window.renderFrame = renderFrame;
  renderFrame(0);
  window.vizReady = true;

  if (PREVIEW) {
    document.body.classList.add("preview");
    const audio = document.getElementById("audio");
    audio.src = params.get("audio") || "./audio.wav";
    // the only clock in the file, and it exists solely to scrub the preview —
    // render.py never takes this path
    const loop = () => {
      renderFrame(Math.round(audio.currentTime * sig.fps));
      requestAnimationFrame(loop);
    };
    loop();
  }
}

init().catch((err) => {
  console.error(err);
  window.vizError = String(err && err.message ? err.message : err);
});
