import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { driftWindow } from "./drift.js";

describe("Drift's window", () => {
  it("is a function of the frame index alone", () => {
    const a = driftWindow(417, 1920, 0.3);
    const b = driftWindow(417, 1920, 0.3);
    assert.deepEqual(a, b);
  });

  it("is finite for a v1 frames.json, where wall is missing", () => {
    const { offset, pitch } = driftWindow(1000, 1920, undefined);
    assert.ok(Number.isFinite(offset));
    assert.ok(Number.isFinite(pitch));
  });

  it("keeps the offset inside the sheet's own width", () => {
    for (const i of [0, 1, 500, 100000, -1]) {
      const { offset } = driftWindow(i, 1920, 0);
      assert.ok(offset >= 0 && offset < 1920, `offset ${offset} at i=${i}`);
    }
  });

  it("widens the pitch as the low end fills up", () => {
    const quiet = driftWindow(200, 1920, 0);
    const loud = driftWindow(200, 1920, 1);
    assert.ok(loud.pitch > quiet.pitch);
  });

  it("moves the offset on as the frame index advances", () => {
    const early = driftWindow(0, 1920, 0);
    const later = driftWindow(600, 1920, 0);
    assert.notEqual(early.offset, later.offset);
  });
});
