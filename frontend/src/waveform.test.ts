import { describe, expect, it } from "vitest";

import { computePeaks, PEAK_BUCKETS } from "./waveform";

describe("computePeaks", () => {
  it("always returns the number of buckets it was asked for", () => {
    expect(computePeaks(new Float32Array(1000), 64)).toHaveLength(64);
    expect(computePeaks(new Float32Array(3), 64)).toHaveLength(64);
    expect(computePeaks(new Float32Array(0), 64)).toHaveLength(64);
  });

  it("takes the loudest sample in each bucket", () => {
    const channel = Float32Array.from([0.1, 0.9, 0.2, 0.3, 0.4, 0.35]);
    const peaks = computePeaks(channel, 3);
    expect(peaks[0]).toBeCloseTo(0.9, 5);
    expect(peaks[1]).toBeCloseTo(0.3, 5);
    expect(peaks[2]).toBeCloseTo(0.4, 5);
  });

  it("measures loudness, not sign — a negative trough is a peak", () => {
    const peaks = computePeaks(Float32Array.from([-0.8, 0.2]), 1);
    expect(peaks[0]).toBeCloseTo(0.8, 5);
  });

  it("reads silence as silence", () => {
    expect(Array.from(computePeaks(new Float32Array(500), 8))).toEqual(
      new Array(8).fill(0),
    );
  });

  it("does not run off the end when there are fewer samples than buckets", () => {
    const peaks = computePeaks(Float32Array.from([0.5, 0.25]), 8);
    expect(peaks.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.max(...peaks)).toBeCloseTo(0.5, 5);
  });

  it("survives a NaN in the stream rather than poisoning the whole wave", () => {
    const peaks = computePeaks(Float32Array.from([0.4, NaN, 0.6, 0.1]), 2);
    expect(peaks.every((v) => Number.isFinite(v))).toBe(true);
    expect(peaks[1]).toBeCloseTo(0.6, 5);
  });

  it("rejects a nonsense bucket count instead of allocating nonsense", () => {
    expect(computePeaks(new Float32Array(100), 0)).toHaveLength(0);
    expect(computePeaks(new Float32Array(100), -5)).toHaveLength(0);
  });

  it("keeps a loud transient visible in a long quiet bucket", () => {
    // one sample of a snare in half a second of near-silence
    const channel = new Float32Array(20000);
    channel[9999] = 1;
    expect(computePeaks(channel, 1)[0]).toBeCloseTo(1, 5);
  });

  it("offers a default bucket count wide enough for a transport strip", () => {
    expect(PEAK_BUCKETS).toBeGreaterThanOrEqual(600);
  });
});
