import { videoUrl } from "../api";
import { formatClock } from "../format";
import type { Job } from "../types";

interface Props {
  job: Job;
  onRestart: () => void;
}

export function ResultPanel({ job, onRestart }: Props) {
  const took =
    job.finished_at && job.started_at ? job.finished_at - job.started_at : null;

  if (job.state === "failed" || job.state === "cancelled") {
    return (
      <section className="panel result">
        <h2 className={job.state === "failed" ? "bad" : ""}>
          {job.state === "failed" ? "The render failed" : "Cancelled"}
        </h2>
        {job.error && <p className="error">{job.error}</p>}
        {job.log.length > 0 && <pre className="log">{job.log.slice(-25).join("\n")}</pre>}
        <button type="button" className="button" onClick={onRestart}>
          Start over
        </button>
      </section>
    );
  }

  return (
    <section className="panel result">
      <h2>Done{took ? ` in ${formatClock(took)}` : ""}</h2>
      <video className="result__video" src={videoUrl(job.id)} controls playsInline />
      <div className="result__actions">
        <a className="button" href={videoUrl(job.id, true)} download>
          Download mp4
        </a>
        <button type="button" className="button button--ghost" onClick={onRestart}>
          Make another
        </button>
      </div>
      <p className="note">
        The file lives on the server for two hours, then it is swept. Download it
        now.
      </p>
    </section>
  );
}
