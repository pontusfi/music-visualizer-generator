/**
 * A WebGL2 canvas that composites into the 2D one.
 *
 * The look contract hands `draw` the 2D context of `#c`, and a canvas has
 * exactly one context type — so a shader look cannot take `#c` for itself, and
 * should not want to: `renderFrame` writing to `#c` is what the WebCodecs
 * capture, the contact sheet and the determinism harness all read. Instead a
 * look renders here and blits the result in with one `drawImage`, then carries
 * on in 2D for the things 2D is better at, which is type and grain.
 *
 * The two rules from main.js hold here too, in their shader form:
 *
 *   - The frame index is the only clock. Shaders take `uFrame`; there is no
 *     time uniform anywhere and nothing reads a real clock.
 *   - No `Math.random`, and no in-shader hash either. The usual
 *     `fract(sin(x) * 43758.5453)` is not stable across GPU vendors, or
 *     between SwiftShader and a real driver, so noise comes from a texture
 *     built once from a seeded generator — the same discipline buildGrain
 *     already follows.
 *
 * Also avoided, for the same reason: dFdx/dFdy/fwidth and implicit mipmap LOD,
 * whose precision is implementation-defined. Sampling is textureLod with an
 * explicit level.
 */

/** Every fragment shader gets the same header, so no look can forget it. */
const PREAMBLE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
`;

/**
 * A fullscreen triangle straight out of gl_VertexID — no buffers, no
 * attributes. Three vertices at (-1,-1), (3,-1), (-1,3) cover the viewport
 * with one primitive and no seam down the diagonal that two triangles have.
 */
const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Turn a compile failure into something that names the line. */
function annotate(src, log) {
  const lines = src.split("\n");
  const width = String(lines.length).length;
  return `${log}\n${lines
    .map((l, n) => `${String(n + 1).padStart(width)} | ${l}`)
    .join("\n")}`;
}

export class GLStage {
  constructor(W, H) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false, // MSAA sample positions are vendor-defined
      premultipliedAlpha: false,
      // reading the canvas back out via drawImage outside the same task is
      // undefined without this. renderFrame is synchronous today, so it would
      // work either way; one buffer is cheap insurance against that changing.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("this browser has no WebGL2");

    this.canvas = canvas;
    this.gl = gl;
    this.W = W;
    this.H = H;
    this._vs = this._compile(gl.VERTEX_SHADER, VERTEX);
    this._vao = gl.createVertexArray(); // WebGL2 requires one to be bound
    this._targets = [];
  }

  _compile(kind, src) {
    const { gl } = this;
    const sh = gl.createShader(kind);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || "(no log)";
      gl.deleteShader(sh);
      throw new Error(annotate(src, log));
    }
    return sh;
  }

  /** A fragment shader, linked against the shared fullscreen vertex shader. */
  program(fragment) {
    const { gl } = this;
    const src = PREAMBLE + fragment;
    const fs = this._compile(gl.FRAGMENT_SHADER, src);
    const p = gl.createProgram();
    gl.attachShader(p, this._vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) || "(no log)";
      throw new Error(annotate(src, log));
    }
    gl.deleteShader(fs);
    // uniform locations never change for a linked program, and looking them up
    // per frame is the kind of cost that only shows at 4K
    return { handle: p, loc: new Map() };
  }

  _location(program, name) {
    if (!program.loc.has(name)) {
      program.loc.set(name, this.gl.getUniformLocation(program.handle, name));
    }
    return program.loc.get(name);
  }

  /** A texture from anything drawable — the cover, or a 2D canvas. */
  imageTexture(source) {
    const { gl } = this;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // t=0 has to land on the image's *bottom* row: vUv.y=0 is the bottom of
    // the framebuffer, so without this every texture comes out upside down
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Tiling value noise, from a seeded generator.
   *
   * Four independent channels, so one fetch feeds four octaves' worth of
   * offsets. It repeats, which is exactly what makes it cheap and what the
   * domain warp then hides.
   */
  noiseTexture(size, rng) {
    const { gl } = this;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.floor(rng() * 256);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA,
                  gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  /** An offscreen surface to render into, at a fraction of the frame. */
  target(scale = 1) {
    const { gl } = this;
    const w = Math.max(1, Math.round(this.W * scale));
    const h = Math.max(1, Math.round(this.H * scale));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA,
                  gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                            gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = { fbo, tex, w, h };
    this._targets.push(t);
    return t;
  }

  /**
   * One fullscreen pass.
   *
   * `target` null means the visible canvas — the last pass of a frame.
   * Uniforms are typed by what they are: a number is a float, an array is a
   * vecN, and anything in `textures` binds to a sampler unit.
   */
  draw(program, { uniforms = {}, textures = {}, target = null } = {}) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.W, target ? target.h : this.H);
    gl.useProgram(program.handle);
    gl.bindVertexArray(this._vao);

    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this._location(program, name), unit);
      unit += 1;
    }

    for (const [name, value] of Object.entries(uniforms)) {
      const at = this._location(program, name);
      if (at === null) continue; // optimised out of this shader; not an error
      if (typeof value === "number") gl.uniform1f(at, value);
      else if (value.length === 2) gl.uniform2f(at, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(at, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(at, value[0], value[1], value[2], value[3]);
      else gl.uniform1fv(at, value);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
