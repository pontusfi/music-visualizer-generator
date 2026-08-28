import { describe, expect, it } from "vitest";

import { bandBins, bandEdges, follow, mulberry32 } from "./signals";

describe("follow", () => {
  it("stays put when it is already there", () => {
    expect(follow(0.5, 0.5, 0.6, 0.1)).toBeCloseTo(0.5, 6);
  });

  it("moves toward a louder target", () => {
    const next = follow(0.2, 0.8, 0.5, 0.1);
    expect(next).toBeGreaterThan(0.2);
    expect(next).toBeLessThan(0.8);
  });

  it("attacks faster than it releases, which is what makes a kick read", () => {
    const attack = 0.6;
    const release = 0.1;
    const up = follow(0.2, 0.8, attack, release) - 0.2;
    const down = 0.8 - follow(0.8, 0.2, attack, release);
    expect(up).toBeGreaterThan(down);
  });

  it("converges rather than oscillating", () => {
    let v = 0;
    for (let i = 0; i < 200; i += 1) v = follow(v, 0.7, 0.5, 0.1);
    expect(v).toBeCloseTo(0.7, 4);
  });

  it("never overshoots the target", () => {
    expect(follow(0, 1, 1, 1)).toBeLessThanOrEqual(1);
    expect(follow(1, 0, 1, 1)).toBeGreaterThanOrEqual(0);
  });

  it("recovers from a NaN instead of freezing the meter forever", () => {
    expect(Number.isFinite(follow(NaN, 0.5, 0.5, 0.1))).toBe(true);
    expect(Number.isFinite(follow(0.5, NaN, 0.5, 0.1))).toBe(true);
  });
});

describe("bandBins", () => {
  const FFT = 2048;
  const SR = 44100;

  it("puts a frequency in the bin the FFT would", () => {
    // bin = f * fftSize / sampleRate
    const [lo] = bandBins(1000, 2000, FFT, SR);
    expect(lo).toBe(Math.floor((1000 * FFT) / SR));
  });

  it("never returns a bin outside the spectrum array", () => {
    const [lo, hi] = bandBins(0, 96000, FFT, SR);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(FFT / 2 - 1);
  });

  it("gives at least one bin, even for a hair-thin band", () => {
    const [lo, hi] = bandBins(1000, 1000.001, FFT, SR);
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it("orders the edges even when they arrive backwards", () => {
    const [lo, hi] = bandBins(6000, 300, FFT, SR);
    expect(lo).toBeLessThanOrEqual(hi);
  });
});

describe("bandEdges", () => {
  it("starts the first band at the low corner", () => {
    expect(bandEdges(0, 24)[0]).toBeCloseTo(40, 3);
  });

  it("ends the last band at the top of the spread", () => {
    expect(bandEdges(23, 24)[1]).toBeCloseTo(40 * 340, 0);
  });

  it("is log-spaced: every band is the same ratio wide", () => {
    const ratio = (i: number) => {
      const [lo, hi] = bandEdges(i, 24);
      return hi / lo;
    };
    expect(ratio(0)).toBeCloseTo(ratio(12), 6);
    expect(ratio(12)).toBeCloseTo(ratio(23), 6);
  });

  it("hands neighbouring bands a shared edge, leaving no gap", () => {
    expect(bandEdges(5, 24)[1]).toBeCloseTo(bandEdges(6, 24)[0], 6);
  });
});

describe("mulberry32", () => {
  it("is deterministic, so the grain does not flicker between reloads", () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("gives different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("stays inside the unit interval", () => {
    const r = mulberry32(9001);
    for (let i = 0; i < 500; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
