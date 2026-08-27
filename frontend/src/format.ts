import type { JobState } from "./types";

/** Frames per second the renderer manages at a given output height.
 *  Measured in a container with software rasterisation; a real machine beats it. */
const MEASURED_RATE: Array<[number, number]> = [
  [720, 11],
  [1080, 8],
  [1440, 4.5],
  [2160, 2],
];

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `~${Math.round(seconds)}s left`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min left`;
  return `~${(seconds / 3600).toFixed(1)} h left`;
}

export interface PreviewWindow {
  start: number;
  end: number;
}

/** How many frames a job will actually draw. */
export function frameCount(
  duration: number,
  fps: number,
  preview?: PreviewWindow | null,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!preview) return Math.round(duration * fps);
  const start = Math.max(0, Math.min(preview.start, duration));
  const end = Math.max(start, Math.min(preview.end, duration));
  return Math.round((end - start) * fps);
}

function rateFor(height: number): number {
  for (const [h, rate] of MEASURED_RATE) {
    if (height <= h) return rate;
  }
  return MEASURED_RATE[MEASURED_RATE.length - 1][1];
}

/** Rough wall-clock estimate, deliberately quoted as "about". */
export function estimateRenderMinutes(
  duration: number,
  fps: number,
  height: number,
  preview?: PreviewWindow | null,
): number {
  const frames = frameCount(duration, fps, preview);
  return frames / rateFor(height) / 60;
}

const LABELS: Record<JobState, string> = {
  queued: "Queued",
  analyzing: "Analysing audio",
  rendering: "Rendering frames",
  done: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function stateLabel(state: JobState): string {
  return LABELS[state] ?? state;
}
