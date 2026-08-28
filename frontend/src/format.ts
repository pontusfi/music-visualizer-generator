import type { JobState } from "./types";

/** Frames per second the renderer manages at a given output tier, keyed by the
 *  SHORT edge: 1080x1920 and 1920x1080 are the same number of pixels and cost
 *  the same, so the tier is what decides the rate, not which way it turns.
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

function rateFor(resolution: number): number {
  for (const [tier, rate] of MEASURED_RATE) {
    if (resolution <= tier) return rate;
  }
  return MEASURED_RATE[MEASURED_RATE.length - 1][1];
}

/** Rough wall-clock estimate, deliberately quoted as "about". ``videos`` is how
 *  many aspects this one upload is cut for: the analysis is shared but each cut
 *  draws every frame again, so two aspects really is twice the wait. */
export function estimateRenderMinutes(
  duration: number,
  fps: number,
  resolution: number,
  preview?: PreviewWindow | null,
  videos = 1,
): number {
  const frames = frameCount(duration, fps, preview);
  return (frames * videos) / rateFor(resolution) / 60;
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

export type LogTone = "step" | "bad" | "plain";

/** Words that only ever appear when something has gone wrong. */
const BAD = /\b(error|errors|failed|failure|fatal|traceback|exception|cannot|unexpectedly)\b/i;
/** Python names its exceptions NoBackendError, LibsndfileError, RuntimeError —
 *  no word boundary in front of "Error", so the word list above walks past them. */
const BAD_EXCEPTION = /[A-Za-z]Error\b/;
/** The lines that open a stage: the commands, and the mux at the end. */
const STEP = /(^|\s)(analyze\.py|render\.py|ffmpeg|chromium)\b/;

/** How a console line should read. The log is the only window into a render
 *  that has gone quiet, so the two lines that matter are worth finding fast. */
export function logTone(line: string): LogTone {
  if (BAD.test(line) || BAD_EXCEPTION.test(line)) return "bad";
  if (STEP.test(line)) return "step";
  return "plain";
}

/** A duration in minutes, said the way a person would say it. */
export function formatApprox(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes <= 1) return "a minute";
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  return `${(minutes / 60).toFixed(1)} hours`;
}
