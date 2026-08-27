import { useEffect, useRef } from "react";

import { formatEta, stateLabel } from "../format";
import type { Job } from "../types";

interface Props {
  /** null while the files are still going up — there is no job yet. */
  job: Job | null;
  uploaded: number;
  onCancel: () => void;
}

export function ProgressPanel({ job, uploaded, onCancel }: Props) {
  const logRef = useRef<HTMLPreElement>(null);
  const uploading = job === null;
  const log = job?.log ?? [];

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const pct = uploading ? uploaded : job.progress;
  const label = uploading
    ? "Uploading"
    : job.message || stateLabel(job.state);

  return (
    <section className="panel progress">
      <div className="progress__head">
        <h2>{label}</h2>
        <span className="progress__pct">{Math.round(pct * 100)}%</span>
      </div>

      <div className="bar">
        <div
          className={`bar__fill ${uploading ? "bar__fill--upload" : ""}`}
          style={{ width: `${Math.max(1, pct * 100)}%` }}
        />
      </div>

      <div className="progress__stats">
        {job?.frame != null && job.frames_total != null && (
          <span>
            frame {job.frame.toLocaleString()} / {job.frames_total.toLocaleString()}
          </span>
        )}
        {job?.rate != null && <span>{job.rate.toFixed(1)} fps</span>}
        <span>{formatEta(job?.eta_seconds)}</span>
      </div>

      <p className="note">
        {uploading
          ? "Sending the files. Big masters take a moment."
          : "Leave this tab open. The render runs on the server, but closing the page means losing the link to it."}
      </p>

      {log.length > 0 && (
        <pre className="log" ref={logRef}>
          {log.join("\n")}
        </pre>
      )}

      <button type="button" className="button button--ghost" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
