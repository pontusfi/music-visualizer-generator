import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cancelJob, createJob, getHealth, subscribe } from "./api";
import { probeDuration } from "./audio";
import { FileDrop } from "./components/FileDrop";
import { ProgressPanel } from "./components/ProgressPanel";
import { ResultPanel } from "./components/ResultPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { estimateRenderMinutes, formatClock } from "./format";
import { DEFAULT_SETTINGS, type RenderSettings, toFormData } from "./settings";
import type { Health, Job } from "./types";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [job, setJob] = useState<Job | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const abortUpload = useRef<(() => void) | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    return () => unsubscribe.current?.();
  }, []);

  // object URLs are a leak if you forget them, and this page can run for an hour
  useEffect(() => {
    if (!image) {
      setArtUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setArtUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    setDuration(null);
    if (!audio) {
      setProbing(false);
      return;
    }
    let live = true;
    setProbing(true);
    probeDuration(audio).then((seconds) => {
      if (!live) return;
      setDuration(seconds);
      setProbing(false);
    });
    return () => {
      live = false;
    };
  }, [audio]);

  const patch = useCallback(
    (change: Partial<RenderSettings>) => setSettings((s) => ({ ...s, ...change })),
    [],
  );

  const estimate = useMemo(() => {
    if (!duration) return null;
    return estimateRenderMinutes(
      duration,
      settings.fps,
      settings.height,
      settings.previewEnabled
        ? { start: settings.previewStart, end: settings.previewEnd }
        : null,
    );
  }, [duration, settings]);

  const missingTool = health
    ? Object.entries(health.tools).find(([, ok]) => !ok)?.[0]
    : null;

  const start = async () => {
    if (!image || !audio) return;
    setError(null);
    setUploaded(0);
    setUploading(true);
    const { promise, abort } = createJob(
      toFormData(settings, image, audio),
      setUploaded,
    );
    abortUpload.current = abort;
    try {
      const created = await promise;
      setUploaded(1);
      setJob(created);
      unsubscribe.current?.();
      unsubscribe.current = subscribe(created.id, setJob, setError);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploaded(0);
    } finally {
      setUploading(false);
      abortUpload.current = null;
    }
  };

  const restart = () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    setJob(null);
    setUploaded(0);
    setError(null);
  };

  const stop = async () => {
    if (!job) {
      abortUpload.current?.();
      return;
    }
    try {
      setJob(await cancelJob(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = uploading || (job !== null && !TERMINAL.has(job.state));
  const finished = job !== null && TERMINAL.has(job.state);

  return (
    <div className="page">
      <header className="masthead">
        <h1>Music Visualizer</h1>
        <p>
          A cover, a master, one deterministic render. The artwork burns from its
          own highlights on every kick.
        </p>
      </header>

      {missingTool && (
        <div className="banner banner--warn">
          The server is missing <strong>{missingTool}</strong>, so renders will
          fail. Start it with Docker, or install the tool and restart the backend.
        </div>
      )}
      {health === null && (
        <div className="banner banner--warn">
          No answer from the backend. Is it running on port 8000?
        </div>
      )}
      {error && <div className="banner banner--bad">{error}</div>}

      {!job && !uploading && (
        <>
          <div className="drops">
            <FileDrop
              label="Artwork"
              hint="cover art, 1400px or larger"
              accept={health?.accepts.image.join(",") ?? "image/*"}
              file={image}
              onFile={setImage}
            >
              {artUrl && <img className="drop__art" src={artUrl} alt="" />}
            </FileDrop>
            <FileDrop
              label="Audio"
              hint="the final master"
              accept={health?.accepts.audio.join(",") ?? "audio/*"}
              file={audio}
              onFile={setAudio}
            >
              <div className="drop__wave">
                {duration ? formatClock(duration) : probing ? "reading…" : "—"}
              </div>
            </FileDrop>
          </div>

          <SettingsPanel
            settings={settings}
            onChange={patch}
            duration={duration}
            disabled={false}
          />

          <div className="launch">
            <button
              type="button"
              className="button button--go"
              disabled={!image || !audio}
              onClick={start}
            >
              Generate video
            </button>
            {estimate != null && (
              <span className="launch__estimate">
                about {estimate < 1 ? "a minute" : `${Math.round(estimate)} minutes`} of
                rendering
                {settings.previewEnabled ? " for the test window" : ""}
              </span>
            )}
          </div>
          <p className="note note--foot">
            Rendering a full album? Analyse it as one continuous file — per-track
            normalisation makes a quiet interlude look as busy as the heaviest
            section.
          </p>
        </>
      )}

      {running && <ProgressPanel job={job} uploaded={uploaded} onCancel={stop} />}
      {finished && job && <ResultPanel job={job} onRestart={restart} />}
    </div>
  );
}
