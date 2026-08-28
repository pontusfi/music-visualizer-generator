import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NONE, Signals, decay, sincePrev } from "./signals.js";

/** A minimal v2 frames.json. */
function frames(over = {}) {
  const T = over.frames ?? 8;
  const ramp = (m) => Array.from({ length: T }, (_, i) => (i / T) * m);
  return {
    version: 2,
    fps: 60,
    frames: T,
    duration: T / 60,
    bands: 3,
    tempo: 120,
    meter: 4,
    spectrum: Array.from({ length: T }, (_, i) => [0.1 * i, 0.2, 0.3]),
    kick: ramp(1),
    crack: ramp(1),
    wall: ramp(1),
    rms: ramp(1),
    hit: ramp(1),
    beats: [0, 4],
    downbeats: [0],
    onsets: [2, 6],
    sections: [0, 4],
    beatPhase: ramp(1),
    barPhase: ramp(1),
    sectionIndex: Array.from({ length: T }, (_, i) => (i < 4 ? 0 : 1)),
    sectionPhase: ramp(1),
    hue: ramp(1),
    tonal: ramp(1),
    bright: ramp(1),
    drive: ramp(1),
    arc: ramp(1),
    chroma: Array.from({ length: 12 }, (_, p) => Array.from({ length: T }, () => p / 12)),
    ...over,
  };
}

describe("sincePrev", () => {
  it("counts frames since the most recent event", () => {
    const s = sincePrev([0, 10], 15);
    assert.equal(s[0], 0);
    assert.equal(s[3], 3);
    assert.equal(s[9], 9);
    assert.equal(s[10], 0);
    assert.equal(s[14], 4);
  });

  it("reports nothing has happened yet before the first event", () => {
    const s = sincePrev([5], 8);
    assert.equal(s[0], NONE);
    assert.equal(s[4], NONE);
    assert.equal(s[5], 0);
  });

  it("is all-nothing when there are no events at all", () => {
    // a track whose beat tracking failed must not make every frame look like a beat
    const s = sincePrev([], 5);
    assert.deepEqual([...s], [NONE, NONE, NONE, NONE, NONE]);
  });

  it("ignores events outside the track", () => {
    const s = sincePrev([-4, 2, 900], 5);
    assert.equal(s[0], NONE);
    assert.equal(s[2], 0);
    assert.equal(s[4], 2);
  });

  it("copes with events handed over out of order", () => {
    assert.deepEqual([...sincePrev([10, 0], 12)], [...sincePrev([0, 10], 12)]);
  });

  it("returns one entry per frame", () => {
    assert.equal(sincePrev([0], 37).length, 37);
    assert.equal(sincePrev([0], 0).length, 0);
  });
});

describe("decay", () => {
  it("is full at the event and gone at the end of its life", () => {
    assert.equal(decay(0, 20), 1);
    assert.equal(decay(20, 20), 0);
  });

  it("falls linearly in between", () => {
    assert.equal(decay(10, 20), 0.5);
    assert.equal(decay(5, 20), 0.75);
  });

  it("is silent when nothing has happened", () => {
    assert.equal(decay(NONE, 20), 0);
  });

  it("does not divide by a zero-length life", () => {
    assert.equal(decay(0, 0), 0);
    assert.ok(Number.isFinite(decay(5, 0)));
  });

  it("stays inside zero to one", () => {
    for (const since of [-5, 0, 3, 19, 20, 500]) {
      const v = decay(since, 20);
      assert.ok(v >= 0 && v <= 1, `decay(${since}) = ${v}`);
    }
  });
});

describe("Signals", () => {
  it("reads the v2 signals straight through", () => {
    const s = new Signals(frames()).at(4);
    assert.equal(s.kick, 0.5);
    assert.equal(s.bright, 0.5);
    assert.equal(s.section, 1);
    assert.deepEqual(s.spectrum, [0.4, 0.2, 0.3]);
  });

  it("defaults every v2 signal to zero on an older frames.json", () => {
    // a file written before these existed must still render, just flatter
    const v1 = frames();
    for (const k of ["beatPhase", "barPhase", "sectionPhase", "hue", "tonal",
                     "bright", "drive", "arc", "sectionIndex", "chroma",
                     "beats", "downbeats", "onsets", "sections"]) {
      delete v1[k];
    }
    v1.version = 1;
    const s = new Signals(v1).at(3);
    assert.equal(s.beatPhase, 0);
    assert.equal(s.hue, 0);
    assert.equal(s.section, 0);
    assert.equal(s.sinceBeat, NONE);
    assert.equal(s.beatPulse, 0);
    assert.deepEqual(s.chroma, new Array(12).fill(0));
    assert.equal(s.kick, 0.375); // the v1 signals still work
  });

  it("clamps a frame index outside the track instead of returning undefined", () => {
    const sig = new Signals(frames());
    assert.equal(sig.at(-10).kick, sig.at(0).kick);
    assert.equal(sig.at(9999).kick, sig.at(7).kick);
    assert.ok(Number.isFinite(sig.at(4.7).kick));
  });

  it("counts frames since the last beat, onset and section", () => {
    const s = new Signals(frames()).at(5);
    assert.equal(s.sinceBeat, 1);      // beat at 4
    assert.equal(s.sinceOnset, 3);     // onset at 2
    assert.equal(s.sinceSection, 1);   // section at 4
  });

  it("turns a beat into a pulse that fades", () => {
    const sig = new Signals(frames());
    assert.equal(sig.at(4).beatPulse, 1);
    assert.ok(sig.at(5).beatPulse < 1);
    assert.ok(sig.at(5).beatPulse > 0);
  });

  it("hands over the twelve chroma values for the frame", () => {
    const c = new Signals(frames()).at(2).chroma;
    assert.equal(c.length, 12);
    assert.equal(c[6], 0.5);
  });

  it("gives a spectrum of the declared width even if the row is missing", () => {
    const bad = frames();
    bad.spectrum = [];
    const s = new Signals(bad).at(3);
    assert.equal(s.spectrum.length, 3);
    assert.ok(s.spectrum.every((v) => v === 0));
  });

  it("exposes what the renderer needs to know about the track", () => {
    const sig = new Signals(frames());
    assert.equal(sig.frames, 8);
    assert.equal(sig.fps, 60);
    assert.equal(sig.bands, 3);
  });

  it("survives a frames.json with nothing useful in it", () => {
    const sig = new Signals({ frames: 2, fps: 30 });
    const s = sig.at(1);
    assert.ok(Number.isFinite(s.kick));
    assert.ok(Number.isFinite(s.beatPhase));
    assert.equal(s.chroma.length, 12);
  });
});
