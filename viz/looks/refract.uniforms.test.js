/**
 * The half of Refract that is not GLSL.
 *
 * The shader itself cannot be unit-tested — it needs a real context — so
 * everything that decides *what* the shader is asked to draw lives in its own
 * module and is tested here, the way shear.test.js covers `composition`. What
 * is left in the shader is arithmetic on the numbers this file produces.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutFor } from "../palette.js";
import { fieldSeedFor, uniformsFor } from "./refract.uniforms.js";

const FPS = 60;

/** A signals-shaped object; `at()` returns exactly this shape. */
function sig(over = {}) {
  return {
    i: 100,
    kick: 0, crack: 0, wall: 0, hit: 0, rms: 0,
    spectrum: new Array(24).fill(0),
    beatPhase: 0, barPhase: 0, sectionPhase: 0,
    hue: 0.5, tonal: 0, bright: 0, drive: 0, arc: 0,
    section: 0,
    chroma: new Array(12).fill(0),
    beatOrdinal: 0,
    sinceBeat: 0, sinceDownbeat: 0, sinceOnset: 1e9, sinceSection: 1e9,
    beatPulse: 0, downbeatPulse: 0, onsetPulse: 0,
    ...over,
  };
}

function assets(over = {}) {
  return {
    W: 1920,
    H: 1080,
    layout: layoutFor(1000, 1000, 1920, 1080),
    palette: { ground: [10, 12, 16], ember: [220, 90, 40], bone: [230, 228, 220] },
    seat: { scale: 1, dx: 0, dy: 0 },
    signals: { fps: FPS },
    ...over,
  };
}

/** A spectrum with `v` in the bottom third and nothing above it. */
function lowBands(v, bands = 24) {
  return new Array(bands).fill(0).map((_, b) => (b < bands / 3 ? v : 0));
}

describe("Refract's uniforms", () => {
  it("takes the frame index as its only clock", () => {
    // if this ever became a wall-clock value the render stops being reproducible
    const u = uniformsFor(sig({ i: 417 }), assets());
    assert.equal(u.uFrame, 417);
  });

  it("opens the background warp as the low end fills up", () => {
    const quiet = uniformsFor(sig({ spectrum: lowBands(0) }), assets());
    const loud = uniformsFor(sig({ spectrum: lowBands(1) }), assets());
    assert.ok(loud.uWarp > quiet.uWarp,
      `expected the warp to grow with the bass, got ${quiet.uWarp} -> ${loud.uWarp}`);
  });

  it("ripples the cover harder on a kick", () => {
    const rest = uniformsFor(sig({ kick: 0 }), assets());
    const hit = uniformsFor(sig({ kick: 1 }), assets());
    assert.ok(hit.uDisplace > rest.uDisplace);
  });

  it("moves the ember with the harmony", () => {
    // same tonal confidence, different key: the colour has to actually move
    const a = uniformsFor(sig({ hue: 0.0, tonal: 1 }), assets());
    const b = uniformsFor(sig({ hue: 1.0, tonal: 1 }), assets());
    assert.notDeepEqual(a.uEmber, b.uEmber);
  });

  it("leaves the ember alone when the key is not clear", () => {
    // tonal is the confidence in `hue`; at zero the artwork's own colour stands
    const vague = uniformsFor(sig({ hue: 0.0, tonal: 0 }), assets());
    const other = uniformsFor(sig({ hue: 1.0, tonal: 0 }), assets());
    assert.deepEqual(vague.uEmber, other.uEmber);
  });

  it("hands the shader colours in 0..1, not 0..255", () => {
    const u = uniformsFor(sig(), assets());
    for (const c of [...u.uGround, ...u.uEmber]) {
      assert.ok(c >= 0 && c <= 1, `${c} is not a normalised channel`);
    }
  });

  it("seats the background differently in each section", () => {
    assert.notDeepEqual(fieldSeedFor(0), fieldSeedFor(1));
    assert.notDeepEqual(fieldSeedFor(1), fieldSeedFor(2));
  });

  it("gives a section the same seed every time it is asked", () => {
    assert.deepEqual(fieldSeedFor(3), fieldSeedFor(3));
  });

  it("eases the background across a section change rather than cutting", () => {
    // a cut in the music should not be a cut on screen. Driven by
    // sinceSection, so it stays a pure function of the frame index.
    const base = { section: 1, hue: 0.5 };
    const at = (n) => uniformsFor(sig({ ...base, sinceSection: n }), assets()).uSeed;
    const early = at(1);
    const mid = at(Math.round(FPS * 0.6));
    const settled = at(FPS * 10);
    assert.notDeepEqual(early, mid, "the field should still be moving");
    assert.deepEqual(settled, fieldSeedFor(1), "it should arrive at its own seed");
  });

  it("survives a v1 frames.json, where every v2 signal is missing", () => {
    // Signals fills these with zeros rather than throwing, and an old file must
    // render something rather than a frame of NaN
    const u = uniformsFor(sig({ spectrum: [], chroma: [] }), assets());
    for (const [name, value] of Object.entries(u)) {
      for (const v of [value].flat()) {
        assert.ok(Number.isFinite(v), `${name} came out ${v}`);
      }
    }
  });

  it("places the cover inside the frame, in texture coordinates", () => {
    const u = uniformsFor(sig(), assets());
    const [x, y, w, h] = u.uCover;
    assert.ok(w > 0 && h > 0);
    assert.ok(x >= 0 && y >= 0 && x + w <= 1 && y + h <= 1,
      `cover ${u.uCover.join(",")} leaves the frame`);
  });

  it("moves the cover with the seat the other looks share", () => {
    const centred = uniformsFor(sig(), assets());
    const shifted = uniformsFor(sig(), assets({ seat: { scale: 1, dx: 0.05, dy: 0 } }));
    assert.notEqual(centred.uCover[0], shifted.uCover[0]);
  });
});
