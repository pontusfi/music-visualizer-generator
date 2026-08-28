import io
from pathlib import Path

import pytest

from app.jobs import JobManager, JobState, ValidationError
from app.schemas import JobParams


def png(size: int = 64) -> io.BytesIO:
    return io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * max(0, size - 8))


def wav(size: int = 256) -> io.BytesIO:
    return io.BytesIO(b"RIFF" + b"\x00" * max(0, size - 4))


class InlineExecutor:
    """Runs submitted work immediately so tests stay deterministic."""

    def __init__(self):
        self.submitted = 0

    def submit(self, fn, *args, **kwargs):
        self.submitted += 1
        fn(*args, **kwargs)

    def shutdown(self, wait=True):
        pass


class _FakeProc:
    def __init__(self, stage, sink):
        self.stage = stage
        self._sink = sink

    def terminate(self):
        self._sink.append(self.stage)

    def kill(self):
        self._sink.append(self.stage)

    def poll(self):
        return None


class FakeRunner:
    """Stands in for the real subprocess runner.

    ``plan`` maps a stage name to (lines, exit_code, writes_its_output). The
    output path is read back off the command's own ``-o``, so a stage that is
    told to write two different files over two calls really does.
    """

    def __init__(self, plan=None):
        self.plan = plan or {}
        self.calls = []
        self.cancelled = []

    @staticmethod
    def _stage(cmd):
        return "analyze" if "analyze.py" in cmd[1] else "render"

    def run(self, cmd, cwd, on_line, on_process=None):
        cmd = list(cmd)
        self.calls.append(cmd)
        stage = self._stage(cmd)
        lines, code, writes = self.plan.get(stage, ([], 0, True))
        if on_process is not None:
            on_process(_FakeProc(stage, self.cancelled))
        for line in lines:
            on_line(line)
        if writes:
            out = Path(cmd[cmd.index("-o") + 1])
            (out if out.is_absolute() else cwd / out).write_bytes(b"x" * 32)
        return code


ANALYZE_OK = (['##MVG {"stage": "analyze", "pct": 1.0}'], 0, True)
RENDER_OK = (
    ['##MVG {"stage": "render", "frame": 10, "start": 0, "end": 20}'],
    0,
    True,
)
HAPPY = {"analyze": ANALYZE_OK, "render": RENDER_OK}


def make_manager(settings, plan=None, runner=None):
    runner = runner or FakeRunner(HAPPY if plan is None else plan)
    return JobManager(settings, runner=runner, executor=InlineExecutor()), runner


def default_params(**over):
    base = dict(fps=60, resolution=720, title="Track", artist="Band")
    base.update(over)
    return JobParams(**base)


def geometry(cmd):
    """The -w/-H pair a render command carries."""
    return (int(cmd[cmd.index("-w") + 1]), int(cmd[cmd.index("-H") + 1]))


def basename(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1]


