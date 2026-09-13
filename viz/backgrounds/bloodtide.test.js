import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NONE } from "../signals.js";
import {
  BANDS,
  HEAVE_MAX,
  HORIZON,
  crestAt,
  eventSeed,
  heaveOf,
  limbAlpha,
  moonPlace,
  sprayAt,
  veinAlpha,
} from "./bloodtide.js";

/** A silent frame: every driver at rest. */
const quiet = (over = {}) => ({
  kick: 0, wall: 0, arc: 0, rms: 0, drive: 0, sectionPhase: 0,
  downbeatPulse: 0, ...over,
});

/** The frame geometry the draw path hands the helpers, at 1080p landscape. */
const HD = { W: 1920, H: 1080 };
const horizonOf = (H) => H * HORIZON;
const depthOf = (H) => H - horizonOf(H);

/** Every corner of the unit cube the drivers live in. */
function cube(keys) {
  let out = [{}];
  for (const k of keys) {
    out = out.flatMap((o) => [0, 0.5, 1].map((v) => ({ ...o, [k]: v })));
  }
  return out;
}

describe("heaveOf", () => {
  it("leaves a silent sea at rest rather than flat", () => {
    // 1 is "the sea still moves"; 0 would be a mirror, which is the one thing
    // that gives a painted horizon away
    assert.equal(heaveOf(quiet()), 1);
  });

  it("never exceeds the bound the no-crossing proof rests on", () => {
    for (const c of cube(["kick", "wall", "arc"])) {
      const h = heaveOf(quiet(c));
      assert.ok(h <= HEAVE_MAX, `heave ${h} over ${HEAVE_MAX} at ${JSON.stringify(c)}`);
      assert.ok(h >= 1, `heave ${h} under 1 at ${JSON.stringify(c)}`);
    }
  });

  it("lets the slow signals lead, so the sea does not flinch on every kick", () => {
    // the swell is geometry, and geometry driven by a one-frame attack reads
    // as a twitch rather than as water
    const fromKick = heaveOf(quiet({ kick: 1 })) - 1;
    const fromSlow = heaveOf(quiet({ wall: 1, arc: 1 })) - 1;
    assert.ok(fromKick < fromSlow * 0.5,
      `kick contributes ${fromKick} against ${fromSlow} from wall and arc`);
  });

  it("rises with the low end", () => {
    assert.ok(heaveOf(quiet({ kick: 1 })) > heaveOf(quiet({ kick: 0.5 })));
    assert.ok(heaveOf(quiet({ kick: 0.5 })) > heaveOf(quiet()));
  });
});

