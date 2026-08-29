import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dustOffset } from "./dust.js";

describe("Dust's offset", () => {
  it("is a function of the frame index and rate alone", () => {
    assert.equal(dustOffset(417, 0.0003, 1920), dustOffset(417, 0.0003, 1920));
  });

  it("is finite for a v1 frames.json's opening frame", () => {
    assert.ok(Number.isFinite(dustOffset(0, 0.0003, 1920)));
  });

  it("stays inside the tile's own width", () => {
    for (const i of [0, 1, 500, 1_000_000]) {
      const off = dustOffset(i, 0.0005, 1920);
      assert.ok(off >= 0 && off < 1920, `offset ${off} at i=${i}`);
    }
  });

  it("gives each layer's own rate a different offset at the same frame", () => {
    const slow = dustOffset(500, 0.0002, 1920);
    const fast = dustOffset(500, 0.0006, 1920);
    assert.notEqual(slow, fast);
  });
});