class TestJobParams:
    def test_defaults_are_a_usable_render(self):
        p = JobParams()
        assert p.fps in (30, 60)
        assert p.aspects == ["16:9"]
        assert [(o.width, o.height) for o in p.outputs()] == [(1920, 1080)]
        assert p.preview_start is None and p.preview_end is None

    def test_one_resolution_derives_both_orientations(self):
        outputs = JobParams(resolution=1080, aspects=["16:9", "9:16"]).outputs()
        assert [(o.key, o.aspect, o.width, o.height) for o in outputs] == [
            ("landscape", "16:9", 1920, 1080),
            ("portrait", "9:16", 1080, 1920),
        ]

    def test_the_resolution_is_the_short_edge_in_either_orientation(self):
        for short, long in ((720, 1280), (1080, 1920), (1440, 2560), (2160, 3840)):
            outputs = JobParams(resolution=short, aspects=["16:9", "9:16"]).outputs()
            assert [(o.width, o.height) for o in outputs] == [
                (long, short),
                (short, long),
            ]

    def test_every_tier_derives_dimensions_yuv420p_can_encode(self):
        for short in (720, 1080, 1440, 2160):
            for o in JobParams(resolution=short, aspects=["16:9", "9:16"]).outputs():
                assert o.width % 2 == 0 and o.height % 2 == 0

    def test_each_output_gets_a_file_of_its_own(self):
        outputs = JobParams(aspects=["16:9", "9:16"]).outputs()
        assert len({o.filename for o in outputs}) == 2
        assert all(o.filename.endswith(".mp4") for o in outputs)

    def test_rejects_an_odd_resolution(self):
        # yuv420p cannot encode an odd width or height
        with pytest.raises(ValueError):
            JobParams(resolution=721)

    def test_rejects_an_absurd_resolution(self):
        with pytest.raises(ValueError):
            JobParams(resolution=16)
        with pytest.raises(ValueError):
            JobParams(resolution=99998)

    def test_accepts_a_portrait_4k(self):
        # the old landscape-shaped caps (height <= 4320, width <= 7680) made a
        # 2160x3840 render unrepresentable
        outputs = JobParams(resolution=2160, aspects=["9:16"]).outputs()
        assert [(o.width, o.height) for o in outputs] == [(2160, 3840)]

    def test_rejects_a_job_with_no_aspect_at_all(self):
        with pytest.raises(ValueError):
            JobParams(aspects=[])

    def test_rejects_an_aspect_it_cannot_lay_out(self):
        with pytest.raises(ValueError):
            JobParams(aspects=["4:3"])

    def test_rejects_the_same_aspect_twice(self):
        # two identical renders is never what someone meant to ask for
        with pytest.raises(ValueError):
            JobParams(aspects=["16:9", "16:9"])

    def test_rejects_preview_end_before_start(self):
        with pytest.raises(ValueError):
            JobParams(preview_start=45.0, preview_end=30.0)

    def test_accepts_a_valid_preview_window(self):
        assert JobParams(preview_start=30.0, preview_end=45.0).preview_range() == (
            30.0,
            45.0,
        )

    def test_preview_range_is_none_when_unset(self):
        assert JobParams().preview_range() is None

    def test_rejects_fps_that_does_not_divide_the_sample_rate(self):
        # hop_length = sr / fps has to be a whole number or the frames drift
        assert 44100 % 32, "pick an fps that genuinely does not divide 44100"
        with pytest.raises(ValueError):
            JobParams(fps=32)

    def test_rejects_out_of_range_crf(self):
        with pytest.raises(ValueError):
            JobParams(crf=99)


