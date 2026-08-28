import { describe, expect, it } from "vitest";

import { extractAccent, hslToHex } from "./accent";

const FALLBACK = "#d2683a";

/** A flat field of one RGB colour, as RGBA bytes. */
function field(r: number, g: number, b: number, count = 256): Uint8ClampedArray {
  const px = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
}

function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("hslToHex", () => {
  it("maps the primaries", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
  });

  it("maps the greys", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(210, 0, 1)).toBe("#ffffff");
  });

  it("always returns six hex digits", () => {
    for (const h of [17, 99, 183, 271, 355]) {
      expect(hslToHex(h, 0.6, 0.55)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("extractAccent", () => {
  it("falls back when there is nothing to sample", () => {
    expect(extractAccent(new Uint8ClampedArray(0), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back on a greyscale cover, which has no hue to steal", () => {
    expect(extractAccent(field(90, 90, 90), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when every pixel is near-black", () => {
    expect(extractAccent(field(4, 2, 1), FALLBACK)).toBe(FALLBACK);
  });

  it("finds the hue of a saturated cover", () => {
    // a mid orange, hue ~25deg
    const hue = hueOf(extractAccent(field(200, 100, 40), FALLBACK));
    expect(Math.abs(hue - 25)).toBeLessThan(20);
  });

  it("finds a cold hue too, rather than always drifting warm", () => {
    // a mid blue, hue ~215deg
    const hue = hueOf(extractAccent(field(40, 110, 200), FALLBACK));
    expect(Math.abs(hue - 215)).toBeLessThan(20);
  });

  it("picks the saturated minority over a desaturated majority", () => {
    const px = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < px.length; i += 4) {
      const saturated = i < 40 * 4; // a tenth of the pixels
      px[i] = saturated ? 40 : 70;
      px[i + 1] = saturated ? 110 : 70;
      px[i + 2] = saturated ? 200 : 70;
      px[i + 3] = 255;
    }
    expect(Math.abs(hueOf(extractAccent(px, FALLBACK)) - 215)).toBeLessThan(20);
  });

  it("keeps the accent bright enough to read on the dark shell", () => {
    // a very dark, very saturated red would be illegible as an accent
    const hex = extractAccent(field(70, 8, 8), FALLBACK);
    const lum =
      parseInt(hex.slice(1, 3), 16) * 0.299 +
      parseInt(hex.slice(3, 5), 16) * 0.587 +
      parseInt(hex.slice(5, 7), 16) * 0.114;
    expect(lum).toBeGreaterThan(60);
  });

  it("is stable: the same pixels give the same accent", () => {
    const px = field(200, 100, 40);
    expect(extractAccent(px, FALLBACK)).toBe(extractAccent(px, FALLBACK));
  });

  it("ignores fully transparent pixels", () => {
    const px = field(40, 110, 200, 200);
    for (let i = 0; i < 100 * 4; i += 4) {
      px[i] = 220; // a bright orange, but invisible
      px[i + 1] = 120;
      px[i + 2] = 30;
      px[i + 3] = 0;
    }
    expect(Math.abs(hueOf(extractAccent(px, FALLBACK)) - 215)).toBeLessThan(20);
  });
});
