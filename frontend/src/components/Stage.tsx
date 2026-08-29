import { type RefObject, useState } from "react";

import { videoUrl } from "../api";
import { formatClock } from "../format";
import { DEFAULT_GAIN, type Gain } from "../player/controls";
import { type Aspect, plannedOutputs, type RenderSettings } from "../settings";
import type { Job } from "../types";
import { Player } from "./Player";

interface Props {
  stageRef: RefObject<HTMLCanvasElement | null>;
  settings: RenderSettings;
  duration: number | null;
  hasCover: boolean;
  playing: boolean;
  job: Job | null;
  /** Stops the source monitor when the result starts, so one song plays at a time. */
  onPlay?: () => void;
}

/** What the stage is showing: the aspects a finished job actually produced,
 *  or — before that — the ones the current settings will produce. */
function shownOutputs(settings: RenderSettings, job: Job | null) {
  if (job?.state === "done") {
    const done = job.outputs.filter((o) => o.done);
    if (done.length) {
      return done.map((o) => ({
        aspect: o.aspect as Aspect,
        width: o.width,
        height: o.height,
        variant: o.key,
      }));
    }
  }
  return plannedOutputs(settings).map((o) => ({ ...o, variant: null }));
}

export function Stage({
  stageRef,
  settings,
  duration,
  hasCover,
  playing,
  job,
  onPlay,
}: Props) {
  const [chosen, setChosen] = useState<Aspect | null>(null);
  // above the key= boundary below, or switching aspect resets the volume
  const [gain, setGain] = useState<Gain>(DEFAULT_GAIN);

  const outputs = shownOutputs(settings, job);
  // the choice is a preference, not a source of truth: unticking an aspect, or
  // a job that rendered a different set, falls back to the first one going
  const active = outputs.find((o) => o.aspect === chosen) ?? outputs[0];

  const done = job?.state === "done" && active.variant !== null;
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
          {outputs.length > 1 && (
            <span className="stage__tabs" role="group" aria-label="Aspect ratio">
              {outputs.map((o) => (
                <button
                  key={o.aspect}
                  type="button"
                  className={
                    o.aspect === active.aspect ? "stage__tab stage__tab--on" : "stage__tab"
                  }
                  aria-pressed={o.aspect === active.aspect}
                  onClick={() => setChosen(o.aspect)}
                >
                  {o.aspect}
                </button>
              ))}
            </span>
          )}
          <span className="mono-dim">
            {active.width}×{active.height} · {settings.fps} fps · crf {settings.crf} ·{" "}
            {settings.preset}
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
        <div
          className="stage__canvas"
          style={{ aspectRatio: `${active.width} / ${active.height}` }}
        >
          {done && job ? (
            <Player
              // a fresh element per aspect, or the browser keeps the old frames
              key={active.variant}
              src={videoUrl(job.id, active.variant)}
              downloadUrl={videoUrl(job.id, active.variant, true)}
              gain={gain}
              onGain={setGain}
              onPlay={onPlay}
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
