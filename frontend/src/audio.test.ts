// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { probeDuration } from "./audio";

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