describe("crestAt", () => {
  const horizon = horizonOf(HD.H);
  const depth = depthOf(HD.H);

  it("pins the first band exactly to the waterline", () => {
    // wake stands its plate on H * HORIZON. If band 0 heaved, the record would
    // float off the water it is supposed to be standing in.
    for (const i of [0, 7, 31, 12000]) {
      for (const heave of [0, 1, 1.5, HEAVE_MAX]) {
        assert.equal(crestAt(0, i, horizon, depth, heave, 1).y, horizon);
      }
    }
  });

  it("keeps the bands strictly ordered, so they can never cross", () => {
    // near the horizon the baseline spacing is about a third of a pixel; any
    // heave term that is not damped hard toward t=0 reorders the stack there
    // and the sea shimmers into garbage
    for (const i of [0, 7, 31, 12000]) {
      for (const heave of [0, 1, 1.5, HEAVE_MAX]) {
        for (let n = 0; n < BANDS - 1; n += 1) {
          const a = crestAt(n, i, horizon, depth, heave, 1).y;
          const b = crestAt(n + 1, i, horizon, depth, heave, 1).y;
          assert.ok(b > a, `band ${n + 1} (${b}) not below ${n} (${a}) at i=${i} heave=${heave}`);
        }
      }
    }
  });

  it("reproduces the still composition exactly when the sea is not heaving", () => {
    // a regression pin: heave 0 has to be the picture the look was composed
    // against, or turning the water on has quietly moved everything
    for (let n = 0; n < BANDS; n += 1) {
      const legacy = horizon + depth * Math.pow(n / BANDS, 1.9);
      assert.ok(Math.abs(crestAt(n, 99, horizon, depth, 0, 1).y - legacy) < 1e-9);
    }
  });

  it("moves the near water further than the distant water", () => {
    // perspective: without this the whole sea slides as one sheet
    const swing = (n) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 240; i += 1) {
        const y = crestAt(n, i, horizon, depth, HEAVE_MAX, 1).y
          - crestAt(n, i, horizon, depth, 0, 1).y;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      return hi - lo;
    };
    assert.ok(swing(45) > swing(30));
    assert.ok(swing(30) > swing(15));
    assert.ok(swing(15) > swing(5));
  });

  it("gives the nearest band a swell you can actually see at 1080p", () => {
    const band = (i) => crestAt(BANDS - 1, i, horizon, depth, HEAVE_MAX, 1).y;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 240; i += 1) {
      lo = Math.min(lo, band(i));
      hi = Math.max(hi, band(i));
    }
    assert.ok(hi - lo > 30, `nearest band only swings ${hi - lo}px`);
  });

  it("never returns a band thinner than a pixel", () => {
    for (let n = 0; n < BANDS; n += 1) {
      assert.ok(crestAt(n, 0, horizon, depth, 1, 1).h >= 1);
      assert.ok(crestAt(n, 0, horizon, depth, 1, 2).h >= 1);
    }
  });

  it("is a pure function of its arguments", () => {
    const a = crestAt(20, 137, horizon, depth, 2, 1.4);
    const b = crestAt(20, 137, horizon, depth, 2, 1.4);
    assert.deepEqual(a, b);
  });
});

describe("eventSeed", () => {
  it("holds one seed for every frame inside the same event", () => {
    // the burst has to keep its shape while it plays; reseeding per frame
    // would reshuffle it into a strobe
    const s = eventSeed(40, 0, 5501);
    assert.equal(eventSeed(43, 3, 5501), s);
    assert.equal(eventSeed(51, 11, 5501), s);
  });

  it("gives different events different seeds", () => {
    assert.notEqual(eventSeed(40, 0, 5501), eventSeed(60, 0, 5501));
  });

  it("falls back to the current frame when nothing has happened yet", () => {
    // NONE is 1e9; subtracting it would seed the generator from a wild
    // negative at the top of every track
    assert.equal(eventSeed(12, NONE, 5501), eventSeed(12, 0, 5501));
  });

  it("stays an integer for a fractional age", () => {
    assert.equal(Number.isInteger(eventSeed(12, 3.4, 5501)), true);
  });
});

describe("sprayAt", () => {
  const p = { dim: 0.8, sway: 0.02, size: 1 };

  it("never throws a droplet below the water it came from", () => {
    for (let age = 0; age <= 34; age += 1) {
      assert.ok(sprayAt(p, age, 34, 1).dy <= 0);
    }
  });

  it("leaves and returns to the surface, peaking halfway", () => {
    // `=== 0` rather than assert.equal: the arc bottoms out at -0, and which
    // zero it is does not matter to anything downstream
    assert.ok(sprayAt(p, 0, 34, 1).dy === 0);
    assert.ok(sprayAt(p, 34, 34, 1).dy === 0);
    assert.equal(sprayAt(p, 17, 34, 1).dy, -(0.05 + p.dim * 0.22));
  });

  it("fades out over its life", () => {
    assert.equal(sprayAt(p, 0, 34, 1).alpha, p.dim);
    assert.equal(sprayAt(p, 34, 34, 1).alpha, 0);
    assert.ok(sprayAt(p, 10, 34, 1).alpha > sprayAt(p, 20, 34, 1).alpha);
  });

  it("lets the loud parts throw it higher without making it brighter", () => {
    const soft = sprayAt(p, 17, 34, 1);
    const hard = sprayAt(p, 17, 34, 2);
    assert.equal(hard.dy, soft.dy * 2);
    assert.equal(hard.alpha, soft.alpha);
  });
});

