import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cancelJob, createJob, getHealth, subscribe, videoUrl } from "./api";
import { bestDuration, probeDuration } from "./audio";
import { ActionBar } from "./components/ActionBar";
import { AdvancedPanel } from "./components/AdvancedPanel";
import { Console } from "./components/Console";
import { OutputPanel } from "./components/OutputPanel";
import { SourcePanel } from "./components/SourcePanel";
import { Stage } from "./components/Stage";
import { TopBar } from "./components/TopBar";
import { Transport } from "./components/Transport";
import { usePreview } from "./preview/usePreview";
import { DEFAULT_SETTINGS, type RenderSettings, toFormData } from "./settings";
import type { Health, Job } from "./types";
import { loadPeaks } from "./waveform";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  /* Two sources race for the length: the metadata probe, which always answers
     within five seconds even when an extension has hooked the media element,
     and the waveform decode, which is allowed to fail. bestDuration keeps the
     first real answer so the slower one's null cannot erase it. */
  useEffect(() => {
    setDuration(null);
    setPeaks(null);
    if (!audio) {
      setProbing(false);
      return;
    }
    let live = true;
    setProbing(true);
    probeDuration(audio).then((seconds) => {
      if (!live) return;
      setDuration((current) => bestDuration(current, seconds));
      setProbing(false);
    });
    loadPeaks(audio).then((result) => {
      if (!live) return;
      setPeaks(result?.peaks ?? null);
      setDuration((current) => bestDuration(current, result?.duration));
      // the decode answered, so nothing is still "reading"
      if (result) setProbing(false);
    });
    return () => {
      live = false;
    };
  }, [audio]);

  /* Once the length is known, pull a test window that is actually inside the
     track — a 30–45s default is nonsense on a 20-second interlude. */
  useEffect(() => {
    if (!duration) return;
    setSettings((s) => {
      if (s.previewEnd <= duration) return s;
      const end = Math.max(1, Math.floor(duration));
      return { ...s, previewEnd: end, previewStart: Math.min(s.previewStart, end - 1) };
    });
  }, [duration]);

  const patch = useCallback(
    (change: Partial<RenderSettings>) => setSettings((s) => ({ ...s, ...change })),
    [],
  );

  const previewWindow = useMemo(
    () =>
      settings.previewEnabled
        ? { start: settings.previewStart, end: settings.previewEnd }
        : null,
    [settings.previewEnabled, settings.previewStart, settings.previewEnd],
  );

  const preview = usePreview({
    image,
    audio,
    peaks,
    duration: duration ?? 0,
    bands: settings.bands,
    artist: settings.artist,
    title: settings.title,
    window: previewWindow,
  });

  // the accent the cover produced drives the whole shell
  useEffect(() => {
    document.documentElement.style.setProperty("--acc", preview.accent);
  }, [preview.accent]);

  const busy = uploading || (job !== null && !TERMINAL.has(job.state));
  const ready = image !== null && audio !== null;

  const start = async () => {
    if (!ready) return;
    setError(null);
    setUploaded(0);
    setUploading(true);
    setJob(null);
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

  const reset = () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    setJob(null);
    setUploaded(0);
    setError(null);
  };

  const stop = async () => {
    if (!job) {
      // still uploading: there is no job on the server to cancel yet
      abortUpload.current?.();
      return;
    }
    try {
      setJob(await cancelJob(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const missingTool = health
    ? Object.entries(health.tools).find(([, ok]) => !ok)?.[0]
    : null;

  const banner = error
    ? { tone: "bad" as const, tag: "Error", text: error }
    : health === null
      ? {
          tone: "warn" as const,
          tag: "Engine",
          text: "No answer from the backend on port 8000. Renders will fail until it comes back.",
        }
      : missingTool
        ? {
            tone: "warn" as const,
            tag: "Engine",
            text: `The server is missing ${missingTool}, so renders will fail. Start it with Docker, or install the tool and restart the backend.`,
          }
        : null;

  const log = job?.log ?? [];

  return (
    <div className="shell">
      <TopBar health={health} />

      {banner && (
        <div className={`banner banner--${banner.tone}`} role="status">
          <span className="banner__tag">{banner.tag}</span>
          <span>{banner.text}</span>
        </div>
      )}

      <main className="main">
        <div className="rail">
          <SourcePanel
            image={image}
            audio={audio}
            coverUrl={preview.coverUrl}
            coverSize={preview.coverSize}
            duration={duration}
            probing={probing}
            fps={settings.fps}
            accepts={{
              image: health?.accepts.image.join(",") ?? "image/*",
              audio: health?.accepts.audio.join(",") ?? "audio/*",
            }}
            disabled={busy}
            onImage={setImage}
            onAudio={setAudio}
          />

          <section className="rail__block">
            <h2 className="rail__title">02 · Burn-in</h2>
            <div className="grid grid--2 grid--gap">
              <label className="field">
                <span className="micro">Artist</span>
                <input
                  value={settings.artist}
                  maxLength={120}
                  placeholder="OLD NIGHT"
                  disabled={busy}
                  onChange={(e) => patch({ artist: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="micro">Track</span>
                <input
                  value={settings.title}
                  maxLength={120}
                  placeholder="ASHES IN THE WIND"
                  disabled={busy}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
            </div>
          </section>

          <OutputPanel
            settings={settings}
            duration={duration}
            disabled={busy}
            advancedOpen={advancedOpen}
            onSettings={setSettings}
            onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
          />

          {advancedOpen && (
            <AdvancedPanel
              settings={settings}
              duration={duration}
              disabled={busy}
              onChange={patch}
            />
          )}

          <div className="rail__spacer" />
          <p className="rail__foot">
            Nothing is persisted. A job is swept two hours after it settles.
            Rendering a full album? Analyse it as one continuous file — per-track
            normalisation makes a quiet interlude look as busy as the heaviest
            section.
          </p>
        </div>

        <div className="stage-col">
          <Stage
            stageRef={preview.stageRef}
            settings={settings}
            duration={duration}
            hasCover={image !== null}
            playing={preview.playing}
            job={job}
            videoSrc={job?.state === "done" ? videoUrl(job.id) : null}
          />
          <Transport
            metersRef={preview.metersRef}
            waveRef={preview.waveRef}
            playing={preview.playing}
            now={preview.now}
            duration={duration}
            hasAudio={audio !== null}
            onToggle={preview.togglePlay}
            onSeek={preview.seek}
          />
          {log.length > 0 && (
            <Console lines={log} streaming={job?.state === "rendering"} />
          )}
        </div>
      </main>

      <ActionBar
        settings={settings}
        duration={duration}
        ready={ready}
        busy={busy}
        uploading={uploading}
        uploaded={uploaded}
        bytesQueued={(image?.size ?? 0) + (audio?.size ?? 0)}
        job={job}
        onStart={start}
        onCancel={stop}
        onReset={reset}
      />

      <audio ref={preview.audioRef} hidden />
    </div>
  );
}
