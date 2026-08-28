import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutFor } from "../palette.js";
import { composition } from "./shear.js";

/** The scale Shear asks for at rest: seat, kick and its own 1.18 blow-up. */
const WANTED = 1.18;

describe("Shear's composition", () => {
  it("leaves a 16:9 frame exactly where it always sat", () => {
    // the cover is nowhere near the edges at 16:9, so neither clamp may bite
    const l = layoutFor(1000, 1000, 1920, 1080);
    const c = composition(l, 1920, WANTED, 0);
    assert.equal(c.w, l.w * WANTED);
    assert.equal(c.x, (1920 - l.w * WANTED) / 2);
    // the furniture still hangs off the cover's own left edge
    assert.equal(c.textX, c.x);
    assert.equal(c.ruleW, c.w);
  });

  it("does not blow the cover past the edges of a 9:16 frame", () => {
    // 62% of 1920 cannot fit 1080 wide, so the layout is already width-bound;
    // multiplying it up again would take the artwork off both sides
    const l = layoutFor(1000, 1000, 1080, 1920);
    const c = composition(l, 1080, WANTED, 0);
    assert.ok(c.w <= 1080, `cover was ${c.w} wide in a 1080 frame`);
    assert.ok(c.x >= 0, `cover started at ${c.x}`);
  });

  it("keeps the credit line inside the picture when the cover fills the width", () => {
    // the text is drawn at textX; at x = 0 it would start on the frame edge,
    // and with any seat drift it would be cut off entirely
    const l = layoutFor(1000, 1000, 1080, 1920);
    const c = composition(l, 1080, WANTED, -40);
    assert.ok(c.textX > 0, `text started at ${c.textX}`);
    assert.ok(c.textX + c.ruleW <= 1080);
  });

  it("keeps the rule inside the frame however the seat drifts", () => {
    const l = layoutFor(1000, 1000, 1080, 1920);
    for (const dx of [-60, -20, 0, 20, 60]) {
      const c = composition(l, 1080, WANTED, dx);
      assert.ok(c.ruleX >= 0, `rule started at ${c.ruleX} for dx ${dx}`);
      assert.ok(c.ruleX + c.ruleW <= 1080, `rule ended past the frame for dx ${dx}`);
      assert.ok(c.ruleW > 0, `rule vanished for dx ${dx}`);
    }
  });

  it("keeps the artwork's aspect ratio whichever clamp applies", () => {
    for (const [W, H] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280]]) {
      const l = layoutFor(1400, 1000, W, H);
      const c = composition(l, W, WANTED, 0);
      assert.ok(Math.abs(c.w / c.h - l.w / l.h) < 1e-9, `ratio drifted at ${W}x${H}`);
    }
  });
});
