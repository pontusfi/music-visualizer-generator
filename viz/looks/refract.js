/**
 * REFRACT — the cover seen through moving glass.
 *
 * The first look that is not Canvas2D. A domain-warped field fills the frame
 * and the artwork is refracted through it per pixel, with the colour splitting
 * where the glass bends hardest and a real two-pass bloom on top. Burn, Orbit
 * and Shear all open with a flat `fillRect` over the ground colour and
 * composite on to dead ground; here the ground is computed, and it moves with
 * the bass.
 *
 * Bloom is the honest reason this look exists. `burn` approximates it with ten
 * luminance masks thresholded at init, because blurring a 1080p frame per
 * frame in Canvas2D is not affordable; as a shader it is two passes at quarter
 * resolution and costs almost nothing.
 *
 * GL renders offscreen and is blitted into the 2D canvas, which keeps
 * `renderFrame` writing to `#c` exactly as before — the capture, the contact
 * sheet and the determinism harness all read that canvas. Grain, vignette and
 * type stay in 2D, where text rendering is better.
 *
 * The frame index is still the only clock: `uFrame` is the only thing that
 * advances, and the noise is a seeded texture rather than an in-shader hash,
 * which would not have been stable across GPU vendors.
 */

import { GLStage } from "../gl.js";
import { css, shiftHue } from "../palette.js";
import { uniformsFor } from "./refract.uniforms.js";

export const id = "refract";
export const name = "Refract";

/** Cells across the noise texture. 256 is smooth enough to warp and small
 *  enough to stay in cache on the software rasterizer. */
const NOISE = 256;
/** Bloom runs here; blurring at full resolution buys nothing visible. */
const BLOOM_SCALE = 0.25;
/** And so does the warp — see FIELD below for why it can. */
const FIELD_SCALE = 0.25;

/** Shared by every shader below: value noise from the seeded texture. */
const NOISE_LIB = `
uniform sampler2D uNoise;

// textureLod with an explicit level, never implicit LOD: derivative precision
// is implementation-defined and would differ between rasterizers
float vnoise(vec2 p) {
  return textureLod(uNoise, p / ${NOISE}.0, 0.0).r;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return v;
}
`;

/**
 * The warp, on its own, at a fraction of the frame.
 *
 * Fifteen texture fetches a pixel is what made the first version of this look
 * ten times the cost of the Canvas2D ones on the software rasterizer. The
 * field is low-frequency by construction — three octaves from a base of three
 * cycles across the frame, so about twelve cycles at the top end — and
 * bilinear upsampling from a quarter-width buffer is visually free. It is the
 * single change that took 1080p on SwiftShader from 96 ms to something the
 * container can actually run.
 *
 * Packed into one RGBA8 texel: the bend the cover refracts through in .xy, and
 * the field the background is coloured by in .z. Every fbm output is in
 * 0..0.875, so nothing needs a float target.
 */
const FIELD = `
${NOISE_LIB}
uniform vec2 uRes;
uniform vec2 uSeed;
uniform float uFrame;
uniform float uWarp;

void main() {
  // work in a square space so the field does not stretch in a 9:16 frame
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = vUv * aspect * 3.0 + uSeed;
  float t = uFrame * 0.004;

  // two rounds of domain warp: the first bends the space, the second bends
  // the bend. This is what stops it reading as sliding wallpaper.
  vec2 q = vec2(fbm(p + t), fbm(p + 17.3 - t));
  vec2 r = vec2(fbm(p + 4.0 * q * uWarp + t * 0.7),
                fbm(p + 4.0 * q * uWarp + 9.1));
  float f = fbm(p + 4.0 * r * uWarp);

  fragColor = vec4(r, f, 1.0);
}
`;

const SCENE = `
uniform sampler2D uCoverTex;
uniform sampler2D uFieldTex;
uniform vec2 uRes;
uniform vec4 uCover;
uniform float uField;
uniform float uDisplace;
uniform float uAberration;
uniform float uBright;
uniform vec3 uGround;
uniform vec3 uEmber;

void main() {
  vec3 field = textureLod(uFieldTex, vUv, 0.0).rgb;
  vec2 r = field.xy;
  float f = field.z;

  vec3 col = mix(uGround, uEmber, clamp(f * uField * 1.6, 0.0, 1.0));
  // a cooler counter-light where the field is thinnest, so the ground has
  // depth rather than being one colour at different strengths
  col += uGround * (1.0 - f) * 0.35;

  // --- the cover, refracted through the same field ------------------------
  vec2 cuv = (vUv - uCover.xy) / uCover.zw;
  // how hard the glass is bending here, from the warp itself
  vec2 bend = (r - 0.5) * 2.0;
  vec2 disp = bend * uDisplace / uCover.zw;

  vec2 ruv = cuv + disp * (1.0 + uAberration / max(uDisplace, 1e-5));
  vec2 guv = cuv + disp;
  vec2 buv = cuv + disp * (1.0 - uAberration / max(uDisplace, 1e-5));

  vec3 cover = vec3(
    textureLod(uCoverTex, clamp(ruv, 0.0, 1.0), 0.0).r,
    textureLod(uCoverTex, clamp(guv, 0.0, 1.0), 0.0).g,
    textureLod(uCoverTex, clamp(buv, 0.0, 1.0), 0.0).b
  );

  // a one-pixel feather on the edge, since MSAA is off by design
  vec2 fw = 1.5 / (uRes * uCover.zw);
  vec2 edge = smoothstep(vec2(0.0), fw, guv) * smoothstep(vec2(0.0), fw, 1.0 - guv);
  float inside = edge.x * edge.y;

  col = mix(col, cover * uBright, inside);

  // the field reads through the glass as a faint sheen
  col += uEmber * f * inside * 0.10;

  fragColor = vec4(col, 1.0);
}
`;

