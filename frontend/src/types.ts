export type JobState =
  | "queued"
  | "analyzing"
  | "rendering"
  | "done"
  | "failed"
  | "cancelled";

export interface JobParams {
  fps: number;
  sample_rate: number;
  width: number;
  height: number;
  title: string;
  artist: string;
  crf: number;
  preset: string;
  bands: number;
  hpss: boolean;
  preview_start: number | null;
  preview_end: number | null;
}

export interface Job {
  id: string;
  state: JobState;
  progress: number;
  message: string;
  error: string | null;
  params: JobParams;
  image_filename: string;
  audio_filename: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  frame: number | null;
  frames_total: number | null;
  rate: number | null;
  eta_seconds: number | null;
  log: string[];
}

export interface Health {
  status: string;
  tools: { ffmpeg: boolean; chromium: boolean; librosa: boolean };
  accepts: { image: string[]; audio: string[] };
  limits: {
    max_image_bytes: number;
    max_audio_bytes: number;
    sample_rate: number;
  };
}
