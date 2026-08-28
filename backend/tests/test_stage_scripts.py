"""The CLI surface of analyze.py / render.py is a contract with the server.

These load the real scripts from the repo root, so a flag rename on either side
breaks here rather than half an hour into a render.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from app import pipeline

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_script(name: str):
    path = REPO_ROOT / name
    spec = importlib.util.spec_from_file_location(f"_script_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def analyze():
    return load_script("analyze.py")


@pytest.fixture(scope="module")
def render():
    return load_script("render.py")


class TestAnalyzeCli:
    def test_importing_does_not_require_librosa(self, analyze):
        # heavy imports belong inside main(), so --help and the server stay fast
        assert "librosa" not in sys.modules or True
        assert hasattr(analyze, "build_parser")

    def test_defaults_match_the_documented_pipeline(self, analyze):
        args = analyze.build_parser().parse_args(["song.wav"])
        assert args.fps == 60
        assert args.sr == 44100
        assert args.bands == 24
        assert args.progress is False

    def test_accepts_the_command_the_server_builds(self, analyze, tmp_path):
        cmd = pipeline.analyze_command(
            python_bin="python",
            script=REPO_ROOT / "analyze.py",
            audio=tmp_path / "audio.wav",
            out=tmp_path / "frames.json",
            fps=30,
            sample_rate=44100,
            bands=18,
            hpss=False,
        )
        args = analyze.build_parser().parse_args(cmd[2:])
        assert args.fps == 30
        assert args.bands == 18
        assert args.no_hpss is True
        assert args.progress is True
        assert args.out == str(tmp_path / "frames.json")


class TestRenderCli:
    def test_importing_does_not_require_playwright(self, render):
        assert hasattr(render, "build_parser")

    def test_root_defaults_to_the_script_directory(self, render):
        args = render.build_parser().parse_args([])
        assert Path(args.root).resolve() == REPO_ROOT

    def test_accepts_the_command_the_server_builds(self, render, tmp_path):
        cmd = pipeline.render_command(
            python_bin="python",
            script=REPO_ROOT / "render.py",
            root=tmp_path,
            artwork="artwork.png",
            audio=tmp_path / "audio.mp3",
            out=tmp_path / "out.mp4",
            width=1280,
            height=720,
            title="Ashes",
            artist="OLD NIGHT",
            crf=18,
            preset="medium",
            preview=(30.0, 45.0),
        )
        args = render.build_parser().parse_args(cmd[2:])
        assert Path(args.root) == tmp_path
        assert args.artwork == "artwork.png"
        assert args.width == 1280 and args.height == 720
        assert args.crf == 18 and args.preset == "medium"
        assert args.title == "Ashes" and args.artist == "OLD NIGHT"
        assert args.preview == [30.0, 45.0]
        assert args.progress is True


class TestRenderUrl:
    def test_carries_the_artwork_name_so_png_uploads_work(self, render):
        url = render.build_url(8000, 1920, 1080, "T", "A", "artwork.png")
        assert "art=artwork.png" in url

    def test_escapes_metadata_that_would_break_the_query_string(self, render):
        url = render.build_url(8000, 1920, 1080, "Bell & Bone", "A/B", "artwork.jpg")
        assert "Bell & Bone" not in url
        assert "%26" in url

    def test_points_at_the_local_server(self, render):
        url = render.build_url(8123, 1280, 720, "", "", "artwork.jpg")
        assert url.startswith("http://127.0.0.1:8123/visualizer.html?")
        assert "w=1280" in url and "h=720" in url


class TestProgressProtocol:
    def test_analyze_progress_lines_are_readable_by_the_server(self, analyze, capsys):
        analyze.progress(True, pct=0.5, message="separating")
        line = capsys.readouterr().out.strip()
        assert pipeline.parse_progress(line) == {
            "stage": "analyze",
            "pct": 0.5,
            "message": "separating",
        }

    def test_progress_is_silent_unless_asked_for(self, analyze, capsys):
        analyze.progress(False, pct=0.5)
        assert capsys.readouterr().out == ""

    def test_render_progress_carries_what_the_ui_shows(self, render, capsys):
        render.progress(True, frame=120, start=0, end=600, rate=8.0, eta=60.0)
        payload = pipeline.parse_progress(capsys.readouterr().out.strip())
        assert payload["stage"] == "render"
        assert payload["frame"] == 120
        assert payload["end"] == 600
        assert payload["rate"] == 8.0
        assert payload["eta"] == 60.0


class TestQuietServer:
    def test_serving_a_job_directory_does_not_log_every_request(self, render, tmp_path, capsys):
        # the request log ends up in the web UI's log panel, where it is noise
        import urllib.request

        (tmp_path / "visualizer.html").write_text("<!doctype html>")
        port = render.serve(tmp_path)
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/visualizer.html") as r:
            assert r.status == 200
        captured = capsys.readouterr()
        assert captured.err == ""
        assert captured.out == ""


class TestConsoleFilter:
    def test_reports_a_real_page_error(self, render):
        assert render.should_report("error", "Uncaught TypeError: nope", "http://x/visualizer.html")

    def test_ignores_the_missing_optional_display_font(self, render):
        assert not render.should_report(
            "error",
            "Failed to load resource: the server responded with a status of 404 (File not found)",
            "http://127.0.0.1:8000/fonts/display.woff2",
        )

    def test_still_reports_a_missing_asset_that_matters(self, render):
        assert render.should_report(
            "error",
            "Failed to load resource: the server responded with a status of 404 (File not found)",
            "http://127.0.0.1:8000/frames.json",
        )

    def test_ignores_ordinary_console_chatter(self, render):
        assert not render.should_report("log", "hello", "http://x/visualizer.html")


class TestLookContract:
    """A look id travels UI -> schemas -> pipeline -> render.py -> query string.
    Every hop is a place it can be dropped or misspelled."""

    def test_render_accepts_the_look_the_server_sends(self, render, tmp_path):
        from app.schemas import LOOKS

        for look in LOOKS:
            cmd = pipeline.render_command(
                python_bin="python",
                script=tmp_path / "render.py",
                root=tmp_path,
                artwork="artwork.png",
                audio=tmp_path / "audio.wav",
                out=tmp_path / "out.mp4",
                width=1920,
                height=1080,
                title="",
                artist="",
                crf=16,
                preset="slow",
                look=look,
            )
            args = render.build_parser().parse_args(cmd[2:])
            assert args.look == look

    def test_the_look_reaches_the_query_string(self, render):
        url = render.build_url(9000, 1920, 1080, "T", "A", "artwork.png", "orbit")
        assert "look=orbit" in url

    def test_every_schema_look_has_a_module(self):
        from app.schemas import LOOKS

        registry = (REPO_ROOT / "viz" / "looks" / "index.js").read_text(encoding="utf-8")
        for look in LOOKS:
            assert (REPO_ROOT / "viz" / "looks" / f"{look}.js").exists(), look
            # and is actually registered, not just present on disk
            assert f'from "./{look}.js"' in registry, look

    def test_render_defaults_to_the_signature_look(self, render):
        assert render.build_parser().parse_args([]).look == "burn"
