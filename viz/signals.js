/**
 * What is happening at frame i.
 *
 * Everything a look needs to read is assembled here, so the draw code never
 * touches frames.json directly and never has to know which version wrote it.
 * No canvas, no globals, no clock — this file is a pure function of the frame
 * index, which is what keeps the render deterministic.
 */

/** Stand-in for "this has never happened", large enough that any decay is 0. */
export const NONE = 1e9;

/**
 * Frames elapsed since the most recent event at or before each frame.
 *
 * Precomputed once so a one-shot that runs for twenty frames costs one array
 * lookup at draw time, rather than a search back through the event list — and,
 * more importantly, so it stays a pure function of i instead of needing state
 * carried from the previous frame.
 */
export function sincePrev(events, T, none = NONE) {
  const n = Math.max(0, T | 0);
  const out = new Float64Array(n);
  if (n === 0) return out;
  out.fill(none);

  const sorted = [...(events ?? [])]
    .map((v) => v | 0)
    .filter((v) => v >= 0 && v < n)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return out;

  let next = 0;
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    while (next < sorted.length && sorted[next] === i) {
      last = i;
      next += 1;
    }
    if (last >= 0) out[i] = i - last;
  }
  return out;
}

/** 1 at the event, falling linearly to 0 `length` frames later. */
export function decay(since, length) {
  if (!(length > 0)) return 0;
  if (since <= 0) return 1;
  if (since >= length) return 0;
  return 1 - since / length;
}

/** How long a beat flash and an onset flash last, in frames. */
const BEAT_PULSE = 14;
const ONSET_PULSE = 10;

const num = (v) => (Number.isFinite(v) ? v : 0);

export class Signals {
  constructor(F) {
    const data = F ?? {};
    this.F = data;
    this.frames = Math.max(0, data.frames | 0);
    this.fps = data.fps || 60;
    this.bands = data.bands | 0 || (data.spectrum?.[0]?.length ?? 0);
    this.tempo = data.tempo || 0;
    this.meter = data.meter || 4;
    this.duration = data.duration || this.frames / this.fps;

    // v1 files predate every one of these; a look should get a flat signal
    // rather than an exception
    this._zeros = new Array(this.frames).fill(0);
    this._chromaZero = new Array(12).fill(0);
    this._specZero = new Array(Math.max(0, this.bands)).fill(0);

    this.beats = data.beats ?? [];
    this.downbeats = data.downbeats ?? [];
    this.onsets = data.onsets ?? [];
    this.sections = data.sections ?? [];

    this._sinceBeat = sincePrev(this.beats, this.frames);
    this._sinceDownbeat = sincePrev(this.downbeats, this.frames);
    this._sinceOnset = sincePrev(this.onsets, this.frames);
    this._sinceSection = sincePrev(this.sections, this.frames);
  }

  /** One track, or a flat one if this file never had it. */
  _track(name) {
    const a = this.F[name];
    return Array.isArray(a) && a.length ? a : this._zeros;
  }

  at(i) {
    const n = Math.max(0, Math.min(this.frames - 1, i | 0));
    const g = (name) => num(this._track(name)[n]);

    const spectrumRow = this.F.spectrum?.[n];
    const spectrum =
      Array.isArray(spectrumRow) && spectrumRow.length ? spectrumRow : this._specZero;

    let chroma = this._chromaZero;
    if (Array.isArray(this.F.chroma) && this.F.chroma.length === 12) {
      chroma = this.F.chroma.map((row) => num(row?.[n]));
    }

    const sinceBeat = this._sinceBeat[n] ?? NONE;
    const sinceDownbeat = this._sinceDownbeat[n] ?? NONE;
    const sinceOnset = this._sinceOnset[n] ?? NONE;
    const sinceSection = this._sinceSection[n] ?? NONE;

    return {
      i: n,
      // v1 drivers
      kick: g("kick"),
      crack: g("crack"),
      wall: g("wall"),
      hit: g("hit"),
      rms: g("rms"),
      spectrum,
      // v2 drivers
      beatPhase: g("beatPhase"),
      barPhase: g("barPhase"),
      sectionPhase: g("sectionPhase"),
      hue: g("hue"),
      tonal: g("tonal"),
      bright: g("bright"),
      drive: g("drive"),
      arc: g("arc"),
      section: this._track("sectionIndex")[n] | 0,
      chroma,
      // discrete events, as ages — the basis of every one-shot
      sinceBeat,
      sinceDownbeat,
      sinceOnset,
      sinceSection,
      beatPulse: decay(sinceBeat, BEAT_PULSE),
      downbeatPulse: decay(sinceDownbeat, BEAT_PULSE),
      onsetPulse: decay(sinceOnset, ONSET_PULSE),
    };
  }
}
