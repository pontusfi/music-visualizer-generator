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
  resolution: number;
  aspects: string[];
  title: string;
  artist: string;
  crf: number;
  preset: string;
  bands: number;
  hpss: boolean;
  preview_start: number | null;
  preview_end: number | null;
}

/** One of the videos a job renders. */
export interface JobOutput {
  key: string;
  aspect: string;
  width: number;
  height: number;
  done: boolean;
}

export interface Job {
  id: string;
  state: JobState;
  progress: number;
  message: string;
  error: string | null;
  params: JobParams;
  outputs: JobOutput[];
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
