/** The maths and the state rules behind the result player.
 *
 * Everything here is pure so it can be read without a DOM: the hook next door
 * owns the element and the events, this owns the decisions. */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Where along a box a pointer landed, as a fraction. A box with no width is a
 *  bar that has not been laid out yet — seeking to its start is the safe read. */
export function fractionAt(clientX: number, box: { left: number; width: number }): number {
  if (!Number.isFinite(box.width) || box.width <= 0) return 0;
  return clamp01((clientX - box.left) / box.width);
}

/** The second a fraction of the bar points at. */
export function seekTime(fraction: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp01(fraction) * duration;
}

/** How far in the playhead has got, as a fraction. ``duration`` is NaN until
 *  loadedmetadata fires, which is exactly when the bar first paints. */
export function progressFraction(now: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp01(now / duration);
}

/** The shape of ``video.buffered`` — structural, so tests need no DOM. */
export interface TimeRangeList {
  length: number;
  start(index: number): number;
  end(index: number): number;
}

export function toRanges(
  ranges: TimeRangeList | null | undefined,
): Array<[number, number]> {
  if (!ranges) return [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ranges.length; i += 1) out.push([ranges.start(i), ranges.end(i)]);
  return out;
}

/** How much of the file is ready, as a fraction, reading from the island the
 *  playhead is actually in.
 *
 * The server answers Range requests, so a seek to the far end leaves two
 * disjoint islands with a hole between them. Reading the LAST island — the
 * obvious shortcut — would draw the grey band all the way across and promise
 * playback that is not there. Land in a hole and there is nothing ahead. */
export function bufferedAhead(
  ranges: ReadonlyArray<[number, number]>,
  now: number,
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  for (const [start, end] of ranges) {
    if (now >= start && now <= end) return clamp01(end / duration);
  }
  return progressFraction(now, duration);
}

export interface Gain {
  volume: number;
  muted: boolean;
}

export const DEFAULT_GAIN: Gain = { volume: 1, muted: false };

/** What to come back to when unmuting from a slider dragged to the bottom. */
const AUDIBLE = 0.5;

/** Dragging the slider is also how you mute and unmute: the bottom of the
 *  travel means silence, and moving off it means you want to hear something. */
export function setVolume(gain: Gain, volume: number): Gain {
  if (!Number.isFinite(volume)) return gain;
  const next = clamp01(volume);
  return { volume: next, muted: next === 0 };
}

export function toggleMute(gain: Gain): Gain {
  if (!gain.muted) return { volume: gain.volume, muted: true };
  return { volume: gain.volume > 0 ? gain.volume : AUDIBLE, muted: false };
}

/** Which rungs of the volume glyph are lit. The mark doubles as a meter, so
 *  the level reads without going near the slider. */
export function volumeLevel(gain: Gain): 0 | 1 | 2 | 3 {
  if (gain.muted || !(gain.volume > 0)) return 0;
  if (gain.volume <= 1 / 3) return 1;
  if (gain.volume <= 2 / 3) return 2;
  return 3;
}

export type PlayerAction =
  | { kind: "toggle" }
  | { kind: "seekBy"; seconds: number }
  | { kind: "seekTo"; fraction: number }
  | { kind: "volumeBy"; delta: number }
  | { kind: "mute" }
  | { kind: "fullscreen" };

/** The shortcut a keystroke asks for, or null to let it through.
 *
 * Anything held with ctrl, meta or alt belongs to the browser, not to us. */
export function keyAction(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): PlayerAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  switch (key) {
    case " ":
    case "k":
      return { kind: "toggle" };
    case "ArrowRight":
      return { kind: "seekBy", seconds: 5 };
    case "ArrowLeft":
      return { kind: "seekBy", seconds: -5 };
    case "l":
      return { kind: "seekBy", seconds: 10 };
    case "j":
      return { kind: "seekBy", seconds: -10 };
    case "ArrowUp":
      return { kind: "volumeBy", delta: 0.1 };
    case "ArrowDown":
      return { kind: "volumeBy", delta: -0.1 };
    case "m":
      return { kind: "mute" };
    case "f":
      return { kind: "fullscreen" };
    case "Home":
      return { kind: "seekTo", fraction: 0 };
    case "End":
      return { kind: "seekTo", fraction: 1 };
    default:
      break;
  }

  if (key >= "0" && key <= "9") {
    return { kind: "seekTo", fraction: Number(key) / 10 };
  }
  return null;
}

/** How long the pointer has to sit still before the chrome gets out of the way. */
export const CHROME_IDLE_MS = 2200;

export interface ChromeInput {
  paused: boolean;
  pointerInside: boolean;
  focusWithin: boolean;
  scrubbing: boolean;
  idle: boolean;
}

/** Whether the control strip is on screen.
 *
 * The frame is cut to the video's ratio, so there are no letterbox bars to
 * hide in and the strip always covers picture — it earns that by leaving.
 * ``focusWithin`` is load-bearing: without it a keyboard user would be
 * tabbing through buttons nobody can see. */
export function chromeVisible(c: ChromeInput): boolean {
  return c.paused || c.scrubbing || c.focusWithin || (c.pointerInside && !c.idle);
}
