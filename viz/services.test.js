import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutServices, servicesTop, SERVICE_IDS, SERVICES } from "./services.js";

describe("the services registry", () => {
  it("gives every id a name and a mark", () => {
    for (const id of SERVICE_IDS) {
      const svc = SERVICES[id];
      assert.ok(svc.name.length > 0, `${id} has no name`);
      assert.equal(typeof svc.mark, "function", `${id} has no mark`);
    }
  });

  it("has exactly the eight services the picker offers", () => {
    assert.equal(SERVICE_IDS.length, 8);
  });
});

describe("layoutServices", () => {
  it("produces an empty layout for an empty selection", () => {
    assert.deepEqual(layoutServices([], 1080, 1080), []);
  });

  it("drops an unknown id rather than throwing", () => {
    assert.doesNotThrow(() => layoutServices(["spotify", "napster"], 1920, 1080));
    const layout = layoutServices(["napster"], 1920, 1080);
    assert.deepEqual(layout, []);
  });

  it("follows registry order, not the order ids were passed in", () => {
    const layout = layoutServices(["amazon", "spotify", "tidal"], 1920, 1080);
    assert.deepEqual(layout.map((it) => it.id), ["spotify", "tidal", "amazon"]);
  });

  it("is centred: items straddle zero", () => {
    const layout = layoutServices(["spotify", "apple"], 1920, 1080);
    const left = Math.min(...layout.map((it) => it.x - it.w / 2));
    const right = Math.max(...layout.map((it) => it.x + it.w / 2));
    assert.ok(Math.abs(left + right) < 1, `not centred: ${left}..${right}`);
  });

  it("fits every service within the frame width at 9:16 720p, wrapping rows", () => {
    const W = 720;
    const unit = 720;
    const layout = layoutServices(SERVICE_IDS, W, unit);
    assert.equal(layout.length, SERVICE_IDS.length);
    const left = Math.min(...layout.map((it) => it.x - it.w / 2));
    const right = Math.max(...layout.map((it) => it.x + it.w / 2));
    assert.ok(right - left <= W, `block ${right - left} wider than frame ${W}`);
  });

  it("wraps to a second row rather than overflowing when many are picked", () => {
    const layout = layoutServices(SERVICE_IDS, 720, 720);
    const rows = new Set(layout.map((it) => it.y));
    assert.ok(rows.size > 1, "eight services at 720 wide should wrap");
  });

  it("stays on one row for a wide frame with few services", () => {
    const layout = layoutServices(["spotify", "apple"], 1920, 1080);
    const rows = new Set(layout.map((it) => it.y));
    assert.equal(rows.size, 1);
  });
});

/**
 * A recording 2D context: enough of the API for the marks to draw into, and a
 * record of every coordinate they touched. There is no canvas in node, and the
 * thing worth guarding here is not what a mark looks like — that is a visual
 * judgement — but that it stays inside its own glyph box and hands the context
 * back the way it found it.
 */
function fakeCtx() {
  const pts = [];
  const ops = [];
  const state = { globalCompositeOperation: "source-over", globalAlpha: 1, lineWidth: 0 };
  const stack = [];
  const at = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pts.push([x, y, state.globalCompositeOperation]);
    }
  };
  return {
    pts,
    ops,
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    set globalCompositeOperation(v) { state.globalCompositeOperation = v; ops.push(`gco:${v}`); },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { state.globalAlpha = v; },
    set lineWidth(v) { state.lineWidth = v; },
    get lineWidth() { return state.lineWidth; },
    set lineCap(v) { state.lineCap = v; },
    set fillStyle(v) { state.fillStyle = v; },
    set strokeStyle(v) { state.strokeStyle = v; },
    save() { stack.push({ ...state }); ops.push("save"); },
    restore() { Object.assign(state, stack.pop()); ops.push("restore"); },
    beginPath() { ops.push("beginPath"); },
    closePath() { ops.push("closePath"); },
    moveTo(x, y) { at(x, y); ops.push("moveTo"); },
    lineTo(x, y) { at(x, y); ops.push("lineTo"); },
    quadraticCurveTo(a, b, c, d) { at(a, b); at(c, d); ops.push("quadraticCurveTo"); },
    bezierCurveTo(a, b, c, d, e, f) { at(a, b); at(c, d); at(e, f); ops.push("bezierCurveTo"); },
    // sampled along the sweep rather than taken as a bounding box: a 120°
    // arc of a large circle covers far less than that circle's box, and a
    // bbox would fail marks that are actually inside their glyph
    arc(x, y, rad, a0 = 0, a1 = Math.PI * 2) {
      for (let k = 0; k <= 24; k += 1) {
        const t = a0 + ((a1 - a0) * k) / 24;
        at(x + rad * Math.cos(t), y + rad * Math.sin(t));
      }
      ops.push("arc");
    },
    arcTo(a, b, c, d) { at(a, b); at(c, d); ops.push("arcTo"); },
    ellipse(x, y, rx, ry) { at(x - rx, y - ry); at(x + rx, y + ry); ops.push("ellipse"); },
    rect(x, y, w, h) { at(x, y); at(x + w, y + h); ops.push("rect"); },
    fillRect(x, y, w, h) { at(x, y); at(x + w, y + h); ops.push("fillRect"); },
    fill() { ops.push("fill"); },
    stroke() { ops.push("stroke"); },
    translate() { ops.push("translate"); },
    rotate() { ops.push("rotate"); },
  };
}

