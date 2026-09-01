import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readdirSync, readFileSync } from "node:fs";

import { CREDIT, CREDIT_FIT, creditAlpha, creditBox, fitSize } from "./credit.js";
import { layoutFor } from "./palette.js";

function assets(W, H, over = {}) {
  return {
    W,
    H,
    layout: layoutFor(1000, 1000, W, H),
    artist: "OLD NIGHT",
    title: "ASHES IN THE WIND",
    ...over,
  };
}

const TIERS = [720, 1080, 1440, 2160];
const ASPECTS = [
  [16, 9],
  [9, 16],
];

describe("creditAlpha", () => {
  it("floors at 0.80 / 0.92 for a silent frame", () => {
    const a = creditAlpha({ crack: 0 });
    assert.equal(a.artist, 0.80);
    assert.equal(a.title, 0.92);
  });

  it("never exceeds 1 for a maximal frame", () => {
    const a = creditAlpha({ crack: 1 });
    assert.ok(a.artist <= 1);
    assert.ok(a.title <= 1);
  });

  it("survives a v1 frame with no crack signal at all", () => {
    const a = creditAlpha({});
    assert.equal(a.artist, 0.80);
    assert.equal(a.title, 0.92);
  });
});

describe("creditBox", () => {
  it("produces no box at all when artist and title are both empty", () => {
    const a = assets(1920, 1080, { artist: "", title: "" });
    assert.equal(creditBox(a, { x: 100, y: 900, align: "left" }), null);
  });

  it("still produces a box when only one of artist/title is set", () => {
    const a = assets(1920, 1080, { artist: "", title: "ASHES" });
    assert.ok(creditBox(a, { x: 100, y: 900, align: "left" }));
  });

  it("stays inside the frame for both aspects at every resolution tier", () => {
    for (const short of TIERS) {
      for (const [wr, hr] of ASPECTS) {
        const scale = short / Math.min(wr, hr);
        const W = Math.round(wr * scale);
        const H = Math.round(hr * scale);
        const a = assets(W, H);
        const box = creditBox(a, { x: W * 0.1, y: H * 0.9, align: "left" });
        assert.ok(box, `${W}x${H}`);
        assert.ok(box.x >= 0, `${W}x${H}: x ${box.x}`);
        assert.ok(box.y >= 0, `${W}x${H}: y ${box.y}`);
        assert.ok(box.x + box.w <= W, `${W}x${H}: right ${box.x + box.w}`);
        assert.ok(box.y + box.h <= H, `${W}x${H}: bottom ${box.y + box.h}`);
      }
    }
  });

  it("insets a left-aligned block at the frame edge rather than clipping it", () => {
    const a = assets(1080, 1920);
    const box = creditBox(a, { x: 0, y: 30, align: "left" });
    assert.ok(box.x >= 0);
    assert.ok(box.y >= 0, `top clipped at ${box.y}`);
  });

  it("centres a centre-aligned block on its anchor when there is room", () => {
    const a = assets(1920, 1080);
    const box = creditBox(a, { x: 960, y: 1000, align: "center" });
    const mid = box.x + box.w / 2;
    assert.ok(Math.abs(mid - 960) < 1, `centre drifted to ${mid}`);
  });

  it("reports a positive height that grows with unit", () => {
    const small = creditBox(assets(1280, 720), { x: 100, y: 600, align: "left" });
    const big = creditBox(assets(3840, 2160), { x: 100, y: 1800, align: "left" });
    assert.ok(small.h > 0);
    assert.ok(big.h > small.h);
  });
});

describe("CREDIT sizes", () => {
  it("keeps title larger than artist", () => {
    assert.ok(CREDIT.title > CREDIT.artist);
  });
});

describe("fitSize", () => {
  const FONT = "Display, sans-serif";

  /** A context whose text width is proportional to size and character count. */
  function ctx(perChar = 0.6) {
    return {
      font: "",
      measureText(s) {
        return { width: s.length * parseFloat(this.font) * perChar };
      },
    };
  }

  it("leaves a line that already fits at the size it asked for", () => {
    // 10 chars at 40px and 0.6 per char is 240 wide, well inside 900
    assert.equal(fitSize(ctx(), "SHORT LINE", FONT, 40, 900), 40);
  });

  it("shrinks a line that would run off the frame", () => {
    // 20 chars at 60px is 720 wide against a 400 limit
    const size = fitSize(ctx(), "BLESSED ARE THE DEAD", FONT, 60, 400);
    assert.ok(size < 60, `did not shrink: ${size}`);
    assert.ok(size * 20 * 0.6 <= 400 + 1, `still ${size * 20 * 0.6} wide, over 400`);
  });

  it("never returns more than the size asked for", () => {
    for (const max of [50, 200, 5000]) {
      assert.ok(fitSize(ctx(), "A TITLE", FONT, 30, max) <= 30);
    }
  });

  it("is unbothered by an empty line or a nonsense width", () => {
    assert.equal(fitSize(ctx(), "", FONT, 42, 100), 42);
    assert.equal(fitSize(ctx(), "X", FONT, 42, 0), 42);
  });

  it("keeps the longest plausible title inside a 9:16 frame", () => {
    // the real regression: at 9:16 the short edge is the width, so a title
    // sized off `unit` is measured against the edge it can actually run off
    const W = 1080;
    const size = fitSize(ctx(0.55), "BLESSED ARE THE DEAD", FONT,
      Math.round(W * CREDIT.title), W * CREDIT_FIT);
    assert.ok(size * "BLESSED ARE THE DEAD".length * 0.55 <= W * CREDIT_FIT + 1);
  });
});

describe("the looks", () => {
  const dir = new URL("./looks/", import.meta.url);

  it("fit their title to the frame rather than letting it run off the edge", () => {
    // At 16:9 a title sized off the short edge has the long edge to run along
    // and nothing looks wrong. At 9:16 the short edge is the width, and a long
    // title ran clean past the frame — so every look has to measure.
    const drawsType = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".js") || file === "index.js" || file.includes(".test.")) continue;
      const src = readFileSync(new URL(file, dir), "utf8");
      if (!src.includes("fillText")) continue;
      drawsType.push(file);
      assert.ok(src.includes("fitSize("),
        `${file} draws a title without fitting it to the frame width`);
    }
    assert.ok(drawsType.length >= 5, `scan found only ${drawsType.length} looks`);
  });
});
