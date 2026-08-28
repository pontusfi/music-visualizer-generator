"""Job lifecycle: one directory, two child processes, one video out.

There is no database. A job is a directory under the work dir plus an in-memory
record; both are swept once the job has settled and its TTL has passed. The
session is upload, generate, download, leave.
"""

from __future__ import annotations

import enum
import logging
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import BinaryIO, Callable

from .config import Settings
from .pipeline import (
    AUDIO_EXTS,
    IMAGE_EXTS,
    ProcessRunner,
    analyze_command,
    parse_progress,
    render_command,
)
from .schemas import JobParams

log = logging.getLogger("mvg.jobs")

#: analysis is the first quarter of the bar, rendering the rest. Rendering
#: dominates wall-clock time, but analysis is slow enough that a bar stuck at
#: zero for two minutes reads as a hang.
ANALYZE_SHARE = 0.25

FRAMES_JSON = "frames.json"
OUTPUT_NAME = "out.mp4"
TEMPLATE_NAME = "visualizer.html"
#: the module tree visualizer.html imports its design from
VIZ_DIR = "viz"

_BAD_FILENAME_CHARS = set('/\\:*?"<>|')


#: A stage's last log line is usually a Python exception class: true, but no use
#: to someone who just dragged a file in. These two failures are common enough
#: to be worth translating; everything else keeps its raw detail.
_KNOWN_FAILURES = (
    ("NoBackendError", "the audio could not be decoded — try a wav or flac export"),
    ("LibsndfileError", "the audio could not be decoded — the file may be truncated"),
    ("ffmpeg is not on PATH", "ffmpeg is missing on the server"),
)


class ValidationError(ValueError):
    """An upload the server will not accept."""


class JobState(str, enum.Enum):
    QUEUED = "queued"
    ANALYZING = "analyzing"
    RENDERING = "rendering"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def terminal(self) -> bool:
        return self in (JobState.DONE, JobState.FAILED, JobState.CANCELLED)


@dataclass
class Job:
    id: str
    dir: Path
    params: JobParams
    artwork_name: str
    audio_name: str
    image_filename: str
    audio_filename: str
    state: JobState = JobState.QUEUED
    progress: float = 0.0
    message: str = "Queued"
    error: str | None = None
    log: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    video_path: Path | None = None
    frame: int | None = None
    frames_total: int | None = None
    rate: float | None = None
    eta_seconds: float | None = None
    cancel_requested: bool = False

    @property
    def settled_at(self) -> float:
        return self.finished_at if self.finished_at is not None else self.created_at

    def public(self, log_lines: int = 60) -> dict:
        return {
            "id": self.id,
            "state": self.state.value,
            "progress": round(self.progress, 4),
            "message": self.message,
            "error": self.error,
            "params": self.params.model_dump(),
            "image_filename": self.image_filename,
            "audio_filename": self.audio_filename,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "frame": self.frame,
            "frames_total": self.frames_total,
            "rate": self.rate,
            "eta_seconds": self.eta_seconds,
            "log": self.log[-log_lines:],
        }


def _copy_limited(src: BinaryIO, dst: Path, limit: int, label: str) -> int:
    """Stream an upload to disk, refusing to write more than ``limit`` bytes."""
    written = 0
    with dst.open("wb") as out:
        while chunk := src.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                raise ValidationError(
                    f"{label} is larger than the {limit // (1024 * 1024)} MB limit"
                )
            out.write(chunk)
    if written == 0:
        raise ValidationError(f"{label} is empty")
    return written


def _checked_ext(filename: str, allowed: frozenset[str], label: str) -> str:
    # only the extension survives; the uploaded name never touches the filesystem
    ext = Path(filename or "").suffix.lower()
    if ext not in allowed:
        raise ValidationError(
            f"unsupported {label} format '{ext or filename}'. "
            f"Accepted: {', '.join(sorted(allowed))}"
        )
    return ext


