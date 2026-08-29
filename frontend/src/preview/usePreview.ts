import { useCallback, useEffect, useRef, useState } from "react";

import { extractAccent } from "../accent";
import { buildGrain, buildHighlights, samplePixels } from "./assets";
import {
  drawMeters,
  drawStage,
  drawWave,
  idleSpectrum,
  SIGNAL_KEYS,
  type Signals,
} from "./paint";
import { bandBins, bandEdges, follow } from "./signals";

export const FALLBACK_ACCENT = "#d2683a";

export interface PreviewInput {
  image: File | null;
  audio: File | null;
  peaks: Float32Array | null;
  duration: number;
  bands: number;
  artist: string;
  title: string;
  window: { start: number; end: number } | null;
}

export interface Preview {
  stageRef: React.RefObject<HTMLCanvasElement | null>;
  metersRef: React.RefObject<HTMLCanvasElement | null>;
  waveRef: React.RefObject<HTMLCanvasElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  accent: string;
  /** Object URL for the cover, for the thumbnail in the source panel. */
  coverUrl: string | null;
  coverSize: string;
  playing: boolean;
  now: number;
  togglePlay: () => void;
  /** Stops the monitor outright. The result player calls this when it starts,
   *  so the source and the mp4 are never playing over each other. */
  pause: () => void;
  seek: (fraction: number) => void;
}

/** Drives the whole right-hand side of the studio.
 *
 * React never re-renders per frame here: the loop writes straight to the three
 * canvases, and the only state it pushes back is the transport clock. Anything
 * on a 60 Hz path that goes through setState will fight the analyser.
 */
