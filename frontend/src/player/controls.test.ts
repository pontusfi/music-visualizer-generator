import { describe, expect, it } from "vitest";

import {
  bufferedAhead,
  chromeVisible,
  DEFAULT_GAIN,
  fractionAt,
  keyAction,
  progressFraction,
  seekTime,
  setVolume,
  toRanges,
  toggleMute,
  volumeLevel,
} from "./controls";

describe("fractionAt", () => {
  const box = { left: 100, width: 200 };

  it("reads the middle of the box as a half", () => {
    expect(fractionAt(200, box)).toBeCloseTo(0.5, 6);
  });

  it("reads the two edges as nothing and everything", () => {
    expect(fractionAt(100, box)).toBe(0);
    expect(fractionAt(300, box)).toBe(1);
  });

  it("clamps a pointer dragged past either edge", () => {
    expect(fractionAt(-50, box)).toBe(0);
    expect(fractionAt(9000, box)).toBe(1);
  });

  it("gives up on a box with no width rather than dividing by zero", () => {
    expect(fractionAt(150, { left: 100, width: 0 })).toBe(0);
    expect(fractionAt(150, { left: 100, width: Number.NaN })).toBe(0);
  });
});

describe("seekTime", () => {
  it("scales a fraction into seconds", () => {
    expect(seekTime(0.5, 200)).toBeCloseTo(100, 6);
  });

  it("clamps a fraction that came in out of range", () => {
    expect(seekTime(-1, 200)).toBe(0);
    expect(seekTime(2, 200)).toBe(200);
  });

  it("is zero before the metadata lands", () => {
    expect(seekTime(0.5, Number.NaN)).toBe(0);
    expect(seekTime(0.5, 0)).toBe(0);
  });
});

describe("progressFraction", () => {
  it("is the share of the duration played", () => {
    expect(progressFraction(30, 120)).toBeCloseTo(0.25, 6);
  });

  it("is zero before the metadata lands", () => {
    expect(progressFraction(30, Number.NaN)).toBe(0);
    expect(progressFraction(30, 0)).toBe(0);
  });

  it("never reads past the end", () => {
    expect(progressFraction(200, 120)).toBe(1);
  });
});

describe("toRanges", () => {
  it("flattens a TimeRanges-shaped object into pairs", () => {
    const ranges = {
      length: 2,
      start: (i: number) => [0, 300][i],
      end: (i: number) => [20, 340][i],
    };
    expect(toRanges(ranges)).toEqual([
      [0, 20],
      [300, 340],
    ]);
  });

  it("copes with the empty list a video has before it loads", () => {
    expect(toRanges(null)).toEqual([]);
    expect(toRanges(undefined)).toEqual([]);
    expect(toRanges({ length: 0, start: () => 0, end: () => 0 })).toEqual([]);
  });
});

describe("bufferedAhead", () => {
  // a seek to the far end leaves two islands, and the last one is not the one
  // being played — reading its end would claim the whole file was ready
  const islands: Array<[number, number]> = [
    [0, 20],
    [300, 340],
  ];

  it("reports the end of the island holding the playhead, not the last one", () => {
    expect(bufferedAhead(islands, 5, 400)).toBeCloseTo(0.05, 6);
  });

  it("follows the playhead into the second island", () => {
    expect(bufferedAhead(islands, 310, 400)).toBeCloseTo(0.85, 6);
  });

  it("claims nothing ahead when the playhead sits in a gap", () => {
    expect(bufferedAhead(islands, 100, 400)).toBeCloseTo(0.25, 6);
  });

  it("has nothing to report before the metadata lands", () => {
    expect(bufferedAhead([], 0, 0)).toBe(0);
    expect(bufferedAhead(islands, 5, Number.NaN)).toBe(0);
  });

  it("never reads past the end", () => {
    expect(bufferedAhead([[0, 500]], 10, 400)).toBe(1);
  });
});

describe("setVolume", () => {
  it("clamps to the audible range", () => {
    expect(setVolume(DEFAULT_GAIN, 1.4).volume).toBe(1);
    expect(setVolume(DEFAULT_GAIN, -0.2).volume).toBe(0);
  });

  it("mutes when the slider is dragged to the bottom", () => {
    expect(setVolume(DEFAULT_GAIN, 0)).toEqual({ volume: 0, muted: true });
  });

  it("unmutes when the slider is dragged back up", () => {
    expect(setVolume({ volume: 0, muted: true }, 0.4)).toEqual({
      volume: 0.4,
      muted: false,
    });
  });

  it("ignores a value that is not a number", () => {
    const gain = { volume: 0.3, muted: false };
    expect(setVolume(gain, Number.NaN)).toEqual(gain);
  });
});

