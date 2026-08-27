"""Building and running the two pipeline stages as child processes.

The stages stay separate programs rather than imports: librosa and Playwright
both want to own the process they run in, and a subprocess is the only thing we
can reliably terminate when the user cancels a forty-minute render.
"""

from __future__ import annotations

import json
import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Callable, Sequence

#: prefix the stages use for machine-readable progress on stdout
PROGRESS_PREFIX = "##MVG "

IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".bmp"})
AUDIO_EXTS = frozenset({".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif"})


def parse_progress(line: str) -> dict | None:
    """Pull a progress record out of a line of child-process output.

    Returns ``None`` for ordinary output, which the caller keeps as a log line.
    """
    line = line.strip()
    if not line.startswith(PROGRESS_PREFIX):
        return None
    try:
        payload = json.loads(line[len(PROGRESS_PREFIX) :])
    except (ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def analyze_command(
    *,
    python_bin: str,
    script: Path,
    audio: Path,
    out: Path,
    fps: int,
    sample_rate: int,
    bands: int,
    hpss: bool,
) -> list[str]:
    cmd = [
        python_bin,
        str(script),
        str(audio),
        "-o",
        str(out),
        "--fps",
        str(fps),
        "--sr",
        str(sample_rate),
        "--bands",
        str(bands),
        "--progress",
    ]
    if not hpss:
        cmd.append("--no-hpss")
    return cmd


def render_command(
    *,
    python_bin: str,
    script: Path,
    root: Path,
    artwork: str,
    audio: Path,
    out: Path,
    width: int,
    height: int,
    title: str,
    artist: str,
    crf: int,
    preset: str,
    preview: tuple[float, float] | None = None,
) -> list[str]:
    cmd = [
        python_bin,
        str(script),
        "--root",
        str(root),
        "--artwork",
        artwork,
        "--audio",
        str(audio),
        "-o",
        str(out),
        "-w",
        str(width),
        "-H",
        str(height),
        "--crf",
        str(crf),
        "--preset",
        preset,
        "--title",
        title,
        "--artist",
        artist,
        "--progress",
    ]
    if preview is not None:
        cmd += ["--preview", str(preview[0]), str(preview[1])]
    return cmd


class ProcessRunner:
    """Runs a command, streaming its merged output a line at a time."""

    def run(
        self,
        cmd: Sequence[str],
        cwd: Path,
        on_line: Callable[[str], None],
        on_process: Callable[[subprocess.Popen], None] | None = None,
    ) -> int:
        env = dict(os.environ)
        # unbuffered, or progress arrives in one lump when the stage exits
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.Popen(
            list(cmd),
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        if on_process is not None:
            on_process(proc)
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                if line:
                    on_line(line)
        finally:
            if proc.stdout is not None:
                proc.stdout.close()
            proc.wait()
        return proc.returncode


@lru_cache(maxsize=1)
def tool_availability() -> dict[str, bool]:
    """Cheap check of the three things a render needs to be able to finish."""
    import importlib.util
    import shutil

    have_playwright = importlib.util.find_spec("playwright") is not None
    chromium = False
    if have_playwright:
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as pw:
                chromium = Path(pw.chromium.executable_path).exists()
        except Exception:
            chromium = False
    return {
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "chromium": chromium,
        "librosa": importlib.util.find_spec("librosa") is not None,
    }
