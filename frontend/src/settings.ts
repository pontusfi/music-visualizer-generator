export interface RenderSettings {
  artist: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  crf: number;
  preset: string;
  bands: number;
  hpss: boolean;
  previewEnabled: boolean;
  previewStart: number;
  previewEnd: number;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  artist: "",
  title: "",
  fps: 60,
  width: 1920,
  height: 1080,
  crf: 16,
  preset: "slow",
  bands: 24,
  hpss: true,
  previewEnabled: false,
  previewStart: 30,
  previewEnd: 45,
};

export const RESOLUTIONS = [
  { label: "720p", width: 1280, height: 720, note: "fastest" },
  { label: "1080p", width: 1920, height: 1080, note: "delivery" },
  { label: "1440p", width: 2560, height: 1440, note: "slow" },
  { label: "4K", width: 3840, height: 2160, note: "overnight" },
];

export const QUALITIES = [
  { label: "Archive", crf: 14, note: "biggest file" },
  { label: "High", crf: 16, note: "default" },
  { label: "Balanced", crf: 20, note: "" },
  { label: "Compact", crf: 23, note: "smallest" },
];

export const PRESETS = ["veryfast", "faster", "fast", "medium", "slow", "slower"];

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
  form.append("width", String(settings.width));
  form.append("height", String(settings.height));
  form.append("title", settings.title.trim());
  form.append("artist", settings.artist.trim());
  form.append("crf", String(settings.crf));
  form.append("preset", settings.preset);
  form.append("bands", String(settings.bands));
  form.append("hpss", settings.hpss ? "true" : "false");
  if (settings.previewEnabled) {
    form.append("preview_start", String(settings.previewStart));
    form.append("preview_end", String(settings.previewEnd));
  }
  return form;
}