const BRIGHT = `
uniform sampler2D uSrc;
uniform float uCut;
void main() {
  vec3 c = textureLod(uSrc, vUv, 0.0).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(c * smoothstep(uCut, uCut + 0.25, l), 1.0);
}
`;

const BLUR = `
uniform sampler2D uSrc;
uniform vec2 uStep;
void main() {
  // a 9-tap gaussian, taken in one direction; run twice for a 2D blur at a
  // fraction of the cost of the 81 taps doing it in one pass would need
  float w[5] = float[](0.2270, 0.1946, 0.1216, 0.0540, 0.0162);
  vec3 sum = textureLod(uSrc, vUv, 0.0).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uStep * float(i);
    sum += textureLod(uSrc, vUv + o, 0.0).rgb * w[i];
    sum += textureLod(uSrc, vUv - o, 0.0).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE = `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmount;
void main() {
  vec3 scene = textureLod(uScene, vUv, 0.0).rgb;
  vec3 bloom = textureLod(uBloom, vUv, 0.0).rgb;
  vec3 col = scene + bloom * uBloomAmount;
  // a gentle shoulder, so a hard kick rolls off instead of clipping flat
  col = col / (1.0 + col * 0.30);
  fragColor = vec4(col, 1.0);
}
`;

export function init(a) {
  const gl = new GLStage(a.W, a.H);
  a.gl = gl;
  a.glProg = {
    field: gl.program(FIELD),
    scene: gl.program(SCENE),
    bright: gl.program(BRIGHT),
    blur: gl.program(BLUR),
    composite: gl.program(COMPOSITE),
  };
  a.glTex = {
    cover: gl.imageTexture(a.art),
    // seeded exactly like buildGrain, and for the same reason
    noise: gl.noiseTexture(NOISE, a.rng(20260829)),
  };
  a.glRt = {
    field: gl.target(FIELD_SCALE),
    scene: gl.target(1),
    a: gl.target(BLOOM_SCALE),
    b: gl.target(BLOOM_SCALE),
  };
}

export function draw(ctx, s, a) {
  const { gl, glProg, glTex, glRt, W, H, layout, palette } = a;
  const u = uniformsFor(s, a);

  gl.draw(glProg.field, {
    uniforms: u,
    textures: { uNoise: glTex.noise },
    target: glRt.field,
  });

  gl.draw(glProg.scene, {
    uniforms: u,
    textures: { uCoverTex: glTex.cover, uFieldTex: glRt.field.tex },
    target: glRt.scene,
  });

  gl.draw(glProg.bright, {
    uniforms: { uCut: 0.55 },
    textures: { uSrc: glRt.scene.tex },
    target: glRt.a,
  });
  gl.draw(glProg.blur, {
    uniforms: { uStep: [1 / glRt.a.w, 0] },
    textures: { uSrc: glRt.a.tex },
    target: glRt.b,
  });
  gl.draw(glProg.blur, {
    uniforms: { uStep: [0, 1 / glRt.b.h] },
    textures: { uSrc: glRt.b.tex },
    target: glRt.a,
  });

  gl.draw(glProg.composite, {
    uniforms: { uBloomAmount: u.uBloom },
    textures: { uScene: glRt.scene.tex, uBloom: glRt.a.tex },
  });

  ctx.drawImage(gl.canvas, 0, 0);

  // --- everything 2D is still better at -----------------------------------
  const { unit } = layout;
  const ember = css(shiftHue(palette.ember, (s.hue - 0.5) * 0.20 * s.tonal));

  if (a.artist || a.title) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${Math.round(unit * 0.008)}px`;
    ctx.fillStyle = ember;
    ctx.font = `${Math.round(unit * 0.016)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.globalAlpha = 0.5 + s.crack * 0.3;
    ctx.fillText(a.artist.toUpperCase(), W / 2, H * 0.90);
    ctx.fillStyle = palette.boneCss;
    ctx.font = `${Math.round(unit * 0.030)}px Display, "Oswald", "Helvetica Neue Condensed", sans-serif`;
    ctx.globalAlpha = 0.72 + s.crack * 0.24;
    ctx.fillText(a.title.toUpperCase(), W / 2, H * 0.955);
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
    ctx.textAlign = "left";
  }

  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.05 + s.hit * 0.03;
  ctx.drawImage(a.grain[s.i % a.grain.length], 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 0.75 + (1 - s.arc) * 0.25;
  ctx.drawImage(a.vignette, 0, 0);
  ctx.globalAlpha = 1;
}