export function usePreview(input: PreviewInput): Preview {
  const stageRef = useRef<HTMLCanvasElement | null>(null);
  const metersRef = useRef<HTMLCanvasElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [accent, setAccent] = useState(FALLBACK_ACCENT);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverSize, setCoverSize] = useState("");
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);

  const cover = useRef<HTMLImageElement | null>(null);
  const highlights = useRef<HTMLCanvasElement | null>(null);
  const grain = useRef<HTMLCanvasElement | null>(null);
  const signals = useRef<Signals>({ kick: 0, crack: 0, wall: 0, hit: 0, rms: 0 });
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const spectrum = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const idle = useRef(idleSpectrum());
  // the clock the UI last saw, so the loop can throttle its own setState
  const shownNow = useRef(0);

  // the loop reads these without re-subscribing every keystroke
  const live = useRef(input);
  live.current = input;
  const liveAccent = useRef(accent);
  liveAccent.current = accent;

  useEffect(() => {
    grain.current = buildGrain();
  }, []);

  /* ---- the cover drives both the bloom layer and the shell's accent ---- */
  useEffect(() => {
    if (!input.image) {
      cover.current = null;
      highlights.current = null;
      setAccent(FALLBACK_ACCENT);
      setCoverUrl(null);
      setCoverSize("");
      return;
    }
    const url = URL.createObjectURL(input.image);
    const image = new Image();
    let live = true;
    image.onload = () => {
      if (!live) return;
      cover.current = image;
      highlights.current = buildHighlights(image);
      setCoverSize(`${image.naturalWidth}×${image.naturalHeight}`);
      const pixels = samplePixels(image);
      setAccent(pixels ? extractAccent(pixels, FALLBACK_ACCENT) : FALLBACK_ACCENT);
    };
    image.onerror = () => {
      if (!live) return;
      cover.current = null;
      highlights.current = null;
      setCoverSize("");
    };
    image.src = url;
    setCoverUrl(url);
    return () => {
      live = false;
      setCoverUrl(null);
      URL.revokeObjectURL(url);
    };
  }, [input.image]);

  /* ---- the master feeds the <audio> element, and nothing else ---- */
  useEffect(() => {
    const el = audioRef.current;
    setPlaying(false);
    shownNow.current = 0;
    setNow(0);
    if (!el || !input.audio) {
      el?.removeAttribute("src");
      return;
    }
    const url = URL.createObjectURL(input.audio);
    el.src = url;
    el.load();
    return () => {
      el.pause();
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [input.audio]);

  /* ---- one analyser for the life of the page ---- */
  const ensureGraph = useCallback(() => {
    if (analyser.current || !audioRef.current) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    try {
      const ac = new Ctor();
      // createMediaElementSource may only be called once per element, which is
      // why the element outlives every file loaded into it
      const source = ac.createMediaElementSource(audioRef.current);
      const node = ac.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0.55;
      source.connect(node);
      node.connect(ac.destination);
      context.current = ac;
      analyser.current = node;
      spectrum.current = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
    } catch {
      // no analyser: the stage falls back to its idle wobble, still usable
    }
  }, []);

  /* Track playback from the element's own events, not from play()'s promise.
     An extension that proxies media elements can leave that promise pending
     forever, and the button would then lie about what the audio is doing. */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    el.addEventListener("play", on);
    el.addEventListener("playing", on);
    el.addEventListener("pause", off);
    el.addEventListener("ended", off);
    return () => {
      el.removeEventListener("play", on);
      el.removeEventListener("playing", on);
      el.removeEventListener("pause", off);
      el.removeEventListener("ended", off);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !live.current.audio) return;
    ensureGraph();
    if (context.current?.state === "suspended") context.current.resume();
    if (el.paused) {
      // the promise is ignored on purpose; the events above are the truth
      el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [ensureGraph]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current;
    const duration = live.current.duration;
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(1, fraction)) * duration;
    shownNow.current = el.currentTime;
    setNow(el.currentTime);
  }, []);

  /* ---- the draw loop ---- */
  useEffect(() => {
    let frame = 0;

    const level = (lo: number, hi: number): number => {
      const node = analyser.current;
      const bins = spectrum.current;
      if (!node || !bins) return 0;
      const sr = context.current?.sampleRate ?? 44100;
      const [a, b] = bandBins(lo, hi, node.fftSize, sr);
      let sum = 0;
      for (let i = a; i <= b; i += 1) sum += bins[i];
      return sum / (b - a + 1) / 255;
    };

    const step = (key: keyof Signals, target: number, attack: number, release: number) => {
      signals.current[key] = follow(signals.current[key], target, attack, release);
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = audioRef.current;
      const running = !!el && !el.paused && !el.ended && !!analyser.current;

      if (el && Math.abs(el.currentTime - shownNow.current) > 0.05) {
        shownNow.current = el.currentTime;
        setNow(el.currentTime);
      }

      if (running && analyser.current && spectrum.current) {
        analyser.current.getByteFrequencyData(spectrum.current);
        step("kick", Math.pow(level(35, 110), 1.6) * 1.5, 0.55, 0.12);
        step("crack", Math.pow(level(1500, 6000), 1.3) * 1.7, 0.7, 0.2);
        step("wall", level(200, 2500) * 1.25, 0.12, 0.07);
        step("hit", Math.pow(level(90, 9000), 2) * 1.8, 0.85, 0.25);
        let sum = 0;
        for (let i = 0; i < spectrum.current.length; i += 1) sum += spectrum.current[i];
        step("rms", (sum / spectrum.current.length / 255) * 1.6, 0.3, 0.1);
      } else {
        // a slow breath, so an idle stage does not look frozen
        const t = performance.now() / 1000;
        step("kick", 0.06 + 0.05 * Math.max(0, Math.sin(t * 1.6)), 0.1, 0.05);
        step("crack", 0.04, 0.1, 0.05);
        step("wall", 0.13 + 0.05 * Math.sin(t * 0.5), 0.05, 0.05);
        step("hit", 0.03, 0.1, 0.05);
        step("rms", 0.1 + 0.03 * Math.sin(t * 0.8), 0.05, 0.05);
      }

      const o = live.current;
      const acc = liveAccent.current;

      if (stageRef.current) {
        drawStage(stageRef.current, {
          cover: cover.current,
          highlights: highlights.current,
          grain: grain.current,
          signals: signals.current,
          accent: acc,
          bands: o.bands,
          artist: o.artist,
          title: o.title,
          sample: running
            ? (i, n) => {
                const [lo, hi] = bandEdges(i, n);
                return level(lo, hi);
              }
            : idle.current,
        });
      }
      if (metersRef.current) drawMeters(metersRef.current, signals.current, acc);
      if (waveRef.current) {
        drawWave(waveRef.current, {
          peaks: o.peaks,
          now: el?.currentTime ?? 0,
          duration: o.duration,
          accent: acc,
          window: o.window,
        });
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const ac = context.current;
    return () => {
      ac?.close().catch(() => {});
    };
  }, []);

  return {
    stageRef,
    metersRef,
    waveRef,
    audioRef,
    accent,
    coverUrl,
    coverSize,
    playing,
    now,
    togglePlay,
    pause,
    seek,
  };
}

export { SIGNAL_KEYS };