describe("moonPlace", () => {
  const base = Math.round(Math.min(HD.W, HD.H) * 0.48);
  const corners = cube(["kick", "wall", "sectionPhase"]);

  it("keeps the disc standing in the water, never floating above it", () => {
    // the sea fill is drawn after the moon and cuts it at the waterline; a
    // moon whose whole body cleared the horizon would hang in the sky
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const c of corners) {
        const { y, d } = moonPlace(quiet(c), progress, base, HD.W, HD.H);
        assert.ok(y + d / 2 > horizonOf(HD.H),
          `moon clear of the water at progress=${progress} ${JSON.stringify(c)}`);
      }
    }
  });

  it("keeps a real body of it above the line", () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const c of corners) {
        const { y, d } = moonPlace(quiet(c), progress, base, HD.W, HD.H);
        assert.ok(y - d / 2 < horizonOf(HD.H) - d * 0.2,
          `moon is only a sliver at progress=${progress}`);
      }
    }
  });

  it("leaves the right of the frame to the record", () => {
    // wake seats its plate at W * 0.60; the moon owning the left half is the
    // whole composition
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const c of corners) {
        const { x, d } = moonPlace(quiet(c), progress, base, HD.W, HD.H);
        assert.ok(x <= HD.W * 0.32, `moon centre drifted to ${x}`);
        assert.ok(x + d / 2 < HD.W * 0.5, `moon reaches the centre column at ${x + d / 2}`);
      }
    }
  });

  it("breathes with the low end, within a bound", () => {
    const still = moonPlace(quiet(), 0, base, HD.W, HD.H).d;
    const loud = moonPlace(quiet({ kick: 1, wall: 1 }), 0, base, HD.W, HD.H).d;
    assert.equal(still, base);
    assert.ok(loud > still);
    assert.ok(loud <= base * 1.14, `disc grows to ${loud / base} of base`);
  });
});

describe("veinAlpha", () => {
  it("leaves the moon a plain disc when nothing is hitting", () => {
    // The cracks are a flash, not a feature of the surface. An earlier version
    // floored them so they were always lit, and the moon read as permanently
    // broken instead of splitting open when the track hit.
    assert.equal(veinAlpha(quiet()), 0);
  });

  it("ignores the low end simply being present", () => {
    // a kick under the threshold is the drum ticking along, not a moment
    for (const kick of [0.1, 0.3, 0.45]) {
      assert.ok(veinAlpha(quiet({ kick })) < 0.05,
        `a kick of ${kick} already opens the moon`);
    }
  });

  it("opens hard when the track actually lands on one", () => {
    assert.ok(veinAlpha(quiet({ kick: 1 })) > 0.6);
  });

  it("flashes rather than ramps", () => {
    // the response has to be convex, or it reads as a glow fading up and down
    // rather than as the disc cracking on the hit
    const lo = veinAlpha(quiet({ kick: 0.7 })) - veinAlpha(quiet({ kick: 0.4 }));
    const hi = veinAlpha(quiet({ kick: 1.0 })) - veinAlpha(quiet({ kick: 0.7 }));
    assert.ok(hi > lo * 1.5, `response is nearly linear: ${lo} then ${hi}`);
  });

  it("never blows the disc out to a flat sheet of light", () => {
    for (const c of cube(["kick", "wall", "arc"])) {
      assert.ok(veinAlpha({ ...quiet(c), downbeatPulse: 1 }) <= 0.9);
    }
  });
});

describe("limbAlpha", () => {
  it("shades the disc at rest rather than erasing it", () => {
    // at 0.8 over a dark bake the moon stopped being a body and became a hole
    assert.ok(limbAlpha(quiet()) <= 0.6, `limb swallows the moon: ${limbAlpha(quiet())}`);
  });

  it("burns back off as the track comes up", () => {
    assert.ok(limbAlpha(quiet({ arc: 1, rms: 1 })) < limbAlpha(quiet()));
  });

  it("stays a shadow, never a light", () => {
    for (const c of cube(["arc", "rms"])) {
      const v = limbAlpha(quiet(c));
      assert.ok(v >= 0 && v <= 0.6);
    }
  });
});
