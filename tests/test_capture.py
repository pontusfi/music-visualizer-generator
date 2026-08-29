"""How frames leave the page, and what ffmpeg is asked to do with them.

render.py used to have exactly one answer: screenshot every frame as an image
and pipe it in. That is the single most expensive thing the pipeline does — the
frame is JPEG-encoded inside Chromium, base64'd over CDP, then decoded and
thrown away so x264 can make an H.264 frame out of it. The page can encode
H.264 itself, and then ffmpeg only has to mux.

These cover the pure parts of that decision: how big the bitrate should be, what
ffmpeg is invoked with, and which capture mode a given set of flags resolves to.
No browser needed.
"""

from __future__ import annotations

import pytest

import render


class TestTargetBitrate:
    """Bits per second for the in-page encoder, from the frame it is filling."""

    def test_scales_with_pixel_count(self):
        hd = render.target_bitrate(1920, 1080, 60)
        uhd = render.target_bitrate(3840, 2160, 60)
        assert uhd == pytest.approx(hd * 4, rel=0.01)

    def test_scales_with_frame_rate(self):
        assert render.target_bitrate(1920, 1080, 60) == pytest.approx(
            render.target_bitrate(1920, 1080, 30) * 2, rel=0.01
        )

    def test_1080p60_lands_in_a_sane_range(self):
        # generous: every look lays film grain over the whole frame, which is
        # the worst case there is for a bitrate-targeted encoder
        mbps = render.target_bitrate(1920, 1080, 60) / 1e6
        assert 12 <= mbps <= 40

    def test_a_small_preview_still_gets_a_usable_floor(self):
        # 320x240 x 24fps would work out at well under a megabit
        assert render.target_bitrate(320, 240, 24) >= 2_000_000

    def test_is_a_whole_number_of_bits(self):
        assert isinstance(render.target_bitrate(1280, 720, 30), int)


class TestQualityStillMeansSomething:
    """The web UI's quality picker has to keep working.

    It offers Archive/High/Balanced/Compact and sends crf 14/16/20/23. The
    in-page encoder has no CRF — this Chromium refuses `bitrateMode:
    "quantizer"` outright — so without a mapping every one of those buttons
    would produce a byte-identical file and the control would be decoration.
    """

    def test_a_lower_crf_asks_for_more_bits(self):
        assert (render.target_bitrate(1920, 1080, 60, crf=14)
                > render.target_bitrate(1920, 1080, 60, crf=23))

    def test_six_points_of_crf_is_a_halving(self):
        # the usual rule of thumb for x264, which is what the numbers in the UI
        # were chosen against
        assert render.target_bitrate(1920, 1080, 60, crf=22) == pytest.approx(
            render.target_bitrate(1920, 1080, 60, crf=16) / 2, rel=0.02
        )

    def test_the_default_crf_is_the_reference_point(self):
        # so the plain three-argument call and the UI default agree
        assert (render.target_bitrate(1920, 1080, 60)
                == render.target_bitrate(1920, 1080, 60, crf=16))

    def test_every_preset_in_the_ui_is_distinguishable(self):
        got = [render.target_bitrate(1920, 1080, 60, crf=c) for c in (14, 16, 20, 23)]
        assert got == sorted(got, reverse=True)
        assert len(set(got)) == 4

    def test_an_extreme_crf_still_produces_a_usable_file(self):
        assert render.target_bitrate(1920, 1080, 60, crf=51) >= render.MIN_BITRATE


class TestResolveCapture:
    """`auto` adapts and says so; an explicit mode is a guarantee."""

    def test_auto_takes_webcodecs_when_the_page_has_it(self):
        assert render.resolve_capture("auto", encoder_available=True) == "webcodecs"

    def test_auto_falls_back_to_jpeg_without_it(self):
        assert render.resolve_capture("auto", encoder_available=False) == "jpeg"

    def test_asking_for_webcodecs_explicitly_does_not_silently_downgrade(self):
        # the look bug was exactly this shape: a value quietly replaced by a
        # default, a success reported, and the wrong file produced
        with pytest.raises(render.CaptureUnavailable):
            render.resolve_capture("webcodecs", encoder_available=False)

    def test_webcodecs_is_honoured_when_available(self):
        assert render.resolve_capture("webcodecs", encoder_available=True) == "webcodecs"

    @pytest.mark.parametrize("mode", ["jpeg", "png"])
    def test_an_image_mode_never_consults_the_encoder(self, mode):
        assert render.resolve_capture(mode, encoder_available=True) == mode
        assert render.resolve_capture(mode, encoder_available=False) == mode


def _cmd(**kw):
    base = dict(out="out.mp4", fps=60, audio="a.wav", capture="webcodecs",
                crf=16, preset="slow", preview=None, frames=900)
    return render.ffmpeg_command(**{**base, **kw})


def _last(cmd, flag):
    return len(cmd) - 1 - cmd[::-1].index(flag)


