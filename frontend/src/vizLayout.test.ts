import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/* The geometry that decides where the cover and the spectrum sit is the one
   piece of visualizer.html that has to be right for every frame shape, so it
   lives in a marked block and is tested here against the real file rather than
   against a copy that could drift. */

const HTML = readFileSync(new URL("../../visualizer.html", import.meta.url), "utf8");
const START = "// ---8<--- geometry";
const END = "// ---8<--- end geometry";

interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
  base: number;
  barMax: number;
  unit: number;
}

function loadComputeLayout(): (W: number, H: number, ar: number) => Layout {
  const from = HTML.indexOf(START);
  const to = HTML.indexOf(END);
  if (from < 0 || to < 0 || to < from) {
    throw new Error("the geometry block markers are missing from visualizer.html");
  }
  return new Function(`${HTML.slice(from, to)}\nreturn computeLayout;`)();
}

const computeLayout = loadComputeLayout();

/** Every tier, as the short edge. */
const TIERS = [720, 1080, 1440, 2160];
const landscape = (short: number) => [Math.round((short * 16) / 9), short] as const;
const portrait = (short: number) => [short, Math.round((short * 16) / 9)] as const;

describe("computeLayout at 16:9", () => {
  it("reproduces the geometry the design was drawn at, to the pixel", () => {
    const l = computeLayout(1920, 1080, 1);
    expect(l.w).toBe(670);
    expect(l.h).toBe(670);
    expect(l.x).toBe(625);
    expect(l.y).toBe(108);
    expect(l.base).toBe(778);
    expect(l.barMax).toBeCloseTo(277.84, 2);
  });

  it("takes its size unit from the short edge, which at 16:9 is the height", () => {
    expect(computeLayout(1920, 1080, 1).unit).toBe(1080);
  });

  it("keeps a panoramic cover inside the frame instead of bleeding off the sides", () => {
    // a 3:1 cover at 62% of the height is 2010px wide on a 1920px frame
    const l = computeLayout(1920, 1080, 3);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.x + l.w).toBeLessThanOrEqual(1920);
  });
});

describe("computeLayout at 9:16", () => {
  it("keeps a square cover inside the frame", () => {
    const l = computeLayout(1080, 1920, 1);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.x + l.w).toBeLessThanOrEqual(1080);
  });

  it("leaves the spectrum room to fall inside the frame", () => {
    const l = computeLayout(1080, 1920, 1);
    expect(l.y).toBeGreaterThan(0);
    expect(l.base + l.barMax).toBeLessThanOrEqual(1920);
  });

  it("takes its size unit from the short edge, so the type is not blown up", () => {
    expect(computeLayout(1080, 1920, 1).unit).toBe(1080);
  });

  it("keeps the bars a share of the cover rather than filling the leftover strip", () => {
    const l = computeLayout(1080, 1920, 1);
    expect(l.barMax).toBeGreaterThan(0);
    expect(l.barMax).toBeLessThanOrEqual(l.h * 0.5);
  });

  it("centres the block, so the frame is not top-heavy with dead space below", () => {
    const l = computeLayout(1080, 1920, 1);
    const above = l.y;
    const below = 1920 - (l.base + l.barMax);
    expect(Math.abs(above - below)).toBeLessThan(1920 * 0.06);
  });
});

describe("computeLayout across every tier and aspect", () => {
  it("never puts the cover or the spectrum outside the frame", () => {
    for (const short of TIERS) {
      for (const [W, H] of [landscape(short), portrait(short)]) {
        // squarish, tall and wide covers all have to survive
        for (const ar of [1, 0.75, 1.5, 3]) {
          const l = computeLayout(W, H, ar);
          expect(l.x, `x at ${W}x${H} ar ${ar}`).toBeGreaterThanOrEqual(0);
          expect(l.x + l.w, `right at ${W}x${H} ar ${ar}`).toBeLessThanOrEqual(W);
          expect(l.y, `y at ${W}x${H} ar ${ar}`).toBeGreaterThanOrEqual(0);
          expect(l.base + l.barMax, `bars at ${W}x${H} ar ${ar}`).toBeLessThanOrEqual(H);
        }
      }
    }
  });
});