class JobManager:
    """Owns the job records, their directories and the worker pool."""

    LOG_LIMIT = 400

    def __init__(self, settings: Settings, runner=None, executor=None):
        self.settings = settings
        self.runner = runner or ProcessRunner()
        self.executor = executor or ThreadPoolExecutor(
            max_workers=settings.max_workers, thread_name_prefix="mvg-render"
        )
        self._jobs: dict[str, Job] = {}
        self._procs: dict[str, object] = {}
        self._watchers: dict[str, list[Callable[[Job], None]]] = {}
        self._lock = RLock()
        settings.work_dir.mkdir(parents=True, exist_ok=True)

    # -- lookup ------------------------------------------------------------
    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j.created_at)

    def watch(self, job_id: str, callback: Callable[[Job], None]) -> None:
        """Call ``callback`` on every state change of this job."""
        with self._lock:
            self._watchers.setdefault(job_id, []).append(callback)

    def unwatch(self, job_id: str, callback: Callable[[Job], None]) -> None:
        with self._lock:
            watchers = self._watchers.get(job_id)
            if watchers and callback in watchers:
                watchers.remove(callback)

    # -- creation ----------------------------------------------------------
    def create(
        self,
        params: JobParams,
        image: tuple[str, BinaryIO],
        audio: tuple[str, BinaryIO],
    ) -> Job:
        image_name, image_file = image
        audio_name, audio_file = audio
        image_ext = _checked_ext(image_name, IMAGE_EXTS, "image")
        audio_ext = _checked_ext(audio_name, AUDIO_EXTS, "audio")

        job_id = uuid.uuid4().hex[:12]
        job_dir = self.settings.work_dir / job_id
        job_dir.mkdir(parents=True)
        try:
            artwork_name = f"artwork{image_ext}"
            stored_audio = f"audio{audio_ext}"
            _copy_limited(
                image_file, job_dir / artwork_name, self.settings.max_image_bytes, "image"
            )
            _copy_limited(
                audio_file, job_dir / stored_audio, self.settings.max_audio_bytes, "audio"
            )
            self._install_template(job_dir)
        except Exception:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise

        job = Job(
            id=job_id,
            dir=job_dir,
            params=params,
            artwork_name=artwork_name,
            audio_name=stored_audio,
            image_filename=image_name,
            audio_filename=audio_name,
        )
        with self._lock:
            self._jobs[job_id] = job
        return job

    def _install_template(self, job_dir: Path) -> None:
        """Give the job its own copy of the design, so a render is reproducible
        even if the template on disk changes underneath a queued job."""
        template = self.settings.template
        if not template.exists():
            raise ValidationError(f"{TEMPLATE_NAME} is missing from the pipeline directory")
        shutil.copy2(template, job_dir / TEMPLATE_NAME)
        # visualizer.html is only a shell; the looks it imports live here, and
        # staging one without the other renders a blank frame for the whole job
        for name in (VIZ_DIR, "fonts"):
            src = self.settings.pipeline_dir / name
            if src.is_dir():
                shutil.copytree(src, job_dir / name, dirs_exist_ok=True)

    # -- execution ---------------------------------------------------------
    def submit(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.cancel_requested:
            self._settle(job, JobState.CANCELLED, "Cancelled")
            return
        self.executor.submit(self._run, job_id)

    def _run(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None or job.cancel_requested:
            if job is not None:
                self._settle(job, JobState.CANCELLED, "Cancelled")
            return

        job.started_at = time.time()
        frames = job.dir / FRAMES_JSON
        output = job.dir / OUTPUT_NAME
        p = job.params
        try:
            self._transition(job, JobState.ANALYZING, "Analysing audio")
            code = self._stage(
                job,
                "analyze",
                analyze_command(
                    python_bin=self.settings.python_bin,
                    script=self.settings.analyze_script,
                    audio=job.dir / job.audio_name,
                    out=frames,
                    fps=p.fps,
                    sample_rate=p.sample_rate,
                    bands=p.bands,
                    hpss=p.hpss,
                ),
            )
            if self._aborted(job):
                return
            if code != 0 or not frames.exists():
                self._fail(job, "Analysis failed", code)
                return

            self._transition(job, JobState.RENDERING, "Rendering frames")
            code = self._stage(
                job,
                "render",
                render_command(
                    python_bin=self.settings.python_bin,
                    script=self.settings.render_script,
                    root=job.dir,
                    artwork=job.artwork_name,
                    audio=job.dir / job.audio_name,
                    out=output,
                    width=p.width,
                    height=p.height,
                    title=p.title,
                    artist=p.artist,
                    crf=p.crf,
                    preset=p.preset,
                    preview=p.preview_range(),
                ),
            )
            if self._aborted(job):
                return
            if code != 0 or not output.exists() or output.stat().st_size == 0:
                self._fail(job, "Render failed", code)
                return

            job.video_path = output
            job.progress = 1.0
            self._settle(job, JobState.DONE, "Finished")
        except Exception as exc:  # a crash here must not strand the job
            log.exception("job %s crashed", job_id)
            job.error = f"{type(exc).__name__}: {exc}"
            self._settle(job, JobState.FAILED, "Failed")
        finally:
            with self._lock:
                self._procs.pop(job_id, None)

    def _stage(self, job: Job, stage: str, cmd: list[str]) -> int:
        def on_process(proc):
            with self._lock:
                self._procs[job.id] = proc
            if job.cancel_requested:
                _terminate(proc)

        return self.runner.run(
            cmd,
            cwd=job.dir,
            on_line=lambda line: self._on_line(job, stage, line),
            on_process=on_process,
        )

    def _on_line(self, job: Job, stage: str, line: str) -> None:
        data = parse_progress(line)
        if data is None:
            job.log.append(line)
            if len(job.log) > self.LOG_LIMIT:
                del job.log[: len(job.log) - self.LOG_LIMIT]
            return

        if stage == "analyze":
            pct = _as_float(data.get("pct"))
            if pct is not None:
                job.progress = max(job.progress, min(1.0, pct) * ANALYZE_SHARE)
        else:
            start = _as_float(data.get("start")) or 0.0
            end = _as_float(data.get("end"))
            frame = _as_float(data.get("frame"))
            if end is not None and frame is not None and end > start:
                done = min(1.0, max(0.0, (frame - start) / (end - start)))
                job.progress = max(
                    job.progress, ANALYZE_SHARE + done * (1.0 - ANALYZE_SHARE)
                )
                job.frame = int(frame)
                job.frames_total = int(end)
            job.rate = _as_float(data.get("rate"))
            job.eta_seconds = _as_float(data.get("eta"))

        if isinstance(data.get("message"), str):
            job.message = data["message"]
        self._notify(job)

    # -- state -------------------------------------------------------------
    def _transition(self, job: Job, state: JobState, message: str) -> None:
        job.state = state
        job.message = message
        if state is JobState.RENDERING:
            job.progress = max(job.progress, ANALYZE_SHARE)
        self._notify(job)

    def _settle(self, job: Job, state: JobState, message: str) -> None:
        job.state = state
        job.message = message
        job.finished_at = time.time()
        job.rate = None
        job.eta_seconds = None
        self._notify(job)

    def _fail(self, job: Job, message: str, code: int) -> None:
        tail = [line for line in job.log[-6:] if line.strip()]
        detail = tail[-1] if tail else f"exit code {code}"
        for needle, plain in _KNOWN_FAILURES:
            if any(needle in line for line in job.log[-12:]):
                detail = plain
                break
        job.error = f"{message}: {detail}"
        self._settle(job, JobState.FAILED, message)

    def _aborted(self, job: Job) -> bool:
        if job.cancel_requested:
            self._settle(job, JobState.CANCELLED, "Cancelled")
            return True
        return False

    def _notify(self, job: Job) -> None:
        with self._lock:
            watchers = list(self._watchers.get(job.id, ()))
        for callback in watchers:
            try:
                callback(job)
            except Exception:  # a broken listener must not kill a render
                log.exception("job watcher failed")

    # -- control -----------------------------------------------------------
    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job is None or job.state.terminal:
            return job
        job.cancel_requested = True
        with self._lock:
            proc = self._procs.get(job_id)
        if proc is not None:
            _terminate(proc)
        else:
            self._settle(job, JobState.CANCELLED, "Cancelled")
        return job

    def delete(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None:
            return False
        self.cancel(job_id)
        with self._lock:
            self._jobs.pop(job_id, None)
            self._watchers.pop(job_id, None)
            self._procs.pop(job_id, None)
        shutil.rmtree(job.dir, ignore_errors=True)
        return True

    def purge(self, now: float | None = None) -> list[str]:
        """Drop settled jobs whose TTL has run out. Running jobs are untouched."""
        now = time.time() if now is None else now
        ttl = self.settings.job_ttl_seconds
        with self._lock:
            stale = [
                j.id
                for j in self._jobs.values()
                if j.state.terminal and j.settled_at + ttl < now
            ]
        return [job_id for job_id in stale if self.delete(job_id)]

    def shutdown(self) -> None:
        for job in self.list():
            if not job.state.terminal:
                self.cancel(job.id)
        self.executor.shutdown(wait=False)

    # -- presentation ------------------------------------------------------
    def download_name(self, job: Job) -> str:
        parts = [p for p in (job.params.artist.strip(), job.params.title.strip()) if p]
        stem = " - ".join(parts) or "visualizer"
        stem = "".join("_" if c in _BAD_FILENAME_CHARS or ord(c) < 32 else c for c in stem)
        stem = " ".join(stem.split()).strip(". ") or "visualizer"
        return f"{stem[:120]}.mp4"


def _terminate(proc) -> None:
    try:
        proc.terminate()
    except Exception:
        log.exception("could not terminate child process")


def _as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
