import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rayTransform } from "./rays.js";

describe("Rays' transform", () => {
  it("is a function of barPhase and downbeatPulse alone", () => {
    assert.deepEqual(rayTransform(0.4, 0.2), rayTransform(0.4, 0.2));
  });

  it("is finite for a v1 frames.json, where both are missing", () => {
    const { angle, scale } = rayTransform(undefined, undefined);
    assert.ok(Number.isFinite(angle));
    assert.ok(Number.isFinite(scale));
  });

  it("turns a full circle over one bar", () => {
    assert.equal(rayTransform(0, 0).angle, 0);
    assert.ok(Math.abs(rayTransform(0.5, 0).angle - Math.PI) < 1e-9);
  });

  it("flares outward on the downbeat", () => {
    const rest = rayTransform(0.1, 0);
    const hit = rayTransform(0.1, 1);
    assert.ok(hit.scale > rest.scale);
  });
});