class TestCreate:
    def test_creates_an_isolated_directory_per_job(self, settings):
        manager, _ = make_manager(settings)
        a = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        b = manager.create(default_params(), ("b.png", png()), ("b.wav", wav()))
        assert a.id != b.id
        assert a.dir != b.dir
        assert a.dir.is_dir() and b.dir.is_dir()

    def test_stores_inputs_under_stable_names_keeping_the_extension(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(), ("Cover Art.PNG", png()), ("Song.WAV", wav())
        )
        assert (job.dir / "artwork.png").exists()
        assert (job.dir / "audio.wav").exists()
        assert job.artwork_name == "artwork.png"

    def test_copies_the_visualizer_template_into_the_job(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        assert (job.dir / "visualizer.html").exists()

    def test_remembers_the_original_upload_names(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(), ("Cover Art.png", png()), ("Song.wav", wav())
        )
        assert job.image_filename == "Cover Art.png"
        assert job.audio_filename == "Song.wav"

    def test_starts_queued(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        assert job.state is JobState.QUEUED

    def test_rejects_an_unsupported_image_type(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(default_params(), ("cover.svg", png()), ("a.wav", wav()))

    def test_rejects_an_unsupported_audio_type(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(default_params(), ("a.png", png()), ("song.txt", wav()))

    def test_rejects_an_image_over_the_size_limit(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(
                default_params(),
                ("a.png", png(settings.max_image_bytes + 10)),
                ("a.wav", wav()),
            )

    def test_rejects_audio_over_the_size_limit(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(
                default_params(),
                ("a.png", png()),
                ("a.wav", wav(settings.max_audio_bytes + 10)),
            )

    def test_rejects_an_empty_upload(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(default_params(), ("a.png", io.BytesIO(b"")), ("a.wav", wav()))

    def test_a_rejected_upload_leaves_no_job_behind(self, settings):
        manager, _ = make_manager(settings)
        with pytest.raises(ValidationError):
            manager.create(
                default_params(),
                ("a.png", png(settings.max_image_bytes + 10)),
                ("a.wav", wav()),
            )
        assert manager.list() == []

    def test_path_traversal_in_a_filename_cannot_escape_the_job_dir(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(), ("../../evil.png", png()), ("../../evil.wav", wav())
        )
        assert (job.dir / "artwork.png").exists()
        assert not (settings.work_dir / "evil.png").exists()


class TestRun:
    def test_runs_analyze_then_render_and_finishes(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert [basename(c[1]) for c in runner.calls] == ["analyze.py", "render.py"]
        assert job.state is JobState.DONE
        assert job.progress == pytest.approx(1.0)
        assert job.video_path is not None and job.video_path.exists()

    def test_render_is_pointed_at_the_job_directory(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        render = runner.calls[1]
        assert render[render.index("--root") + 1] == str(job.dir)

    def test_analyze_failure_marks_the_job_failed_and_skips_render(self, settings):
        plan = {"analyze": (["Traceback: no such file"], 1, []), "render": RENDER_OK}
        manager, runner = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert job.state is JobState.FAILED
        assert job.error
        assert len(runner.calls) == 1

    def test_render_failure_marks_the_job_failed(self, settings):
        plan = {"analyze": ANALYZE_OK, "render": (["ffmpeg not found"], 127, [])}
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert job.state is JobState.FAILED
        assert job.error

    def test_an_undecodable_upload_says_so_in_plain_words(self, settings):
        plan = {
            "analyze": (
                ["  File \"analyze.py\", line 76", "audioread.exceptions.NoBackendError"],
                1,
                [],
            ),
            "render": RENDER_OK,
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert "audio" in job.error.lower()
        assert "NoBackendError" not in job.error

    def test_a_missing_ffmpeg_says_so_in_plain_words(self, settings):
        plan = {"analyze": ANALYZE_OK, "render": (["ffmpeg is not on PATH"], 4, [])}
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert "ffmpeg" in job.error.lower()

    def test_an_unrecognised_failure_keeps_the_raw_detail(self, settings):
        plan = {"analyze": (["something nobody anticipated"], 1, []), "render": RENDER_OK}
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert "something nobody anticipated" in job.error

    def test_a_zero_exit_with_no_video_is_still_a_failure(self, settings):
        plan = {"analyze": ANALYZE_OK, "render": ([], 0, [])}
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert job.state is JobState.FAILED
        assert job.video_path is None

    def test_progress_tracks_the_analyze_band_then_the_render_band(self, settings):
        plan = {
            "analyze": (['##MVG {"stage": "analyze", "pct": 0.5}'], 0, ["frames.json"]),
            "render": ([], 0, ["out.mp4"]),
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        seen = []
        manager.watch(job.id, lambda j: seen.append(j.progress))
        manager.submit(job.id)
        partial = [p for p in seen if 0 < p < 1]
        assert partial, "expected intermediate progress"
        assert seen == sorted(seen), "progress must never go backwards"

    def test_render_frame_progress_maps_into_the_upper_band(self, settings):
        plan = {
            "analyze": ([], 0, ["frames.json"]),
            "render": (
                ['##MVG {"stage": "render", "frame": 50, "start": 0, "end": 100}'],
                0,
                ["out.mp4"],
            ),
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        mid = []
        manager.watch(
            job.id,
            lambda j: mid.append(j.progress) if j.state is JobState.RENDERING else None,
        )
        manager.submit(job.id)
        assert any(0.5 < p < 1.0 for p in mid)

    def test_rate_and_eta_are_exposed_while_rendering(self, settings):
        plan = {
            "analyze": ([], 0, ["frames.json"]),
            "render": (
                [
                    '##MVG {"stage": "render", "frame": 50, "start": 0, '
                    '"end": 100, "rate": 8.0, "eta": 6.25}'
                ],
                0,
                ["out.mp4"],
            ),
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        seen = []
        manager.watch(job.id, lambda j: seen.append((j.rate, j.eta_seconds)))
        manager.submit(job.id)
        assert (8.0, 6.25) in seen

    def test_output_is_captured_for_diagnosis(self, settings):
        plan = {"analyze": (["loading audio", "boom"], 1, []), "render": RENDER_OK}
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert "boom" in "\n".join(job.log)

    def test_log_is_bounded(self, settings):
        plan = {
            "analyze": ([f"line {i}" for i in range(5000)], 0, ["frames.json"]),
            "render": RENDER_OK,
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert len(job.log) <= manager.LOG_LIMIT

    def test_progress_noise_does_not_leak_into_the_log(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        assert not any("##MVG" in line for line in job.log)

    def test_two_aspects_analyse_once_and_render_twice(self, settings):
        # frames.json does not depend on the frame size, so the expensive
        # librosa pass is shared and only the cheap stage repeats
        manager, runner = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )
        manager.submit(job.id)
        assert [basename(c[1]) for c in runner.calls] == [
            "analyze.py",
            "render.py",
            "render.py",
        ]
        assert [geometry(c) for c in runner.calls[1:]] == [(1280, 720), (720, 1280)]
        assert job.state is JobState.DONE
        assert job.progress == pytest.approx(1.0)

    def test_both_aspects_land_as_separate_files(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )
        manager.submit(job.id)
        paths = [o.path for o in job.outputs]
        assert len(set(paths)) == 2
        assert all(p.exists() for p in paths)

    def test_the_first_finished_aspect_is_what_a_bare_video_request_gets(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )
        manager.submit(job.id)
        assert job.video_path == job.outputs[0].path

    def test_progress_is_shared_out_across_the_aspects(self, settings):
        plan = {
            "analyze": ([], 0, True),
            "render": (
                ['##MVG {"stage": "render", "frame": 100, "start": 0, "end": 100}'],
                0,
                True,
            ),
        }
        manager, _ = make_manager(settings, plan)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )
        seen = []
        manager.watch(job.id, lambda j: seen.append(j.progress))
        manager.submit(job.id)
        # the first aspect finishing its frames is only halfway through the
        # render band, not the whole job
        assert any(0.55 < p < 0.7 for p in seen), seen
        assert seen == sorted(seen), "progress must never go backwards"
        assert job.progress == pytest.approx(1.0)

    def test_cancelling_during_the_first_aspect_skips_the_second(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )

        def kill_on_first_render(j):
            if j.state is JobState.RENDERING and j.render_index == 0:
                manager.cancel(j.id)

        manager.watch(job.id, kill_on_first_render)
        manager.submit(job.id)
        assert job.state is JobState.CANCELLED
        assert [basename(c[1]) for c in runner.calls] == ["analyze.py", "render.py"]

    def test_a_failure_on_the_second_aspect_fails_the_whole_job(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )

        original = manager.runner.run
        calls = {"n": 0}

        def fail_the_second_render(cmd, cwd, on_line, on_process=None):
            calls["n"] += 1
            if calls["n"] == 3:
                on_line("ffmpeg is not on PATH")
                return 4
            return original(cmd, cwd, on_line, on_process)

        manager.runner.run = fail_the_second_render
        manager.submit(job.id)
        assert job.state is JobState.FAILED
        assert "ffmpeg" in job.error.lower()

    def test_a_single_aspect_job_still_says_it_is_rendering_frames(self, settings):
        # the one-output message is what the UI has always shown; only a
        # two-output job needs to name which one is running
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        seen = []
        manager.watch(job.id, lambda j: seen.append(j.message))
        manager.submit(job.id)
        assert "Rendering frames" in seen

    def test_a_two_aspect_job_names_the_one_it_is_working_on(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(aspects=["16:9", "9:16"]), ("a.png", png()), ("a.wav", wav())
        )
        seen = []
        manager.watch(job.id, lambda j: seen.append(j.message))
        manager.submit(job.id)
        assert any("16:9" in m for m in seen)
        assert any("9:16" in m for m in seen)

    def test_preview_window_is_forwarded_to_render(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(
            default_params(preview_start=30.0, preview_end=45.0),
            ("a.png", png()),
            ("a.wav", wav()),
        )
        manager.submit(job.id)
        render = runner.calls[1]
        i = render.index("--preview")
        assert render[i + 1 : i + 3] == ["30.0", "45.0"]


class TestCancelAndCleanup:
    def test_cancel_terminates_the_running_process(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))

        def kill_midway(j):
            if j.state is JobState.ANALYZING:
                manager.cancel(j.id)

        manager.watch(job.id, kill_midway)
        manager.submit(job.id)
        assert runner.cancelled, "expected the subprocess to be terminated"
        assert job.state is JobState.CANCELLED

    def test_cancelling_a_queued_job_stops_it_from_running(self, settings):
        manager, runner = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.cancel(job.id)
        manager.submit(job.id)
        assert job.state is JobState.CANCELLED
        assert runner.calls == []

    def test_cancelling_a_finished_job_does_not_change_it(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        manager.cancel(job.id)
        assert job.state is JobState.DONE

    def test_delete_removes_the_job_and_its_directory(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        d = job.dir
        manager.delete(job.id)
        assert manager.get(job.id) is None
        assert not d.exists()

    def test_purge_drops_jobs_past_their_ttl(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        manager.submit(job.id)
        job.finished_at = job.created_at - 10_000
        removed = manager.purge(now=job.created_at)
        assert job.id in removed
        assert manager.get(job.id) is None

    def test_purge_keeps_a_running_job(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(default_params(), ("a.png", png()), ("a.wav", wav()))
        job.state = JobState.RENDERING
        job.created_at -= 10_000
        assert manager.purge() == []
        assert manager.get(job.id) is not None


class TestDownloadName:
    def test_uses_artist_and_title_when_given(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(artist="OLD NIGHT", title="Ashes"),
            ("a.png", png()),
            ("a.wav", wav()),
        )
        assert manager.download_name(job) == "OLD NIGHT - Ashes.mp4"

    def test_strips_characters_that_break_filesystems(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(artist="A/B:C", title="D*E?"),
            ("a.png", png()),
            ("a.wav", wav()),
        )
        name = manager.download_name(job)
        assert not set(name) & set('/\\:*?"<>|')
        assert name.endswith(".mp4")

    def test_falls_back_when_untitled(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(artist="", title=""), ("a.png", png()), ("a.wav", wav())
        )
        assert manager.download_name(job) == "visualizer.mp4"

    def test_names_the_aspect_when_a_job_produced_more_than_one_video(self, settings):
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(artist="OLD NIGHT", title="Ashes", aspects=["16:9", "9:16"]),
            ("a.png", png()),
            ("a.wav", wav()),
        )
        names = [manager.download_name(job, o) for o in job.outputs]
        assert names == ["OLD NIGHT - Ashes (16x9).mp4", "OLD NIGHT - Ashes (9x16).mp4"]

    def test_leaves_the_name_clean_when_there_is_only_one_video(self, settings):
        # a colon is not a filename character, so the suffix has to be spelled
        # out — but a single-aspect render should not carry one at all
        manager, _ = make_manager(settings)
        job = manager.create(
            default_params(artist="OLD NIGHT", title="Ashes"),
            ("a.png", png()),
            ("a.wav", wav()),
        )
        assert manager.download_name(job, job.outputs[0]) == "OLD NIGHT - Ashes.mp4"
