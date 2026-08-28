export type Aspect = "16:9" | "9:16";

export interface RenderSettings {
  artist: string;
  title: string;
  fps: number;
  /** The SHORT edge of the frame, so one number covers both orientations. */
  resolution: number;
  /** One cut, or both off the same upload. Never empty. */
  aspects: Aspect[];
  crf: number;
  preset: string;
  bands: number;
  hpss: boolean;
  /** which design viz/looks draws; see LOOKS below */
  look: string;
  previewEnabled: boolean;
  previewStart: number;
  previewEnd: number;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  artist: "",
  title: "",
  fps: 60,
  resolution: 1080,
  aspects: ["16:9"],
  crf: 16,
  preset: "slow",
  bands: 24,
  hpss: true,
  look: "burn",
  previewEnabled: false,
  previewStart: 30,
  previewEnd: 45,
};

export interface AspectOption {
  id: Aspect;
  label: string;
  note: string;
  /** What the server calls this output in a URL and on disk. */
  variant: string;
}

/** Declaration order is render order: the desktop cut comes out first. */
export const ASPECTS: AspectOption[] = [
  { id: "16:9", label: "16:9", note: "desktop", variant: "landscape" },
  { id: "9:16", label: "9:16", note: "phone", variant: "portrait" },
];

export const RESOLUTIONS = [
  { label: "720p", short: 720, note: "fastest" },
  { label: "1080p", short: 1080, note: "delivery" },
  { label: "1440p", short: 1440, note: "slow" },
  { label: "4K", short: 2160, note: "overnight" },
];

export const QUALITIES = [
  { label: "Archive", crf: 14, note: "biggest file" },
  { label: "High", crf: 16, note: "default" },
  { label: "Balanced", crf: 20, note: "" },
  { label: "Compact", crf: 23, note: "smallest" },
];

export const PRESETS = ["veryfast", "faster", "fast", "medium", "slow", "slower"];

const RATIOS: Record<Aspect, [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
};

/** yuv420p subsamples chroma, so both edges have to be even. */
const even = (value: number) => Math.round(value / 2) * 2;

export function dimensions(
  resolution: number,
  aspect: Aspect,
): { width: number; height: number } {
  const [wr, hr] = RATIOS[aspect];
  const scale = resolution / Math.min(wr, hr);
  return { width: even(wr * scale), height: even(hr * scale) };
}

export function variantOf(aspect: Aspect): string {
  return ASPECTS.find((a) => a.id === aspect)!.variant;
}

/** In render order, whatever order the buttons were clicked in. */
export function orderedAspects(aspects: Aspect[]): Aspect[] {
  return ASPECTS.map((a) => a.id).filter((id) => aspects.includes(id));
}

export interface PlannedOutput {
  aspect: Aspect;
  width: number;
  height: number;
}

/** The videos this upload will produce, in the order the server renders them. */
export function plannedOutputs(settings: RenderSettings): PlannedOutput[] {
  return orderedAspects(settings.aspects).map((aspect) => ({
    aspect,
    ...dimensions(settings.resolution, aspect),
  }));
}

/** Switching an aspect on or off. The last one on cannot be switched off —
 *  a job with nothing to render is not a state worth being able to reach. */
export function toggleAspect(settings: RenderSettings, aspect: Aspect): Aspect[] {
  const on = settings.aspects.includes(aspect);
  if (on && settings.aspects.length === 1) return settings.aspects;
  const next = on
    ? settings.aspects.filter((a) => a !== aspect)
    : [...settings.aspects, aspect];
  return orderedAspects(next);
}

/** Everything the POST needs, in the shape the FastAPI form expects. */
export function toFormData(
  settings: RenderSettings,
  image: File,
  audio: File,
): FormData {
  const form = new FormData();
  form.append("image", image);
  form.append("audio", audio);
  form.append("fps", String(settings.fps));
  form.append("resolution", String(settings.resolution));
  // a repeated key is how a list reaches FastAPI's Form(...)
  for (const aspect of orderedAspects(settings.aspects)) {
    form.append("aspects", aspect);
  }
  form.append("title", settings.title.trim());
  form.append("artist", settings.artist.trim());
  form.append("crf", String(settings.crf));
  form.append("preset", settings.preset);
  form.append("bands", String(settings.bands));
  form.append("hpss", settings.hpss ? "true" : "false");
  form.append("look", settings.look);
  if (settings.previewEnabled) {
    form.append("preview_start", String(settings.previewStart));
    form.append("preview_end", String(settings.previewEnd));
  }
  return form;
}

export interface OutputPreset {
  id: string;
  name: string;
  /** The one-line spec printed under the name. */
  spec: string;
  resolution: number;
  fps: number;
  crf: number;
  preset: string;
  previewEnabled: boolean;
}

/** The three renders anyone actually asks for. Everything else is Advanced. */
export const OUTPUT_PRESETS: OutputPreset[] = [
  {
    id: "test",
    name: "Test window",
    spec: "720p · 60 · short window",
    resolution: 720,
    fps: 60,
    crf: 20,
    preset: "slow",
    previewEnabled: true,
  },
  {
    id: "deliver",
    name: "Delivery",
    spec: "1080p · 60 · crf 16 · slow",
    resolution: 1080,
    fps: 60,
    crf: 16,
    preset: "slow",
    previewEnabled: false,
  },
  {
    id: "master",
    name: "Master",
    spec: "2160p · 60 · crf 14 · slower",
    resolution: 2160,
    fps: 60,
    crf: 14,
    preset: "slower",
    previewEnabled: false,
  },
];

/** The fields a preset speaks for. Anything outside this list — the credit
 *  line, the analysis settings, which aspects to cut, where the test window
 *  sits — is the user's, and a preset must not reach in and reset it. */
const PRESET_FIELDS = [
  "resolution",
  "fps",
  "crf",
  "preset",
  "previewEnabled",
] as const;

export function applyPreset(
  settings: RenderSettings,
  preset: OutputPreset,
): RenderSettings {
  const next = { ...settings };
  for (const field of PRESET_FIELDS) {
    // each key is assigned from the matching key, so the types line up
    (next[field] as RenderSettings[typeof field]) = preset[field];
  }
  return next;
}

/** Which preset these settings are, or null for a custom render. */
export function matchPreset(settings: RenderSettings): string | null {
  const hit = OUTPUT_PRESETS.find((preset) =>
    PRESET_FIELDS.every((field) => settings[field] === preset[field]),
  );
  return hit ? hit.id : null;
}

export interface Look {
  id: string;
  name: string;
  /** One line for the picker: what it does, not how. */
  note: string;
}

/** Must stay in step with viz/looks/index.js and schemas.LOOKS.
 *  A backend test asserts every id here has a registered module. */
export const LOOKS: Look[] = [
  {
    id: "burn",
    name: "Burn",
    note: "the cover ignites from its own highlights on every kick",
  },
  {
    id: "orbit",
    name: "Orbit",
    note: "the record spins, spectrum wrapped round the rim",
  },
  {
    id: "shear",
    name: "Shear",
    note: "the artwork tears along the spectrum and reassembles",
  },
];
