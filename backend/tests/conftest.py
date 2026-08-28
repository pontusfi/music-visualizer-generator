import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402


@pytest.fixture
def pipeline_dir(tmp_path: Path) -> Path:
    """A stand-in for the repo root: the scripts, the shell, and the design."""
    d = tmp_path / "pipeline"
    d.mkdir()
    (d / "analyze.py").write_text("# stub\n")
    (d / "render.py").write_text("# stub\n")
    (d / "visualizer.html").write_text("<!doctype html><title>stub</title>\n")
    viz = d / "viz"
    (viz / "looks").mkdir(parents=True)
    (viz / "main.js").write_text("// stub\n")
    (viz / "signals.js").write_text("// stub\n")
    (viz / "looks" / "burn.js").write_text("// stub\n")
    return d


@pytest.fixture
def settings(tmp_path: Path, pipeline_dir: Path) -> Settings:
    return Settings(
        work_dir=tmp_path / "work",
        pipeline_dir=pipeline_dir,
        python_bin="python",
        max_image_bytes=1024,
        max_audio_bytes=4096,
    )
