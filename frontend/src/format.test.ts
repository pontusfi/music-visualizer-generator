import { describe, expect, it } from "vitest";

import {
  estimateRenderMinutes,
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
