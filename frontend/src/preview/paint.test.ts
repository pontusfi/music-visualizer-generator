import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CREDIT_RATIO } from "./paint";

/**
 * The render's own source of truth, read as text rather than imported.
 *
 * An ES import of viz/credit.js would ask `tsc -b` to resolve a module
 * outside the frontend's own directory — fine in local dev, where the whole
 * repo checkout is present, but the frontend's Docker build context is
 * `./frontend` alone, and `npm run build` runs `tsc -b` before `vite build`.
 * A static import there fails the container build outright. Reading the file
 * as text sidesteps module resolution entirely: this test still fails loudly
 * if the two numbers drift apart, it just never runs as part of `npm run
 * build`, only under `vitest`, which is invoked with the full repo checked
 * out.
 */
function creditShare(name: "artist" | "title"): number {
  const source = readFileSync(
    new URL("../../../viz/credit.js", import.meta.url),
    "utf-8",
  );
  const match = source.match(new RegExp(`\\b${name}:\\s*([0-9.]+)`));
  if (!match) throw new Error(`could not find CREDIT.${name} in viz/credit.js`);
  return Number(match[1]);
}

describe("the preview's credit ratios", () => {
  it("match the render's shared credit renderer", () => {
    // if viz/credit.js ever changes its sizes and this file does not, the
    // stage goes back to promising a burn-in the render does not produce —
    // the exact bug this pins shut
    expect(CREDIT_RATIO.artist).toBe(creditShare("artist"));
    expect(CREDIT_RATIO.title).toBe(creditShare("title"));
  });

  it("keeps title larger than artist, the way the render does", () => {
    expect(CREDIT_RATIO.title).toBeGreaterThan(CREDIT_RATIO.artist);
  });
});
