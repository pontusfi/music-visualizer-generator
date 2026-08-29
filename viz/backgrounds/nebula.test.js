import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { glowSeedsFor, nebulaGlows } from "./nebula.js";

describe("Nebula's glow seats", () => {
  it("seats a glow differently in each section", () => {
    assert.notDeepEqual(glowSeedsFor(0), glowSeedsFor(1));
    assert.notDeepEqual(glowSeedsFor(1), glowSeedsFor(2));
  });

  it("gives a section the same seats every time it is asked", () => {
    assert.deepEqual(glowSeedsFor(3), glowSeedsFor(3));
  });

  it("always seats exactly four glows", () => {
    assert.equal(glowSeedsFor(0).length, 4);
  });
});

describe("nebulaGlows", () => {
  it("is a function of the frame index and section alone", () => {
    assert.deepEqual(nebulaGlows(417, 2), nebulaGlows(417, 2));
  });

  it("is finite for a v1 frames.json, where section is always 0", () => {
    for (const g of nebulaGlows(9000, 0)) {
      assert.ok(Number.isFinite(g.x));
      assert.ok(Number.isFinite(g.y));
      assert.ok(Number.isFinite(g.radius));
    }
  });

  it("moves a glow on as the frame index advances", () => {
    const early = nebulaGlows(0, 0);
    const later = nebulaGlows(900, 0);
    assert.notDeepEqual(early, later);
  });
});