describe("the service marks", () => {
  const R = 100;
  const CX = 500;
  const CY = 300;

  it("hands the context back the way it found it", () => {
    // a mark that leaked destination-out would erase the rest of the frame,
    // and one that leaked globalAlpha would fade whatever drew after it
    for (const id of SERVICE_IDS) {
      const ctx = fakeCtx();
      SERVICES[id].mark(ctx, CX, CY, R);
      assert.equal(ctx.globalCompositeOperation, "source-over",
        `${id} left the composite operation set`);
      assert.equal(ctx.globalAlpha, 1, `${id} left globalAlpha changed`);
    }
  });

  it("draws inside its own glyph box", () => {
    // layoutServices reserves one glyph diameter per item; a mark that draws
    // outside it collides with its neighbour or the label under it
    const slack = R * 1.05;
    for (const id of SERVICE_IDS) {
      const ctx = fakeCtx();
      SERVICES[id].mark(ctx, CX, CY, R);
      assert.ok(ctx.pts.length > 0, `${id} drew nothing`);
      for (const [x, y] of ctx.pts) {
        assert.ok(Math.abs(x - CX) <= slack,
          `${id} drew at x=${x}, ${Math.abs(x - CX) / R} radii from centre`);
        assert.ok(Math.abs(y - CY) <= slack,
          `${id} drew at y=${y}, ${Math.abs(y - CY) / R} radii from centre`);
      }
    }
  });

  it("gives every service a distinguishable shape", () => {
    // soundcloud and deezer were the same row of bars, so the row showed two
    // identical glyphs under two different names
    const shapes = new Map();
    for (const id of SERVICE_IDS) {
      const ctx = fakeCtx();
      SERVICES[id].mark(ctx, CX, CY, R);
      const key = JSON.stringify([ctx.ops, ctx.pts.map((p) => p.map((v) => Math.round(v)))]);
      const twin = shapes.get(key);
      assert.equal(twin, undefined, `${id} draws exactly what ${twin} draws`);
      shapes.set(key, id);
    }
  });
});

describe("servicesTop", () => {
  it("is the frame bottom when nothing is selected", () => {
    // no badge row means nothing for a look to keep clear of
    assert.equal(servicesTop([], 1920, 1080, 1080), 1080);
  });

  it("leaves room above the row when services are selected", () => {
    const top = servicesTop(["spotify"], 1920, 1080, 1080);
    assert.ok(top < 1080 * 0.975, `block starts at ${top}, not above the row`);
    assert.ok(top > 1080 * 0.7, `block starts at ${top}, absurdly high`);
  });

  it("rises further when the row wraps to two", () => {
    const one = servicesTop(["spotify"], 1920, 1080, 1080);
    const many = servicesTop(SERVICE_IDS, 720, 1280, 720);
    const manyRows = (1280 * 0.975 - many) / 720;
    const oneRow = (1080 * 0.975 - one) / 1080;
    assert.ok(manyRows > oneRow, "a wrapped row reserves no more height than one");
  });

  it("keeps a look's credit clear of the badges", () => {
    // the regression: every ported look put its title at H - unit*0.07,
    // which lands inside the block whenever any service is picked
    const H = 1080;
    const unit = 1080;
    const naive = H - unit * 0.07;
    assert.ok(servicesTop(["spotify"], 1920, H, unit) < naive,
      "the naive baseline is already clear, so this test proves nothing");
  });
});

describe("the Spotify disc", () => {
  const R = 100;
  const CX = 500;
  const CY = 300;

  it("centres its arcs in the disc", () => {
    // The three waves are concentric about a point below the disc's centre,
    // which is what stacks them — but set too far below, all three ink inside
    // the lower half and leave a bald gap across the top. Measured on the
    // knocked-out detail alone: the disc around it is symmetric by
    // construction and would hide the offset.
    const ctx = fakeCtx();
    SERVICES.spotify.mark(ctx, CX, CY, R);
    const cut = ctx.pts.filter((p) => p[2] === "destination-out").map((p) => p[1]);
    assert.ok(cut.length > 0, "the arcs are not knocked out of the disc");
    const top = Math.min(...cut);
    const bottom = Math.max(...cut);
    const offset = ((top + bottom) / 2 - CY) / R;
    assert.ok(Math.abs(offset) <= 0.08,
      `the arcs sit ${offset.toFixed(2)} radii off centre `
      + `(ink from ${((top - CY) / R).toFixed(2)} to ${((bottom - CY) / R).toFixed(2)})`);
  });

  it("spans enough of the disc to read as the mark", () => {
    // three arcs huddled in the middle read as a scribble, not as the logo
    const ctx = fakeCtx();
    SERVICES.spotify.mark(ctx, CX, CY, R);
    const cut = ctx.pts.filter((p) => p[2] === "destination-out");
    const height = (Math.max(...cut.map((p) => p[1])) - Math.min(...cut.map((p) => p[1]))) / R;
    const width = (Math.max(...cut.map((p) => p[0])) - Math.min(...cut.map((p) => p[0]))) / R;
    assert.ok(height > 0.6, `arcs only ${height.toFixed(2)} radii tall`);
    assert.ok(width > 1.2, `arcs only ${width.toFixed(2)} radii wide`);
  });
});