describe("toggleMute", () => {
  it("round-trips an ordinary volume", () => {
    const gain = { volume: 0.7, muted: false };
    expect(toggleMute(gain)).toEqual({ volume: 0.7, muted: true });
    expect(toggleMute(toggleMute(gain))).toEqual(gain);
  });

  it("gives back something audible when unmuting from silence", () => {
    const next = toggleMute({ volume: 0, muted: true });
    expect(next.muted).toBe(false);
    expect(next.volume).toBeGreaterThan(0);
  });
});

describe("volumeLevel", () => {
  it("is dark when muted, whatever the volume says", () => {
    expect(volumeLevel({ volume: 0.9, muted: true })).toBe(0);
    expect(volumeLevel({ volume: 0, muted: false })).toBe(0);
  });

  it("lights one rung per third", () => {
    expect(volumeLevel({ volume: 0.2, muted: false })).toBe(1);
    expect(volumeLevel({ volume: 0.5, muted: false })).toBe(2);
    expect(volumeLevel({ volume: 0.9, muted: false })).toBe(3);
  });

  it("puts the boundaries in the lower rung", () => {
    expect(volumeLevel({ volume: 1 / 3, muted: false })).toBe(1);
    expect(volumeLevel({ volume: 2 / 3, muted: false })).toBe(2);
  });
});

describe("keyAction", () => {
  it("plays and pauses on space and on k", () => {
    expect(keyAction({ key: " " })).toEqual({ kind: "toggle" });
    expect(keyAction({ key: "k" })).toEqual({ kind: "toggle" });
  });

  it("nudges five seconds with the arrows and ten with j and l", () => {
    expect(keyAction({ key: "ArrowRight" })).toEqual({ kind: "seekBy", seconds: 5 });
    expect(keyAction({ key: "ArrowLeft" })).toEqual({ kind: "seekBy", seconds: -5 });
    expect(keyAction({ key: "l" })).toEqual({ kind: "seekBy", seconds: 10 });
    expect(keyAction({ key: "j" })).toEqual({ kind: "seekBy", seconds: -10 });
  });

  it("moves the volume with the up and down arrows", () => {
    expect(keyAction({ key: "ArrowUp" })).toEqual({ kind: "volumeBy", delta: 0.1 });
    expect(keyAction({ key: "ArrowDown" })).toEqual({ kind: "volumeBy", delta: -0.1 });
  });

  it("mutes on m and goes full screen on f", () => {
    expect(keyAction({ key: "m" })).toEqual({ kind: "mute" });
    expect(keyAction({ key: "f" })).toEqual({ kind: "fullscreen" });
  });

  it("jumps to the ends and to a tenth on the number row", () => {
    expect(keyAction({ key: "Home" })).toEqual({ kind: "seekTo", fraction: 0 });
    expect(keyAction({ key: "End" })).toEqual({ kind: "seekTo", fraction: 1 });
    expect(keyAction({ key: "0" })).toEqual({ kind: "seekTo", fraction: 0 });
    expect(keyAction({ key: "7" })).toEqual({ kind: "seekTo", fraction: 0.7 });
  });

  it("does not care about the shift key", () => {
    expect(keyAction({ key: "K" })).toEqual({ kind: "toggle" });
    expect(keyAction({ key: "F" })).toEqual({ kind: "fullscreen" });
  });

  it("keeps its hands off the shortcuts the browser owns", () => {
    expect(keyAction({ key: "f", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "f", metaKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
  });

  it("ignores a key it has no use for", () => {
    expect(keyAction({ key: "q" })).toBeNull();
    expect(keyAction({ key: "Tab" })).toBeNull();
  });
});

describe("chromeVisible", () => {
  const playing = {
    paused: false,
    pointerInside: false,
    focusWithin: false,
    scrubbing: false,
    idle: true,
  };

  it("gets out of the way once the pointer goes quiet mid-playback", () => {
    expect(chromeVisible(playing)).toBe(false);
  });

  it("stays up while the video is paused", () => {
    expect(chromeVisible({ ...playing, paused: true })).toBe(true);
  });

  it("comes back the moment the pointer moves", () => {
    expect(chromeVisible({ ...playing, pointerInside: true, idle: false })).toBe(true);
  });

  it("hides again when the pointer rests over the picture", () => {
    expect(chromeVisible({ ...playing, pointerInside: true, idle: true })).toBe(false);
  });

  it("stays up for a keyboard user inside the controls", () => {
    expect(chromeVisible({ ...playing, focusWithin: true })).toBe(true);
  });

  it("stays up while a drag is in flight, even off the frame", () => {
    expect(chromeVisible({ ...playing, scrubbing: true })).toBe(true);
  });
});
