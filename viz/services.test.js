import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutServices, SERVICE_IDS, SERVICES } from "./services.js";

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
