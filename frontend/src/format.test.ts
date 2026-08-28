import { describe, expect, it } from "vitest";

import {
  estimateRenderMinutes,
  formatApprox,
  logTone,
  formatBytes,
  formatClock,
  formatEta,
  frameCount,
  stateLabel,
} from "./format";

describe("formatClock", () => {
  it("renders under an hour as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(204)).toBe("3:24");
  });

  it("renders an hour or more as h:mm:ss", () => {
    expect(formatClock(3723)).toBe("1:02:03");
  });

  it("survives nonsense", () => {
    expect(formatClock(NaN)).toBe("--:--");
    expect(formatClock(-1)).toBe("--:--");
  });
});

describe("formatBytes", () => {
  it("scales to a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(13_000_000)).toBe("12.4 MB");
  });
});

describe("formatEta", () => {
  it("is blank when there is nothing to say", () => {
    expect(formatEta(null)).toBe("");
    expect(formatEta(undefined)).toBe("");
  });

  it("uses seconds under a minute and minutes above it", () => {
    expect(formatEta(35)).toBe("~35s left");
    expect(formatEta(240)).toBe("~4 min left");
  });

  it("uses hours for a long render", () => {
    expect(formatEta(7200)).toBe("~2.0 h left");
  });
});

describe("frameCount", () => {
  it("is duration times fps", () => {
    expect(frameCount(60, 30)).toBe(1800);
  });

  it("counts only the preview window when one is set", () => {
    expect(frameCount(480, 60, { start: 30, end: 45 })).toBe(900);
  });

  it("clamps a window that runs past the end of the track", () => {
    expect(frameCount(40, 60, { start: 30, end: 90 })).toBe(600);
  });

  it("is zero for a window that starts past the end", () => {
    expect(frameCount(20, 60, { start: 30, end: 45 })).toBe(0);
  });
});

describe("estimateRenderMinutes", () => {
  it("tracks the measured ~11 fps at 720p", () => {
    // 8 minutes at 60 fps is 28,800 frames -> ~44 min
    const minutes = estimateRenderMinutes(480, 60, 720);
    expect(minutes).toBeGreaterThan(35);
    expect(minutes).toBeLessThan(55);
  });

  it("is slower at 1080p than at 720p", () => {
    expect(estimateRenderMinutes(480, 60, 1080)).toBeGreaterThan(
      estimateRenderMinutes(480, 60, 720),
    );
  });

  it("halves with half the frames", () => {
    const full = estimateRenderMinutes(480, 60, 1080);
    const half = estimateRenderMinutes(240, 60, 1080);
    expect(half).toBeCloseTo(full / 2, 1);
  });

  it("doubles when one upload is cut for both aspects", () => {
    const one = estimateRenderMinutes(480, 60, 1080, null, 1);
    const two = estimateRenderMinutes(480, 60, 1080, null, 2);
    expect(two).toBeCloseTo(one * 2, 5);
  });

  it("quotes one video when it is not told how many", () => {
    expect(estimateRenderMinutes(480, 60, 1080, null)).toBeCloseTo(
      estimateRenderMinutes(480, 60, 1080, null, 1),
      5,
    );
  });

  it("costs a portrait cut the same as the landscape one at the same tier", () => {
    // 1080x1920 and 1920x1080 are the same number of pixels; keying the rate
    // off the frame height alone quoted the portrait render as 4K
    const landscape = estimateRenderMinutes(480, 60, Math.min(1920, 1080));
    const portrait = estimateRenderMinutes(480, 60, Math.min(1080, 1920));
    expect(portrait).toBe(landscape);
  });
});

describe("stateLabel", () => {
  it("names every state the server can report", () => {
    for (const state of [
      "queued",
      "analyzing",
      "rendering",
      "done",
      "failed",
      "cancelled",
    ] as const) {
      expect(stateLabel(state)).toMatch(/\w/);
    }
  });
});

describe("logTone", () => {
  it("marks the lines that start a stage, so the eye can find them", () => {
    expect(logTone("analyze.py master.wav --fps 60 --bands 24")).toBe("step");
    expect(logTone("render.py -w 1920 -H 1080 --fps 60 --crf 16")).toBe("step");
    expect(logTone("ffmpeg: yuv420p h264 · slow · muxed")).toBe("step");
  });

  it("marks failures", () => {
    expect(logTone("Traceback (most recent call last):")).toBe("bad");
    expect(logTone("RuntimeError: encoder terminated")).toBe("bad");
    expect(logTone("ffmpeg: pipe closed unexpectedly")).toBe("bad");
    expect(logTone("  error: could not decode")).toBe("bad");
  });

  it("leaves ordinary progress plain", () => {
    expect(logTone("frame 10,238/27,720  8.1 fps")).toBe("plain");
    expect(logTone("loaded 462.0s @ 44100 Hz")).toBe("plain");
    expect(logTone("")).toBe("plain");
  });

  it("reads the marker whatever the case, since tracebacks shout", () => {
    expect(logTone("FATAL: no such file")).toBe("bad");
    expect(logTone("Error opening input")).toBe("bad");
  });

  it("does not call a line bad for containing the word inside another", () => {
    expect(logTone("terrorless riff detected")).toBe("plain");
  });
});

describe("formatApprox", () => {
  it("rounds a short render to a friendly phrase", () => {
    expect(formatApprox(0.4)).toBe("a minute");
    expect(formatApprox(1)).toBe("a minute");
  });

  it("counts whole minutes in the middle", () => {
    expect(formatApprox(7.4)).toBe("7 minutes");
    expect(formatApprox(45)).toBe("45 minutes");
  });

  it("switches to hours once minutes stop being readable", () => {
    expect(formatApprox(120)).toBe("2.0 hours");
    expect(formatApprox(210)).toBe("3.5 hours");
  });

  it("refuses to quote a time it does not have", () => {
    expect(formatApprox(null)).toBe("");
    expect(formatApprox(Number.NaN)).toBe("");
    expect(formatApprox(-3)).toBe("");
  });
});
