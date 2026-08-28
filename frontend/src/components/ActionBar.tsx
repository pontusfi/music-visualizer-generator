import { videoUrl } from "../api";
import { estimateRenderMinutes, formatApprox, formatBytes, formatEta, stateLabel } from "../format";
import type { RenderSettings } from "../settings";
import type { Job } from "../types";

interface Props {
  settings: RenderSettings;
  duration: number | null;
  ready: boolean;
  busy: boolean;
  uploading: boolean;
  uploaded: number;
  bytesQueued: number;
  job: Job | null;
  onStart: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function ActionBar({
  settings,
  duration,
  ready,
  busy,
  uploading,
  uploaded,
  bytesQueued,
  job,
  onStart,
  onCancel,
  onReset,
}: Props) {
  const settled = job !== null && !busy;
  const done = job?.state === "done";
  const broken = job?.state === "failed" || job?.state === "cancelled";

  const frames = duration
    ? Math.round(
        (settings.previewEnabled
          ? Math.max(0, settings.previewEnd - settings.previewStart)
          : duration) * settings.fps,
      )
    : null;

  const minutes =
    duration == null
      ? null
      : estimateRenderMinutes(
          duration,
          settings.fps,
          settings.height,
          settings.previewEnabled
            ? { start: settings.previewStart, end: settings.previewEnd }
            : null,
        );

  const progress = uploading ? uploaded : (job?.progress ?? 0);
  const phase = uploading ? "Uploading" : job ? job.message || stateLabel(job.state) : "";

  const stats: string[] = [];
  if (uploading) {
    stats.push(`${formatBytes(bytesQueued * uploaded)} sent`);
  } else if (job?.state === "rendering") {
    if (job.frame != null && job.frames_total != null) {
      stats.push(
        `frame ${job.frame.toLocaleString()} / ${job.frames_total.toLocaleString()}`,
      );
    }
    if (job.rate != null) stats.push(`${job.rate.toFixed(1)} fps`);
    const eta = formatEta(job.eta_seconds);
    if (eta) stats.push(eta);
  } else if (job?.state === "analyzing") {
    stats.push(settings.hpss ? "librosa · hpss" : "librosa");
  }

  return (
    <footer className="action">
      {busy ? (
        <div className="action__progress">
          <span className="action__phase">{phase}</span>
          <div className="track">
            <div
              className={uploading ? "track__fill track__fill--upload" : "track__fill"}
              style={{ width: `${Math.max(1, progress * 100)}%` }}
            />
          </div>
          <span className="action__pct">{Math.round(progress * 100)}%</span>
          <span className="action__stats">{stats.join("  ·  ")}</span>
        </div>
      ) : (
        <div className="action__estimate">
          <span className="action__estimate-main">
            {settled
              ? done
                ? "Render complete"
                : broken && job?.state === "cancelled"
                  ? "Render cancelled"
                  : "Render failed"
              : ready
                ? `${settings.previewEnabled ? "Test window" : "Full render"}${
                    frames ? ` · ${frames.toLocaleString()} frames` : ""
                  } @ ${settings.height}p`
                : "Awaiting source"}
          </span>
          <span className="action__estimate-sub">
            {settled
              ? done
                ? "Two hours on the server, then it is swept"
                : "Nothing was written"
              : ready && minutes != null
                ? `About ${formatApprox(minutes)} of rendering`
                : "A cover and a master, then one button"}
          </span>
        </div>
      )}

      <div className="action__buttons">
        {busy && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        {settled && (
          <button type="button" className="btn" onClick={onReset}>
            {done ? "New render" : "Start over"}
          </button>
        )}
        {done && job && (
          <a className="btn btn--go" href={videoUrl(job.id, true)} download>
            Download mp4
          </a>
        )}
        {broken && (
          <button type="button" className="btn btn--go" onClick={onStart} disabled={!ready}>
            Retry render
          </button>
        )}
        {!busy && !settled && (
          <button
            type="button"
            className="btn btn--go"
            disabled={!ready}
            onClick={onStart}
          >
            {settings.previewEnabled ? "Render test" : "Render video"}
          </button>
        )}
      </div>
    </footer>
  );
}
