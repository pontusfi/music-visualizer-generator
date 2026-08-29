import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { horizonLines } from "./grid.js";

describe("Grid's horizon lines", () => {
  it("is a function of the beat grid alone", () => {
    assert.deepEqual(horizonLines(4, 0.3), horizonLines(4, 0.3));
  });

  it("is finite for a v1 frames.json, where both default to zero", () => {
    for (const z of horizonLines(undefined, undefined)) {
      assert.ok(Number.isFinite(z));
    }
  });

  it("keeps every line's depth inside 0..1", () => {
    for (const beatOrdinal of [0, 5, 500]) {
      for (const beatPhase of [0, 0.4, 0.999]) {
        for (const z of horizonLines(beatOrdinal, beatPhase)) {
          assert.ok(z >= 0 && z < 1, `z ${z} at ${beatOrdinal}+${beatPhase}`);
        }
      }
    }
  });

  it("advances on the beat rather than sitting still", () => {
    const early = horizonLines(0, 0);
    const later = horizonLines(8, 0.5);
    assert.notDeepEqual(early, later);
  });

  it("returns the requested number of lines", () => {
    assert.equal(horizonLines(0, 0, 10).length, 10);
  });
});
