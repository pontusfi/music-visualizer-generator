// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { bestDuration, probeDuration } from "./audio";

const file = () =>
  new File([new Uint8Array([1, 2, 3])], "track.wav", { type: "audio/wav" });

afterEach(() => {
  // @ts-expect-error jsdom has no object URLs; tests add and remove them
  delete URL.createObjectURL;
  // @ts-expect-error see above
  delete URL.revokeObjectURL;
});

function stubObjectUrls() {
  URL.createObjectURL = () => "blob:stub";
  URL.revokeObjectURL = () => undefined;
}

describe("probeDuration", () => {
  it("gives up rather than saying 'reading…' forever", async () => {
    // metadata that never arrives is what a capture extension that hijacks
    // <audio> elements looks like from here
    stubObjectUrls();
    const started = Date.now();
    expect(await probeDuration(file(), 60)).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("resolves rather than rejecting when the browser has no object URLs", async () => {
    await expect(probeDuration(file(), 60)).resolves.toBeNull();
  });
});

describe("bestDuration", () => {
  it("takes the first real answer", () => {
    expect(bestDuration(null, 462)).toBe(462);
  });

  it("never lets a later 'I do not know' erase a length already known", () => {
    // the metadata probe times out at five seconds; the waveform decode often
    // lands first. The timeout must not overwrite what the decode found.
    expect(bestDuration(462, null)).toBe(462);
    expect(bestDuration(462, undefined)).toBe(462);
  });

  it("keeps the answer it already has rather than churning it", () => {
    expect(bestDuration(462, 461.98)).toBe(462);
  });

  it("stays null while neither source has answered", () => {
    expect(bestDuration(null, null)).toBeNull();
  });

  it("refuses lengths that are not lengths", () => {
    expect(bestDuration(null, 0)).toBeNull();
    expect(bestDuration(null, -3)).toBeNull();
    expect(bestDuration(null, Number.NaN)).toBeNull();
    expect(bestDuration(null, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("replaces a nonsense length it is somehow holding", () => {
    expect(bestDuration(Number.NaN, 462)).toBe(462);
    expect(bestDuration(0, 462)).toBe(462);
  });
});
