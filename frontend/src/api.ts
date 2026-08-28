import type { Health, Job } from "./types";

const BASE: string = import.meta.env.VITE_API_BASE ?? "";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* a non-JSON error body is not worth another failure */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const getHealth = () => fetch(`${BASE}/api/health`).then(json<Health>);

export const getJob = (id: string) =>
  fetch(`${BASE}/api/jobs/${id}`).then(json<Job>);

export const cancelJob = (id: string) =>
  fetch(`${BASE}/api/jobs/${id}/cancel`, { method: "POST" }).then(json<Job>);

export const deleteJob = (id: string) =>
  fetch(`${BASE}/api/jobs/${id}`, { method: "DELETE" });

/** ``variant`` is the server's name for one aspect of a job ("landscape" /
 *  "portrait"); left off, the server serves whichever finished first. */
export const videoUrl = (id: string, variant?: string | null, download = false) => {
  const query = new URLSearchParams();
  if (variant) query.set("variant", variant);
  if (download) query.set("download", "1");
  const suffix = query.toString();
  return `${BASE}/api/jobs/${id}/video${suffix ? `?${suffix}` : ""}`;
};

/** POSTs the two files. XHR rather than fetch, because a 90 MB master deserves
 *  an upload bar of its own. */
export function createJob(
  data: FormData,
  onUploaded: (fraction: number) => void,
): { promise: Promise<Job>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Job>((resolve, reject) => {
    xhr.open("POST", `${BASE}/api/jobs`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploaded(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as Job);
      } else {
        reject(new Error(body?.detail ? String(body.detail) : `upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("could not reach the server"));
    xhr.onabort = () => reject(new Error("upload cancelled"));
    xhr.send(data);
  });
  return { promise, abort: () => xhr.abort() };
}

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** Follow a job to its end. Server-sent events where they work, polling where
 *  they don't (a proxy that buffers, an extension that eats them). */
export function subscribe(
  id: string,
  onJob: (job: Job) => void,
  onError: (message: string) => void,
): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let timer: number | null = null;

  const finish = (job: Job) => {
    onJob(job);
    if (TERMINAL.has(job.state)) stop();
  };

  const poll = () => {
    if (timer !== null) return;
    timer = window.setInterval(async () => {
      try {
        finish(await getJob(id));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 1000);
  };

  const stop = () => {
    stopped = true;
    source?.close();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  try {
    source = new EventSource(`${BASE}/api/jobs/${id}/events`);
    source.onmessage = (event) => {
      if (stopped) return;
      try {
        finish(JSON.parse(event.data) as Job);
      } catch {
        /* a truncated frame is not fatal; the next one will be whole */
      }
    };
    source.onerror = () => {
      if (stopped) return;
      source?.close();
      source = null;
      poll();
    };
  } catch {
    poll();
  }

  return stop;
}
