import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutFor } from "../palette.js";
import { reflectionGeometry, waveOffset } from "./tide.js";

function sig(over = {}) {
  return {
    spectrum: new Array(24).fill(0),
    kick: 0,
    ...over,
  };
}

/** A spectrum with `v` in the bottom third and nothing above it. */
function lowBands(v, bands = 24) {
  return new Array(bands).fill(0).map((_, b) => (b < bands / 3 ? v : 0));
}

describe("waveOffset", () => {
  it("depends on nothing but (d, i, s)", () => {
    const a = waveOffset(0.4, 200, sig({ spectrum: lowBands(0.5) }));
    const b = waveOffset(0.4, 200, sig({ spectrum: lowBands(0.5) }));
    assert.equal(a, b);
  });

  it("is finite and zero for a frame with nothing in it", () => {
    const v = waveOffset(0.5, 100, sig({ spectrum: [], kick: 0 }));
    assert.ok(Number.isFinite(v));
    assert.equal(v, 0);
  });

  it("grows with the low bands", () => {
    // pick a frame where sin(p1) is not near zero, so a bigger amplitude
    // actually shows up in the output
    const i = 5;
    const quiet = Math.abs(waveOffset(0.3, i, sig({ spectrum: lowBands(0) })));
    const loud = Math.abs(waveOffset(0.3, i, sig({ spectrum: lowBands(1) })));
    assert.ok(loud > quiet, `expected growth, got ${quiet} -> ${loud}`);
  });

  it("grows with kick", () => {
    const i = 5;
    const rest = Math.abs(waveOffset(0.3, i, sig({ kick: 0 })));
    const hit = Math.abs(waveOffset(0.3, i, sig({ kick: 1 })));
    assert.ok(hit > rest, `expected growth, got ${rest} -> ${hit}`);
  });

  it("is finite across the full depth range", () => {
    for (const d of [0, 0.1, 0.5, 0.9, 1]) {
      const v = waveOffset(d, 12345, sig({ spectrum: lowBands(0.7) }));
      assert.ok(Number.isFinite(v), `d=${d} gave ${v}`);
    }
  });
});

describe("reflectionGeometry", () => {
  it("keeps the reflection inside the frame for both aspects", () => {
    for (const [W, H] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280]]) {
      const l = layoutFor(1000, 1000, W, H);
      const { horizonY, reach } = reflectionGeometry(l.y, l.h, H, 0.8, l.unit);
      assert.ok(horizonY + reach <= H + 1e-6, `${W}x${H}: reflection past the bottom edge`);
      assert.ok(reach >= 0, `${W}x${H}: negative reach`);
    }
  });

  it("keeps the horizon at or below the cover's own bottom edge", () => {
    const l = layoutFor(1000, 1000, 1920, 1080);
    const { horizonY } = reflectionGeometry(l.y, l.h, 1080, 0, l.unit);
    assert.ok(horizonY <= l.y + l.h, "horizon sits above the cover");
    assert.ok(horizonY >= l.y, "horizon sits above the cover's top edge");
  });

  it("rises a little as the dynamic arc opens up, without leaving the cover", () => {
    const l = layoutFor(1000, 1000, 1920, 1080);
    const closed = reflectionGeometry(l.y, l.h, 1080, 0, l.unit).horizonY;
    const open = reflectionGeometry(l.y, l.h, 1080, 1, l.unit).horizonY;
    assert.ok(open < closed, "horizon should rise (smaller y) as arc opens");
    assert.ok(open >= l.y);
  });

  it("is finite for a v1 frames.json, where arc is missing", () => {
    const l = layoutFor(1000, 1000, 1080, 1920);
    const { horizonY, reach } = reflectionGeometry(l.y, l.h, 1920, undefined, l.unit);
    assert.ok(Number.isFinite(horizonY));
    assert.ok(Number.isFinite(reach));
  });
});
