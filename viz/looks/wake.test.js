import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SLICES, beatShear, plateDark, sliceAt, sweepX } from "./wake.js";

/** A silent frame: every driver at rest. */
const quiet = (over = {}) => ({
  rms: 0, arc: 0, kick: 0, downbeatPulse: 0, wall: 0, beatPhase: 0, hit: 0, ...over,
});

describe("plateDark", () => {
  it("holds the record near silhouette through silence", () => {
    assert.equal(plateDark(quiet()), 0.66);
  });

  it("never inverts into a bleach", () => {
    for (const rms of [0, 0.5, 1]) {
      for (const arc of [0, 0.5, 1]) {
        for (const kick of [0, 0.5, 1]) {
          for (const downbeatPulse of [0, 0.5, 1]) {
            assert.ok(plateDark(quiet({ rms, arc, kick, downbeatPulse })) >= 0);
          }
        }
      }
    }
  });

  it("lifts with every driver that feeds it", () => {
    const base = plateDark(quiet());
    for (const k of ["rms", "arc", "kick", "downbeatPulse"]) {
      assert.ok(plateDark(quiet({ [k]: 1 })) < base, `${k} does not lift the scrim`);
    }
  });

  it("lets a downbeat punch the cover fully forward", () => {
    // the feature: on a loud downbeat the scrim clears completely and the
    // artwork is briefly a photograph rather than a cut-out
    assert.equal(plateDark(quiet({ rms: 0.7, arc: 0.5, kick: 0.6, downbeatPulse: 1 })), 0);
  });
});

describe("sweepX", () => {
  const w = 600;
  const h = 600;

  it("crosses the plate once a bar, in one direction", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const x = sweepX(p, w, h);
      assert.ok(x > prev, `sweep doubled back at barPhase ${p}`);
      prev = x;
    }
  });

  it("starts and ends clear of the plate, so it never parks on the bar seam", () => {
    // a highlight sitting still at the wrap would read as a painted stripe
    assert.ok(sweepX(0, w, h) <= -h * 0.8);
    assert.ok(sweepX(1, w, h) >= w + h * 0.8);
  });
});

describe("sliceAt", () => {
  const unit = 1080;
  // the widest `swell` the draw path can hand it: 1 + rms*0.8 + wall*0.9 + kick*0.5
  const SWELL_MAX = 1 + 0.8 + 0.9 + 0.5;

  it("meets the plate at the waterline", () => {
    assert.equal(sliceAt(0, SLICES, 137, unit, 0, 0, 0).dx, 0);
  });

  it("never shears the reflection out of the record's own column", () => {
    for (let n = 0; n < SLICES; n += 1) {
      for (const i of [0, 13, 137, 9000]) {
        for (const swell of [0, 1, SWELL_MAX]) {
          for (const tear of [0, 1]) {
            // shear is sin(beatPhase*2pi) * wall * 0.6, so it lives in
            // [-0.6, 0.6]; swept past that to leave the bound some room
            for (const shear of [-1, -0.6, 0, 0.6, 1]) {
              const { dx } = sliceAt(n, SLICES, i, unit, swell, tear, shear);
              assert.ok(Math.abs(dx) <= unit * 0.12,
                `slice ${n} displaced ${dx} at swell=${swell} tear=${tear} shear=${shear}`);
            }
          }
        }
      }
    }
  });

  it("stretches further from the plate the deeper it goes", () => {
    for (let n = 0; n < SLICES - 1; n += 1) {
      assert.ok(sliceAt(n + 1, SLICES, 0, unit, 1, 0, 0).stretch
        > sliceAt(n, SLICES, 0, unit, 1, 0, 0).stretch);
    }
  });

  it("fades with depth without wasting slices on nothing", () => {
    // the old ramp hit zero at t = 0.94, so the last slices were drawn and
    // then multiplied out of existence
    let prev = Infinity;
    for (let n = 0; n < SLICES; n += 1) {
      const { alpha } = sliceAt(n, SLICES, 0, unit, 1, 0, 0);
      assert.ok(alpha >= 0 && alpha <= 0.38);
      assert.ok(alpha <= prev);
      prev = alpha;
    }
    assert.ok(sliceAt(SLICES - 1, SLICES, 0, unit, 1, 0, 0).alpha > 0,
      "the deepest slice is drawn at zero alpha");
  });

  it("is a pure function of its arguments", () => {
    const a = sliceAt(12, SLICES, 137, unit, 2, 0.5, 0.2);
    const b = sliceAt(12, SLICES, 137, unit, 2, 0.5, 0.2);
    assert.deepEqual(a, b);
  });
});

describe("beatShear", () => {
  it("joins up across the beat instead of snapping", () => {
    // `beatPhase` is a sawtooth. Reading it directly threw the reflection from
    // one extreme to the other in a single frame at every beat, which is the
    // jolt this exists to prevent.
    const end = beatShear(quiet({ beatPhase: 1, wall: 1 }));
    const start = beatShear(quiet({ beatPhase: 0, wall: 1 }));
    assert.ok(Math.abs(end - start) < 1e-9, `snaps ${start} -> ${end} at the beat`);
  });

  it("is already easing back to rest before the wrap", () => {
    for (const beatPhase of [0.97, 0.98, 0.99]) {
      assert.ok(Math.abs(beatShear(quiet({ beatPhase, wall: 1 }))) < 0.2);
    }
  });

  it("holds inside the range sliceAt is bounded over", () => {
    for (let n = 0; n <= 100; n += 1) {
      const v = beatShear(quiet({ beatPhase: n / 100, wall: 1 }));
      assert.ok(Math.abs(v) <= 0.6 + 1e-9, `shear ${v} out of range`);
    }
  });

  it("leaves a quiet passage unsheared", () => {
    assert.ok(beatShear(quiet({ beatPhase: 0.25 })) === 0);
  });
});
