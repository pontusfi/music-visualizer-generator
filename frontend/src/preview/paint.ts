import { mulberry32 } from "./signals";

export interface Signals {
  kick: number;
  crack: number;
  wall: number;
  hit: number;
  rms: number;
}

export const SIGNAL_KEYS: Array<keyof Signals> = [
  "kick",
  "crack",
  "wall",
  "hit",
  "rms",
];

export interface Fitted {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
}

/** Match the backing store to the CSS box, once per size change. */
export function fitCanvas(canvas: HTMLCanvasElement): Fitted | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return null;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  return ctx ? { ctx, w, h, dpr } : null;
}

/** letterSpacing is Chrome-only. Setting it through a cast keeps the tracking
 *  in the browsers that have it without breaking the ones that do not. */
function setTracking(ctx: CanvasRenderingContext2D, value: string): void {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = value;
}

export interface StageOptions {
  cover: HTMLImageElement | null;
  highlights: HTMLCanvasElement | null;
  grain: HTMLCanvasElement | null;
  signals: Signals;
  accent: string;
  bands: number;
  /** Level for band i of n, in 0..1. */
  sample: (index: number, count: number) => number;
  artist: string;
  title: string;
}

/** The preview of what the render will look like. Deliberately an impression,
 *  not a simulation — the mp4 is drawn from the frame table, not from this. */
