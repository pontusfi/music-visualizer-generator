"""Process-wide configuration, all overridable from the environment."""

from __future__ import annotations

import os
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

MB = 1024 * 1024


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    #: where per-job scratch directories are created
    work_dir: Path
    #: directory holding analyze.py, render.py and visualizer.html
    pipeline_dir: Path
    python_bin: str = sys.executable
    max_image_bytes: int = 32 * MB
    max_audio_bytes: int = 512 * MB
    #: analysis sample rate; fps has to divide it evenly (hop = sr / fps)
    sample_rate: int = 44100
    #: renders are CPU-bound, so one at a time by default
    max_workers: int = 1
    #: a finished job's files are swept this long after it settles
    job_ttl_seconds: int = 7200
    #: optional built frontend to serve from the same origin
    static_dir: Path | None = None
    cors_origins: tuple[str, ...] = field(default=("*",))

    @classmethod
    def from_env(cls) -> "Settings":
        default_work = Path(tempfile.gettempdir()) / "mvg-jobs"
        static = os.environ.get("MVG_STATIC_DIR")
        origins = os.environ.get("MVG_CORS_ORIGINS", "*")
        return cls(
            work_dir=_env_path("MVG_WORK_DIR", default_work),
            pipeline_dir=_env_path("MVG_PIPELINE_DIR", REPO_ROOT),
            python_bin=os.environ.get("MVG_PYTHON", sys.executable),
            max_image_bytes=_env_int("MVG_MAX_IMAGE_MB", 32) * MB,
            max_audio_bytes=_env_int("MVG_MAX_AUDIO_MB", 512) * MB,
            sample_rate=_env_int("MVG_SAMPLE_RATE", 44100),
            max_workers=_env_int("MVG_MAX_WORKERS", 1),
            job_ttl_seconds=_env_int("MVG_JOB_TTL_SECONDS", 7200),
            static_dir=Path(static).resolve() if static else None,
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        )

    @property
    def analyze_script(self) -> Path:
        return self.pipeline_dir / "analyze.py"

    @property
    def render_script(self) -> Path:
        return self.pipeline_dir / "render.py"

    @property
    def template(self) -> Path:
        return self.pipeline_dir / "visualizer.html"
