from pathlib import Path

import pytest

from app import pipeline


class TestParseProgress:
    def test_parses_tagged_json_line(self):
        assert pipeline.parse_progress('##MVG {"stage":"render","frame":12}') == {
            "stage": "render",
            "frame": 12,
        }

    def test_tolerates_surrounding_whitespace(self):
        assert pipeline.parse_progress('  ##MVG {"stage":"analyze"}  \n') == {
            "stage": "analyze"
        }

    def test_ignores_untagged_output(self):
        assert pipeline.parse_progress("loading audio.wav at 44100 Hz") is None

    def test_ignores_malformed_json(self):
        assert pipeline.parse_progress("##MVG {not json") is None

    def test_ignores_non_object_json(self):
        assert pipeline.parse_progress("##MVG [1,2,3]") is None


class TestAnalyzeCommand:
    def test_builds_expected_argv(self, tmp_path: Path):
        cmd = pipeline.analyze_command(
            python_bin="py3",
            script=tmp_path / "analyze.py",
            audio=tmp_path / "audio.wav",
            out=tmp_path / "frames.json",
            fps=60,
            sample_rate=44100,
            bands=24,
            hpss=True,
        )
        assert cmd[0] == "py3"
        assert cmd[1] == str(tmp_path / "analyze.py")
        assert cmd[2] == str(tmp_path / "audio.wav")
        assert "--fps" in cmd and cmd[cmd.index("--fps") + 1] == "60"
        assert "--sr" in cmd and cmd[cmd.index("--sr") + 1] == "44100"
        assert "--bands" in cmd and cmd[cmd.index("--bands") + 1] == "24"
        assert "-o" in cmd and cmd[cmd.index("-o") + 1] == str(tmp_path / "frames.json")
        assert "--no-hpss" not in cmd

    def test_hpss_disabled_adds_flag(self, tmp_path: Path):
        cmd = pipeline.analyze_command(
            python_bin="py3",
            script=tmp_path / "analyze.py",
            audio=tmp_path / "a.wav",
            out=tmp_path / "frames.json",
            fps=30,
            sample_rate=44100,
            bands=16,
            hpss=False,
        )
        assert "--no-hpss" in cmd


class TestRenderCommand:
    def _cmd(self, tmp_path, **over):
        kwargs = dict(
            python_bin="py3",
            script=tmp_path / "render.py",
            root=tmp_path / "job",
            artwork="artwork.png",
            audio=tmp_path / "job" / "audio.wav",
            out=tmp_path / "job" / "out.mp4",
            width=1920,
            height=1080,
            title="Track",
            artist="Band",
            crf=16,
            preset="slow",
            preview=None,
        )
        kwargs.update(over)
        return pipeline.render_command(**kwargs)

    def test_passes_root_and_artwork_through(self, tmp_path: Path):
        cmd = self._cmd(tmp_path)
        assert cmd[cmd.index("--root") + 1] == str(tmp_path / "job")
        assert cmd[cmd.index("--artwork") + 1] == "artwork.png"

    def test_geometry_and_encoder_flags(self, tmp_path: Path):
        cmd = self._cmd(tmp_path)
        assert cmd[cmd.index("-w") + 1] == "1920"
        assert cmd[cmd.index("-H") + 1] == "1080"
        assert cmd[cmd.index("--crf") + 1] == "16"
        assert cmd[cmd.index("--preset") + 1] == "slow"

    def test_title_and_artist_survive_spaces(self, tmp_path: Path):
        cmd = self._cmd(tmp_path, title="Ashes In The Wind", artist="OLD NIGHT")
        assert "Ashes In The Wind" in cmd
        assert "OLD NIGHT" in cmd

    def test_no_preview_flag_when_full_render(self, tmp_path: Path):
        assert "--preview" not in self._cmd(tmp_path)

    def test_preview_range_expands_to_two_values(self, tmp_path: Path):
        cmd = self._cmd(tmp_path, preview=(30.0, 45.0))
        i = cmd.index("--preview")
        assert cmd[i + 1 : i + 3] == ["30.0", "45.0"]

    def test_progress_flag_requested(self, tmp_path: Path):
        # the UI depends on machine-readable progress
        assert "--progress" in self._cmd(tmp_path)


class TestProcessRunner:
    def test_streams_stdout_lines_and_returns_exit_code(self, tmp_path: Path):
        import sys

        script = tmp_path / "chatty.py"
        script.write_text(
            "import sys\n"
            "print('hello')\n"
            "print('##MVG {\"stage\":\"render\",\"frame\":1}')\n"
            "sys.exit(3)\n"
        )
        seen: list[str] = []
        runner = pipeline.ProcessRunner()
        code = runner.run(
            [sys.executable, str(script)], cwd=tmp_path, on_line=seen.append
        )
        assert code == 3
        assert "hello" in seen
        assert any(pipeline.parse_progress(line) for line in seen)

    def test_merges_stderr_into_the_stream(self, tmp_path: Path):
        import sys

        script = tmp_path / "noisy.py"
        script.write_text(chr(10).join(['import sys', "sys.stderr.write('boom' + chr(10))", 'sys.exit(1)', '']))
        seen: list[str] = []
        code = pipeline.ProcessRunner().run(
            [sys.executable, str(script)], cwd=tmp_path, on_line=seen.append
        )
        assert code == 1
        assert "boom" in seen

    def test_handle_is_published_so_a_job_can_be_cancelled(self, tmp_path: Path):
        import sys

        script = tmp_path / "sleepy.py"
        script.write_text("import time\ntime.sleep(30)\n")
        handles = []
        runner = pipeline.ProcessRunner()

        def on_process(proc):
            handles.append(proc)
            proc.terminate()

        code = runner.run(
            [sys.executable, str(script)],
            cwd=tmp_path,
            on_line=lambda _l: None,
            on_process=on_process,
        )
        assert handles, "runner must publish the process handle"
        assert code != 0


class TestLookParameter:
    """The look is chosen in the UI and has to survive the whole way to the
    query string visualizer.html reads."""

    def test_render_command_passes_the_look_through(self, tmp_path):
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
            look="orbit",
        )
        assert "--look" in cmd
        assert cmd[cmd.index("--look") + 1] == "orbit"

    def test_render_command_still_works_without_one(self, tmp_path):
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
        )
        assert "--look" not in cmd


class TestBackgroundAndServiceParameters:
    """Both travel the same path `look` does — chosen in the UI, and expected
    to survive all the way to the query string visualizer.html reads."""

    def _cmd(self, tmp_path, **over):
        kwargs = dict(
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
        )
        kwargs.update(over)
        return pipeline.render_command(**kwargs)

    def test_render_command_passes_the_background_through(self, tmp_path):
        cmd = self._cmd(tmp_path, background="nebula")
        assert "--background" in cmd
        assert cmd[cmd.index("--background") + 1] == "nebula"

    def test_render_command_still_works_without_a_background(self, tmp_path):
        assert "--background" not in self._cmd(tmp_path)

    def test_render_command_passes_services_as_one_comma_separated_flag(self, tmp_path):
        cmd = self._cmd(tmp_path, services=["spotify", "apple", "tidal"])
        assert "--services" in cmd
        assert cmd[cmd.index("--services") + 1] == "spotify,apple,tidal"

    def test_render_command_omits_services_when_none_are_picked(self, tmp_path):
        assert "--services" not in self._cmd(tmp_path, services=[])
        assert "--services" not in self._cmd(tmp_path)
