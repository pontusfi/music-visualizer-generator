import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutFor, pickPalette, shiftHue } from "./palette.js";

/** RGBA bytes from a list of [r,g,b,count] blocks. */
function pixels(...blocks) {
  const out = [];
  for (const [r, g, b, count] of blocks) {
    for (let n = 0; n < count; n += 1) out.push(r, g, b, 255);
  }
  return new Uint8ClampedArray(out);
}

const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = ([r, g, b]) => {
  const mx = Math.max(r, g, b);
  return mx ? (mx - Math.min(r, g, b)) / mx : 0;
};

describe("pickPalette", () => {
  it("takes the ground from the darkest colour on the cover", () => {
    const p = pickPalette(pixels([12, 10, 9, 60], [200, 90, 40, 60], [230, 225, 215, 60]));
    assert.ok(lum(p.ground) < 0.1);
  });

  it("takes the bone from the lightest", () => {
    const p = pickPalette(pixels([12, 10, 9, 60], [200, 90, 40, 60], [230, 225, 215, 60]));
    assert.ok(lum(p.bone) > 0.7);
  });

  it("takes the ember from the most vivid midtone", () => {
    const p = pickPalette(pixels([12, 10, 9, 60], [200, 90, 40, 60], [230, 225, 215, 60]));
    assert.ok(sat(p.ember) > 0.5);
    assert.ok(p.ember[0] > p.ember[2], "the orange block should win, not the near-white");
  });

  it("does not let a blown highlight become the ember", () => {
    // a clipped white sun is bright and colourless; a naive "most vivid" sort
    // picks it every time and the whole video comes out beige
    const p = pickPalette(pixels([10, 9, 8, 60], [255, 253, 250, 200], [190, 60, 30, 60]));
    assert.ok(sat(p.ember) > 0.5, `ember was ${p.ember}`);
  });

  it("does not let crushed black become the ember either", () => {
    const p = pickPalette(pixels([2, 0, 0, 200], [190, 60, 30, 60], [240, 238, 235, 40]));
    assert.ok(lum(p.ember) > 0.15, `ember was ${p.ember}`);
  });

  it("falls back to a usable ember on a greyscale cover", () => {
    const p = pickPalette(pixels([20, 20, 20, 80], [128, 128, 128, 80], [220, 220, 220, 80]));
    assert.equal(p.ember.length, 3);
    assert.ok(p.ember.every((v) => Number.isFinite(v) && v >= 0 && v <= 255));
  });

  it("survives an empty cover without throwing", () => {
    const p = pickPalette(new Uint8ClampedArray(0));
    for (const key of ["ground", "ember", "bone"]) {
      assert.equal(p[key].length, 3, key);
      assert.ok(p[key].every(Number.isFinite), key);
    }
  });

  it("ignores fully transparent pixels", () => {
    const px = pixels([190, 60, 30, 60]);
    const ghost = new Uint8ClampedArray(px.length + 400);
    ghost.set(px);
    // the tail is zeroed, so alpha 0 — it must not become the ground
    const p = pickPalette(ghost);
    assert.ok(sat(p.ember) > 0.4);
  });

  it("gives the same palette for the same cover", () => {
    const px = pixels([12, 10, 9, 60], [200, 90, 40, 60]);
    assert.deepEqual(pickPalette(px), pickPalette(px));
  });
});

describe("layoutFor", () => {
  it("sits the cover in the upper middle at a fixed share of the height", () => {
    const l = layoutFor(1000, 1000, 1920, 1080);
    assert.equal(l.h, Math.round(1080 * 0.62));
    assert.equal(l.w, l.h);
    assert.equal(l.x, Math.round((1920 - l.w) / 2));
    assert.equal(l.y, Math.round(1080 * 0.1));
  });

  it("keeps the artwork's aspect ratio", () => {
    const l = layoutFor(2000, 1000, 1920, 1080);
    assert.ok(Math.abs(l.w / l.h - 2) < 0.01);
  });

  it("returns whole pixels, so the cover does not land on a half pixel", () => {
    const l = layoutFor(1333, 999, 1280, 720);
    for (const v of [l.x, l.y, l.w, l.h]) assert.equal(v, Math.round(v));
  });

  it("does not overflow the frame with a very wide cover", () => {
    const l = layoutFor(4000, 500, 1920, 1080);
    assert.ok(l.w <= 1920, `w was ${l.w}`);
    assert.ok(l.x >= 0);
  });

  it("copes with a degenerate image size", () => {
    const l = layoutFor(0, 0, 1920, 1080);
    assert.ok(l.w > 0 && l.h > 0);
    assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y));
  });
});

describe("shiftHue", () => {
  it("leaves a colour alone when nothing is asked of it", () => {
    assert.deepEqual(shiftHue([200, 90, 40], 0), [200, 90, 40]);
  });

  it("moves red toward cyan at half a turn", () => {
    const [r, g, b] = shiftHue([255, 0, 0], 0.5);
    assert.ok(b > r && g > r, `got ${[r, g, b]}`);
  });

  it("keeps the same perceived brightness whatever the hue", () => {
    // the ember composites additively, so a hue that also changed brightness
    // would make the burn flare harder for no musical reason
    const before = lum([200, 90, 40]);
    for (const d of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const after = lum(shiftHue([200, 90, 40], d));
      assert.ok(Math.abs(before - after) < 0.02, `delta ${d}: ${before} vs ${after}`);
    }
  });

  it("wraps rather than clipping at the ends of the wheel", () => {
    assert.deepEqual(shiftHue([200, 90, 40], 1), shiftHue([200, 90, 40], 0));
    assert.deepEqual(shiftHue([200, 90, 40], -0.25), shiftHue([200, 90, 40], 0.75));
  });

  it("leaves grey grey, because grey has no hue to shift", () => {
    const out = shiftHue([128, 128, 128], 0.3);
    assert.ok(Math.max(...out) - Math.min(...out) < 2, `got ${out}`);
  });

  it("always returns bytes", () => {
    for (const d of [-2, -0.3, 0, 0.1, 0.9, 3]) {
      const out = shiftHue([200, 90, 40], d);
      assert.ok(out.every((v) => v >= 0 && v <= 255 && v === Math.round(v)), `d=${d}`);
    }
  });
});
