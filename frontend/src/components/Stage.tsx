import type { RefObject } from "react";

import { formatClock } from "../format";
import type { RenderSettings } from "../settings";
import type { Job } from "../types";

interface Props {
  stageRef: RefObject<HTMLCanvasElement | null>;
  settings: RenderSettings;
  duration: number | null;
  hasCover: boolean;
  playing: boolean;
  job: Job | null;
  /** Set once the render lands, and the stage shows the mp4 instead of the canvas. */
  videoSrc: string | null;
}

export function Stage({
  stageRef,
  settings,
  duration,
  hasCover,
  playing,
  job,
  videoSrc,
}: Props) {
  const done = job?.state === "done" && videoSrc !== null;
  const broken = job?.state === "failed" || job?.state === "cancelled";
  const took =
    job?.finished_at && job?.started_at ? job.finished_at - job.started_at : null;

  const frames = duration
    ? Math.round(
        (settings.previewEnabled
          ? Math.max(0, settings.previewEnd - settings.previewStart)
          : duration) * settings.fps,
      )
    : null;

  return (
    <div className="stage">
      <div className="stage__bar">
        <div className="stage__bar-left">
          <span className="stage__label">{done ? "Result" : "Preview"}</span>
          <span className="stage__pipe" aria-hidden="true">
            |
          </span>
          <span className="mono-dim">
            {settings.width}×{settings.height} · {settings.fps} fps · crf{" "}
            {settings.crf} · {settings.preset}
          </span>
        </div>
        <div className="stage__bar-right">
          <span className="mono-dim">
            {settings.previewEnabled
              ? `Window ${formatClock(settings.previewStart)}–${formatClock(
                  settings.previewEnd,
                )}`
              : `Full length${frames ? ` · ${frames.toLocaleString()} frames` : ""}`}
          </span>
          <span className="stage__pipe" aria-hidden="true">
            |
          </span>
          {done ? (
            <span className="lamp lamp--live">
              <span className="lamp__dot" />
              {took ? `Settled in ${formatClock(took)}` : "Settled"}
            </span>
          ) : (
            <span className={playing ? "lamp lamp--live" : "lamp lamp--idle"}>
              <span className="lamp__dot" />
              {playing ? "Live" : "Idle"}
            </span>
          )}
        </div>
      </div>

      <div className="stage__frame">
        <div className="stage__canvas">
          {done ? (
            <video
              className="stage__video"
              src={videoSrc}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <canvas ref={stageRef} />
          )}

          {!hasCover && !broken && !done && (
            <div className="stage__empty">
              <span className="stage__diamond" aria-hidden="true" />
              <p className="stage__empty-title">Drop a cover to begin</p>
              <p className="stage__empty-sub">
                The UI takes its colour from your artwork
              </p>
            </div>
          )}

          {broken && job && (
            <div className="stage__overlay">
              <span className="stage__tag stage__tag--bad">
                {job.state === "cancelled" ? "Sigterm" : "Exit 1"}
              </span>
              <h2 className="stage__overlay-title">
                {job.state === "cancelled" ? "Cancelled" : "The render failed"}
              </h2>
              <p className="stage__overlay-sub">
                {job.state === "cancelled"
                  ? "The stage was killed mid-frame. Nothing was written."
                  : job.error || "The console below has the tail."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