class TestFfmpegCommandForWebcodecs:
    """The page has already produced H.264; ffmpeg only muxes."""

    def test_reads_a_raw_h264_stream_from_stdin(self):
        cmd = _cmd()
        assert "-f" in cmd and cmd[cmd.index("-f") + 1] == "h264"
        assert cmd[cmd.index("-i")] == "-i" and "-" in cmd

    def test_stream_copies_the_video_instead_of_re_encoding(self):
        cmd = _cmd()
        assert cmd[cmd.index("-c:v") + 1] == "copy"
        assert "libx264" not in cmd

    def test_does_not_pass_quality_flags_it_cannot_honour(self):
        # crf and preset belong to x264; carrying them here would imply a
        # control the in-page encoder does not have
        cmd = _cmd(crf=12, preset="veryslow")
        assert "-crf" not in cmd
        assert "-preset" not in cmd
        assert not any("x264" in part for part in cmd)

    def test_declares_the_frame_rate_on_the_input_with_r(self):
        # A raw annex-b stream carries no timebase, so the rate has to be
        # supplied. It has to be `-r`: the h264 demuxer advertises a
        # `-framerate` option, but setting it leaves the video track 0.83s long
        # whatever the real length is. Measured, not guessed.
        cmd = _cmd(fps=48)
        assert cmd[cmd.index("-r") + 1] == "48"
        assert cmd.index("-r") < cmd.index("-i")
        assert "-framerate" not in cmd

    def test_does_not_use_shortest(self):
        # -shortest reads the length off the video, and copied packets from a
        # raw stream have no timestamps for it to read. It truncated the file
        # and dropped the audio track entirely.
        assert "-shortest" not in _cmd()

    def test_bounds_the_output_to_the_frames_actually_written(self):
        # what -shortest was for, done from a number we already know exactly
        cmd = _cmd(frames=900, fps=60)
        assert cmd[_last(cmd, "-t") + 1] == "15.0"

    def test_the_bound_follows_the_frame_count(self):
        cmd = _cmd(frames=300, fps=30)
        assert cmd[_last(cmd, "-t") + 1] == "10.0"


class TestFfmpegCommandForImages:
    """The old path, unchanged — it is still the fallback."""

    @pytest.mark.parametrize("capture,codec", [("jpeg", "mjpeg"), ("png", "png")])
    def test_pipes_images_through_the_matching_decoder(self, capture, codec):
        cmd = _cmd(capture=capture)
        assert cmd[cmd.index("-f") + 1] == "image2pipe"
        assert cmd[cmd.index("-c:v") + 1] == codec

    def test_still_encodes_with_x264_and_honours_crf(self):
        cmd = _cmd(capture="jpeg", crf=14, preset="fast")
        assert "libx264" in cmd
        assert cmd[cmd.index("-crf") + 1] == "14"
        assert cmd[cmd.index("-preset") + 1] == "fast"

    @pytest.mark.parametrize("capture", ["jpeg", "png"])
    def test_keeps_using_shortest(self, capture):
        # x264 timestamps its own output, so the thing that broke the copy path
        # never applied here
        cmd = _cmd(capture=capture)
        assert "-shortest" in cmd
        assert "-t" not in cmd


class TestFfmpegCommandShape:
    """True of every capture mode."""

    @pytest.mark.parametrize("capture", ["webcodecs", "jpeg", "png"])
    def test_video_comes_from_the_pipe_and_audio_from_the_file(self, capture):
        cmd = _cmd(capture=capture, audio="/tmp/track.wav")
        assert "/tmp/track.wav" in cmd
        assert cmd[cmd.index("-map") + 1] == "0:v"
        assert cmd[cmd.index("-map", cmd.index("-map") + 1) + 1] == "1:a"

    @pytest.mark.parametrize("capture", ["webcodecs", "jpeg", "png"])
    def test_a_preview_seeks_the_audio_not_the_video(self, capture):
        # the video pipe already holds only the preview frames; it is the audio
        # that has to be moved to meet it, so -ss must sit after the video
        # input and before the audio one
        cmd = _cmd(capture=capture, preview=(30.0, 45.0), audio="a.wav")
        ss, audio_i = cmd.index("-ss"), cmd.index("a.wav")
        assert cmd.index("-i") < ss < audio_i
        assert cmd[ss + 1] == "30.0"
        assert cmd[cmd.index("-t") + 1] == "15.0"

    @pytest.mark.parametrize("capture", ["webcodecs", "jpeg", "png"])
    def test_no_seek_when_the_whole_track_is_rendered(self, capture):
        assert "-ss" not in _cmd(capture=capture)

    @pytest.mark.parametrize("capture", ["webcodecs", "jpeg", "png"])
    def test_output_is_a_playable_mp4_that_starts_immediately(self, capture):
        cmd = _cmd(capture=capture, out="/tmp/v.mp4")
        assert cmd[-1] == "/tmp/v.mp4"
        assert cmd[cmd.index("-movflags") + 1] == "+faststart"
        assert cmd[cmd.index("-c:a") + 1] == "aac"

    def test_overwrites_without_asking(self):
        # ffmpeg blocks on a y/n prompt otherwise, and nothing is reading stdin
        assert "-y" in _cmd()


