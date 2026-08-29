import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  bufferedAhead,
  CHROME_IDLE_MS,
  chromeVisible,
  fractionAt,
  type Gain,
  type PlayerAction,
  keyAction,
  progressFraction,
  setVolume,
  toRanges,
  toggleMute,
} from "./controls";

export interface PlayerInput {
  gain: Gain;
  onGain: (next: Gain) => void;
  /** Fired when the video starts, so the source monitor can get out of its way. */
  onPlay?: () => void;
}

export interface Player {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The wrapper, not the video: full screen has to take the chrome with it. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  playedRef: React.RefObject<HTMLDivElement | null>;
  headRef: React.RefObject<HTMLDivElement | null>;
  playing: boolean;
  now: number;
  duration: number;
  buffered: number;
  fullscreen: boolean;
  scrubbing: boolean;
  visible: boolean;
  toggle: () => void;
  seekTo: (fraction: number) => void;
  seekBy: (seconds: number) => void;
  nudgeVolume: (delta: number) => void;
  toggleFullscreen: () => void;
  wake: () => void;
  leave: () => void;
  setFocusWithin: (focused: boolean) => void;
  beginScrub: (e: React.PointerEvent<HTMLElement>) => void;
  moveScrub: (e: React.PointerEvent<HTMLElement>) => void;
  endScrub: (e: React.PointerEvent<HTMLElement>) => void;
  handleKey: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/** Wires one video element to the custom chrome.
 *
 * Same discipline as usePreview: playback state comes from the element's own
 * events, never from what play() promised, and the 60 Hz path writes straight
 * to the bar through refs so React stays out of it. */
export function usePlayer({ gain, onGain, onPlay }: PlayerInput): Player {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [buffered, setBuffered] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [idle, setIdle] = useState(false);

  /* the pointer handlers and the rAF loop read these without re-subscribing */
  const scrubbingRef = useRef(false);
  const gainRef = useRef(gain);
  gainRef.current = gain;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

  const visible = chromeVisible({
    paused: !playing,
    pointerInside,
    focusWithin,
    scrubbing,
    idle,
  });

  /* ---- the element's own account of what it is doing ---- */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const readBuffered = () =>
      setBuffered(bufferedAhead(toRanges(el.buffered), el.currentTime, el.duration));

    const on = () => {
      setPlaying(true);
      // fires for autoplay too, which is the collision that actually happens
      onPlayRef.current?.();
    };
    const off = () => setPlaying(false);
    const meta = () => {
      setDuration(el.duration);
      readBuffered();
    };
    const time = () => {
      if (!scrubbingRef.current) setNow(el.currentTime);
      readBuffered();
    };
    const volume = () => {
      const current = gainRef.current;
      if (el.volume !== current.volume || el.muted !== current.muted) {
        onGain({ volume: el.volume, muted: el.muted });
      }
    };

    el.addEventListener("play", on);
    el.addEventListener("playing", on);
    el.addEventListener("pause", off);
    el.addEventListener("ended", off);
    el.addEventListener("loadedmetadata", meta);
    el.addEventListener("durationchange", meta);
    el.addEventListener("timeupdate", time);
    el.addEventListener("seeked", time);
    el.addEventListener("progress", readBuffered);
    el.addEventListener("volumechange", volume);
    return () => {
      el.removeEventListener("play", on);
      el.removeEventListener("playing", on);
      el.removeEventListener("pause", off);
      el.removeEventListener("ended", off);
      el.removeEventListener("loadedmetadata", meta);
      el.removeEventListener("durationchange", meta);
      el.removeEventListener("timeupdate", time);
      el.removeEventListener("seeked", time);
      el.removeEventListener("progress", readBuffered);
      el.removeEventListener("volumechange", volume);
    };
  }, [onGain]);

  /* ---- gain out to the element ---- */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = gain.volume;
    el.muted = gain.muted;
  }, [gain]);

  /* ---- full screen, read from the document and nowhere else ---- */
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // switching aspect tabs unmounts this; do not leave the browser full
      // screen on an element that no longer exists
      if (document.fullscreenElement === rootRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  /* ---- the bar, driven per frame ----
     timeupdate only fires about four times a second, which across a wide bar
     is a visible stutter. The clock text and aria stay on timeupdate; only
     these two writes are on the frame clock. */
  useEffect(() => {
    if (!playing || !visible) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = videoRef.current;
      if (!el || scrubbingRef.current) return;
      const f = progressFraction(el.currentTime, el.duration);
      if (playedRef.current) playedRef.current.style.width = `${f * 100}%`;
      if (headRef.current) headRef.current.style.left = `${f * 100}%`;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, visible]);

  /* ---- the idle timer behind the auto-hide ----
     Deliberately not keyed on `now`: timeupdate fires about four times a
     second, so restarting the countdown on it means the countdown never
     reaches the end and the strip sits on the picture for the whole track.
     Pointer movement is what should postpone the hide, and wake() already
     does that by clearing `idle`. */
  useEffect(() => {
    if (idle) return;
    const timer = window.setTimeout(() => setIdle(true), CHROME_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [idle, playing]);

  const wake = useCallback(() => {
    setPointerInside(true);
    setIdle(false);
  }, []);

  const leave = useCallback(() => {
    setPointerInside(false);
    setIdle(true);
  }, []);

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    // the promise is ignored on purpose; the events above are the truth
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekTo = useCallback((fraction: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const at = Math.max(0, Math.min(1, fraction)) * el.duration;
    el.currentTime = at;
    setNow(at);
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const at = Math.max(0, Math.min(el.duration, el.currentTime + seconds));
    el.currentTime = at;
    setNow(at);
  }, []);

  const nudgeVolume = useCallback(
    (delta: number) => {
      const current = gainRef.current;
      const from = current.muted ? 0 : current.volume;
      onGain(setVolume(current, from + delta));
    },
    [onGain],
  );

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      document.exitFullscreen().catch(() => {});
    } else {
      root.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const scrubAt = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      seekTo(fractionAt(e.clientX, box));
    },
    [seekTo],
  );

  const beginScrub = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      scrubbingRef.current = true;
      setScrubbing(true);
      scrubAt(e);
    },
    [scrubAt],
  );

  const moveScrub = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!scrubbingRef.current) return;
      scrubAt(e);
    },
    [scrubAt],
  );

  const endScrub = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!scrubbingRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    scrubbingRef.current = false;
    setScrubbing(false);
  }, []);

  const run = useCallback(
    (action: PlayerAction) => {
      switch (action.kind) {
        case "toggle":
          toggle();
          break;
        case "seekBy":
          seekBy(action.seconds);
          break;
        case "seekTo":
          seekTo(action.fraction);
          break;
        case "volumeBy":
          nudgeVolume(action.delta);
          break;
        case "mute":
          onGain(toggleMute(gainRef.current));
          break;
        case "fullscreen":
          toggleFullscreen();
          break;
      }
    },
    [nudgeVolume, onGain, seekBy, seekTo, toggle, toggleFullscreen],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      // the volume slider owns its own arrows
      if (e.target instanceof HTMLInputElement && e.key.startsWith("Arrow")) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      wake();
      run(action);
    },
    [run, wake],
  );

  return {
    videoRef,
    rootRef,
    playedRef,
    headRef,
    playing,
    now,
    duration,
    buffered,
    fullscreen,
    scrubbing,
    visible,
    toggle,
    seekTo,
    seekBy,
    nudgeVolume,
    toggleFullscreen,
    wake,
    leave,
    setFocusWithin,
    beginScrub,
    moveScrub,
    endScrub,
    handleKey,
  };
}