export function drawStage(canvas: HTMLCanvasElement, o: StageOptions): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  const s = o.signals;

  ctx.fillStyle = "#08080a";
  ctx.fillRect(0, 0, w, h);

  if (o.cover) {
    const scale = 1 + s.kick * 0.035 + s.wall * 0.012;
    const ratio = o.cover.naturalWidth / o.cover.naturalHeight;
    let dw = w;
    let dh = h;
    if (ratio > w / h) dw = h * ratio;
    else dh = w / ratio;
    dw *= scale;
    dh *= scale;

    ctx.globalAlpha = 0.92;
    ctx.drawImage(o.cover, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;

    // the scrim lifts with the music, so loud passages read brighter
    ctx.fillStyle = `rgba(8,8,10,${0.44 - s.rms * 0.16})`;
    ctx.fillRect(0, 0, w, h);

    if (o.highlights) {
      ctx.globalCompositeOperation = "lighter";
      const bloom = 1.14 + s.kick * 0.1;
      ctx.globalAlpha = 0.18 + s.kick * 0.5;
      ctx.drawImage(
        o.highlights,
        (w - dw * bloom) / 2,
        (h - dh * bloom) / 2,
        dw * bloom,
        dh * bloom,
      );
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, w * 0.7);
    g.addColorStop(0, "#141416");
    g.addColorStop(1, "#08080a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* Sizes and the offsets that anchor them to the bottom edge key off the short
     edge, not the height: in a 9:16 box the height is the long one, and type
     scaled to it comes out nearly twice too big. At 16:9 the short edge IS the
     height, so this is the landscape preview unchanged. */
  const unit = Math.min(w, h);

  const pad = w * 0.055;
  const slot = (w - pad * 2) / o.bands;
  for (let i = 0; i < o.bands; i += 1) {
    const v = Math.max(0, Math.min(1, o.sample(i, o.bands)));
    const bh = Math.pow(v, 1.25) * unit * 0.3;
    ctx.fillStyle = o.accent;
    ctx.globalAlpha = 0.28 + v * 0.6;
    ctx.fillRect(pad + i * slot + slot * 0.16, h - unit * 0.075 - bh, slot * 0.68, bh);
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = o.accent;
  ctx.fillRect(pad, h - unit * 0.075, w - pad * 2, Math.max(1, unit * 0.0022));
  ctx.globalAlpha = 1;

  const artist = o.artist.toUpperCase();
  const title = o.title.toUpperCase();
  if (artist || title) {
    ctx.textBaseline = "alphabetic";
    setTracking(ctx, `${unit * 0.006}px`);
    ctx.fillStyle = o.accent;
    ctx.font = `600 ${unit * 0.036}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.fillText(artist, pad, h - unit * 0.155);
    ctx.fillStyle = "#f2f0ec";
    ctx.font = `700 ${unit * 0.078}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.fillText(title, pad, h - unit * 0.075);
    setTracking(ctx, "0px");
  }

  if (o.grain) {
    const pattern = ctx.createPattern(o.grain, "repeat");
    if (pattern) {
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.055 + s.crack * 0.05;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    unit * 0.2,
    w / 2,
    h / 2,
    unit * 0.85,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/** The five levels the renderer actually keys off, as segmented bars. */
export function drawMeters(
  canvas: HTMLCanvasElement,
  signals: Signals,
  accent: string,
): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h, dpr } = fit;

  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, w, h);

  const padL = 14 * dpr;
  const padR = 18 * dpr;
  const col = (w - padL - padR) / SIGNAL_KEYS.length;

  SIGNAL_KEYS.forEach((key, i) => {
    const x0 = padL + i * col;
    const v = Math.max(0, Math.min(1, signals[key]));

    ctx.font = `400 ${9 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textBaseline = "top";
    setTracking(ctx, `${1.4 * dpr}px`);
    ctx.fillStyle = "#5b5a58";
    ctx.fillText(key.toUpperCase(), x0, 11 * dpr);
    ctx.fillStyle = "#8b8a87";
    ctx.fillText(v.toFixed(2), x0 + col - 42 * dpr, 11 * dpr);
    setTracking(ctx, "0px");

    const y = 30 * dpr;
    const bh = 7 * dpr;
    const bw = col - 26 * dpr;
    ctx.fillStyle = "#17171a";
    ctx.fillRect(x0, y, bw, bh);
    ctx.fillStyle = accent;
    ctx.fillRect(x0, y, bw * v, bh);

    // notch it into segments, the way a hardware meter reads
    ctx.fillStyle = "#0d0d0f";
    for (let seg = 1; seg < 14; seg += 1) {
      ctx.fillRect(x0 + (bw / 14) * seg - dpr * 0.5, y, dpr, bh);
    }
  });
}

export interface WaveOptions {
  peaks: Float32Array | null;
  now: number;
  duration: number;
  accent: string;
  /** The test window, drawn as a bracket over the wave. */
  window: { start: number; end: number } | null;
}

export function drawWave(canvas: HTMLCanvasElement, o: WaveOptions): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;

  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, w, h);

  const played = o.duration > 0 ? Math.min(1, o.now / o.duration) : 0;

  if (!o.peaks || o.peaks.length === 0) {
    ctx.fillStyle = "#26262b";
    ctx.fillRect(0, h / 2 - 1, w, 2);
  } else {
    const n = o.peaks.length;
    const bw = w / n;
    for (let i = 0; i < n; i += 1) {
      const bh = Math.max(1, Math.pow(o.peaks[i], 0.75) * h * 0.86);
      ctx.fillStyle = i / n <= played ? o.accent : "#33333a";
      ctx.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.6), bh);
    }
  }

  if (o.window && o.duration > 0) {
    const a = (Math.max(0, o.window.start) / o.duration) * w;
    const b = (Math.min(o.duration, o.window.end) / o.duration) * w;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(a, 0, b - a, h);
    ctx.fillStyle = "#e7e6e3";
    ctx.fillRect(a, 0, 1, h);
    ctx.fillRect(b - 1, 0, 1, h);
  }

  if (played > 0) {
    ctx.fillStyle = "#f2f0ec";
    ctx.fillRect(played * w - 1, 0, 2, h);
  }
}

/** The wobble the spectrum shows with nothing playing: enough motion to prove
 *  the stage is alive, seeded so it is the same wobble every time. */
export function idleSpectrum(seed = 1337): (i: number, n: number) => number {
  const random = mulberry32(seed);
  const jitter = Array.from({ length: 64 }, () => random() * 0.04);
  return (i, n) =>
    0.1 + 0.09 * Math.sin(performance.now() / 900 + (i / n) * 12) + jitter[i % 64];
}