class TestLaunchArgs:
    """The Chromium flags that decide what the pixels come out as.

    These used to live in two places — render.py's launch call and the
    determinism test's own literal — and had already drifted apart: the test
    was running without --disable-lcd-text, so it was proving the determinism
    of a browser configured unlike the one that does the renders.
    """

    def test_the_software_render_keeps_exactly_the_flags_it_had(self):
        # not a tautology: this is the guard that adding a GPU mode did not
        # quietly move what every existing render produces
        assert render.launch_args() == ["--force-color-profile=srgb",
                                        "--disable-lcd-text"]

    def test_asking_for_the_gpu_adds_the_angle_flags(self):
        got = render.launch_args(gpu=True)
        for flag in ("--use-angle=gl", "--enable-gpu-rasterization",
                     "--ignore-gpu-blocklist"):
            assert flag in got

    def test_the_colour_flags_survive_into_the_gpu_mode(self):
        # these are what make the *colour* reproducible; losing one while
        # gaining hardware raster would be a regression hidden behind a speedup
        got = render.launch_args(gpu=True)
        assert "--force-color-profile=srgb" in got
        assert "--disable-lcd-text" in got

    def test_the_software_mode_asks_for_no_gpu_at_all(self):
        assert not any("gpu" in f or "angle" in f for f in render.launch_args())

    def test_each_call_gets_its_own_list(self):
        # a module-level list handed out by reference would let one caller's
        # append leak into the next render — and the determinism test and the
        # renderer are exactly two such callers
        first = render.launch_args()
        first.append("--wat")
        assert "--wat" not in render.launch_args()


class TestDescribeRenderer:
    """Which rasterizer turned up, short enough for the progress line.

    `--gpu` is a request Chromium may refuse — a blocklisted driver, no GPU in
    the container — and the only symptom of a refusal is a slow render, which
    is easy to misread as a heavy track. So the answer gets printed, and this
    is the part that makes it readable.
    """

    #: exactly what this host reports, both ways round
    SWIFT = ("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)) "
             "(0x0000C0DE), SwiftShader driver)")
    NVIDIA = ("ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4060 Ti/PCIe/SSE2, "
              "OpenGL 4.5.0)")

    def test_software_raster_is_named_plainly(self):
        assert render.describe_renderer(self.SWIFT) == "swiftshader"

    def test_a_real_gpu_is_named_by_its_card(self):
        assert "4060 Ti" in render.describe_renderer(self.NVIDIA)

    def test_the_two_do_not_read_alike(self):
        # the whole point: a --gpu run that silently got SwiftShader has to be
        # distinguishable at a glance from one that did not
        assert render.describe_renderer(self.SWIFT) != render.describe_renderer(self.NVIDIA)

    def test_swiftshader_wins_over_the_angle_wrapper(self):
        # SwiftShader reports itself through ANGLE too, so parsing the
        # parenthesised vendor list first would call it "Vulkan 1.3.0"
        assert "swiftshader" == render.describe_renderer(self.SWIFT)

    @pytest.mark.parametrize("raw", ["", "unknown", "no webgl", "Mesa Intel(R) UHD"])
    def test_an_unparseable_string_is_passed_through_rather_than_raising(self, raw):
        # a crash here would fail a render that was otherwise fine
        assert isinstance(render.describe_renderer(raw), str)


class TestGpuCaution:
    """Which looks are not bit-reproducible under GPU rasterization.

    Measured, not guessed. On this host's RTX 4060 Ti, Chromium's accelerated
    2D canvas carries state between draws: rendering frame 150 of Shear four
    times running settles on one image, and rendering 149 before each 150 gives
    a different one — permanently, not as a warm-up. Orbit does the same thing
    at a max channel delta of 3; Shear reaches 121 across 12% of the frame.
    Burn and Refract are identical either way.

    The render is still correct and still reproducible against itself in a
    single sequential pass. What it is not is comparable across draw orders,
    which is what makes `--preview` differ from the same frames of a full
    render — so the caller is told.
    """

    def test_no_caution_without_the_gpu_flag(self):
        # software raster is exact for every look; the whole issue is the flag
        for look in render.GPU_UNSTABLE_LOOKS:
            assert render.gpu_caution(look, gpu=False) is None

    @pytest.mark.parametrize("look", ["burn", "refract"])
    def test_the_stable_looks_say_nothing(self, look):
        assert render.gpu_caution(look, gpu=True) is None

    @pytest.mark.parametrize("look", ["orbit", "shear"])
    def test_the_unstable_looks_are_named(self, look):
        msg = render.gpu_caution(look, gpu=True)
        assert msg is not None and look in msg

    def test_the_message_says_what_is_actually_at_risk(self):
        # not "wrong output" — the frames are fine, they just stop being
        # comparable between a preview and a full render
        msg = render.gpu_caution("shear", gpu=True).lower()
        assert "preview" in msg

    def test_an_unknown_look_is_not_warned_about(self):
        # --look is validated elsewhere; guessing here would be noise
        assert render.gpu_caution("kaleidoscope", gpu=True) is None
