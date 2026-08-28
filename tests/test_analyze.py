"""Tests for the pure signal maths in analyze.py.

librosa is imported lazily inside main(), so none of this needs it — which is
the point: the parts that decide what the video does are testable with numpy
alone.
"""

import numpy as np
import pytest

from analyze import (
    bar_phase,
    beat_phase,
    chroma_hue,
    clamp_events,
    enforce_min_gap,
    pick_downbeat_phase,
    rescale,
    section_index,
    section_phase,
    smooth,
)


# --- beat_phase ------------------------------------------------------------

class TestBeatPhase:
    def test_resets_to_zero_on_every_beat(self):
        ph = beat_phase([0, 10, 20], 30)
        assert ph[0] == pytest.approx(0.0)
        assert ph[10] == pytest.approx(0.0)
        assert ph[20] == pytest.approx(0.0)

    def test_ramps_across_the_gap(self):
        ph = beat_phase([0, 10, 20], 30)
        assert ph[5] == pytest.approx(0.5)
        assert ph[15] == pytest.approx(0.5)
        assert ph[2] == pytest.approx(0.2)

    def test_stays_inside_the_unit_interval(self):
        ph = beat_phase([7, 19, 34, 51], 120)
        assert ph.min() >= 0.0
        assert ph.max() < 1.0

    def test_is_flat_when_the_tempo_is_unknowable(self):
        # one beat gives no interval, so there is no phase to report
        assert np.all(beat_phase([5], 30) == 0.0)
        assert np.all(beat_phase([], 30) == 0.0)

    def test_keeps_pulsing_past_the_last_beat(self):
        # a track whose beat tracking stops early should not freeze the pulse
        ph = beat_phase([0, 10], 40)
        assert ph[25] == pytest.approx(0.5)
        assert ph[30] == pytest.approx(0.0)

    def test_runs_backwards_before_the_first_beat(self):
        ph = beat_phase([10, 20], 30)
        assert ph[5] == pytest.approx(0.5)
        assert ph[0] == pytest.approx(0.0)

    def test_sorts_beats_it_is_handed_out_of_order(self):
        assert np.allclose(beat_phase([20, 0, 10], 30), beat_phase([0, 10, 20], 30))

    def test_handles_an_empty_track(self):
        assert beat_phase([0, 10], 0).shape == (0,)

    def test_returns_one_value_per_frame(self):
        assert beat_phase([0, 10, 20], 55).shape == (55,)


# --- pick_downbeat_phase ---------------------------------------------------

class TestPickDownbeatPhase:
    def test_finds_the_beat_the_kick_lands_on(self):
        kick = np.zeros(100, dtype=np.float32)
        beats = [0, 10, 20, 30, 40, 50, 60, 70]
        for b in beats[2::4]:  # beats at ordinal 2, 6 -> phase 2
            kick[b] = 1.0
        assert pick_downbeat_phase(beats, kick) == 2

    def test_defaults_to_zero_without_beats(self):
        assert pick_downbeat_phase([], np.zeros(10)) == 0

    def test_defaults_to_zero_when_no_phase_stands_out(self):
        assert pick_downbeat_phase([0, 10, 20, 30], np.ones(40)) == 0

    def test_ignores_beats_past_the_end_of_the_track(self):
        kick = np.zeros(25, dtype=np.float32)
        kick[20] = 1.0
        # beats at 40/50 are outside kick and must not index out of bounds
        assert pick_downbeat_phase([0, 10, 20, 30, 40, 50], kick) == 2

    def test_honours_a_meter_other_than_four(self):
        kick = np.zeros(100, dtype=np.float32)
        beats = [0, 10, 20, 30, 40, 50]
        for b in beats[1::3]:
            kick[b] = 1.0
        assert pick_downbeat_phase(beats, kick, meter=3) == 1


# --- bar_phase -------------------------------------------------------------

class TestBarPhase:
    def test_walks_a_quarter_of_a_bar_per_beat(self):
        bp = bar_phase([0, 10, 20, 30, 40], 50, phase=0, meter=4)
        assert bp[0] == pytest.approx(0.0)
        assert bp[10] == pytest.approx(0.25)
        assert bp[20] == pytest.approx(0.5)
        assert bp[30] == pytest.approx(0.75)

    def test_wraps_at_the_bar_line(self):
        bp = bar_phase([0, 10, 20, 30, 40], 50, phase=0, meter=4)
        assert bp[40] == pytest.approx(0.0)

    def test_shifts_with_the_downbeat_offset(self):
        bp = bar_phase([0, 10, 20, 30, 40], 50, phase=2, meter=4)
        # with the downbeat on ordinal 2, frame 20 is the start of the bar
        assert bp[20] == pytest.approx(0.0)
        assert bp[30] == pytest.approx(0.25)

    def test_moves_within_a_beat_too(self):
        bp = bar_phase([0, 10, 20, 30, 40], 50, phase=0, meter=4)
        assert bp[5] == pytest.approx(0.125)

    def test_stays_inside_the_unit_interval(self):
        bp = bar_phase([0, 7, 15, 22, 30, 37], 60)
        assert bp.min() >= 0.0
        assert bp.max() < 1.0

    def test_is_flat_when_the_tempo_is_unknowable(self):
        assert np.all(bar_phase([5], 20) == 0.0)


# --- sections --------------------------------------------------------------

class TestSections:
    def test_index_steps_up_at_each_boundary(self):
        idx = section_index([0, 10, 25], 40)
        assert idx[0] == 0
        assert idx[9] == 0
        assert idx[10] == 1
        assert idx[24] == 1
        assert idx[25] == 2
        assert idx[39] == 2

    def test_the_track_always_opens_in_section_zero(self):
        # librosa can hand back boundaries that do not start at frame 0
        idx = section_index([10, 25], 40)
        assert idx[0] == 0
        assert idx[10] == 1

    def test_a_track_with_no_boundaries_is_one_section(self):
        assert np.all(section_index([], 30) == 0)

    def test_boundaries_outside_the_track_are_dropped(self):
        idx = section_index([0, 10, 900], 20)
        assert idx.max() == 1

    def test_repeated_boundaries_do_not_create_empty_sections(self):
        assert np.array_equal(section_index([0, 10, 10, 20], 30),
                              section_index([0, 10, 20], 30))

    def test_phase_runs_zero_to_one_through_a_section(self):
        ph = section_phase([0, 20], 40)
        assert ph[0] == pytest.approx(0.0)
        assert ph[10] == pytest.approx(0.5)
        assert ph[20] == pytest.approx(0.0)
        assert ph[30] == pytest.approx(0.5)

    def test_phase_stays_inside_the_unit_interval(self):
        ph = section_phase([0, 13, 27, 31], 60)
        assert ph.min() >= 0.0
        assert ph.max() < 1.0

    def test_one_value_per_frame(self):
        assert section_index([0, 10], 33).shape == (33,)
        assert section_phase([0, 10], 33).shape == (33,)


# --- chroma_hue ------------------------------------------------------------

def chroma_of(*pitch_classes, frames=1):
    """A chroma matrix with the named pitch classes lit."""
    c = np.zeros((12, frames), dtype=np.float32)
    for pc in pitch_classes:
        c[pc, :] = 1.0
    return c


class TestChromaHue:
    def test_c_sits_at_the_origin_of_the_circle(self):
        hue, _ = chroma_hue(chroma_of(0))
        assert hue[0] == pytest.approx(0.0, abs=1e-6)

    def test_g_is_one_step_round_the_circle_of_fifths(self):
        # a fifth up should move the hue by exactly one twelfth, not by 7/12
        hue, _ = chroma_hue(chroma_of(7))
        assert hue[0] == pytest.approx(1 / 12, abs=1e-6)

    def test_neighbouring_keys_land_next_to_each_other(self):
        # D is two fifths from C
        hue, _ = chroma_hue(chroma_of(2))
        assert hue[0] == pytest.approx(2 / 12, abs=1e-6)

    def test_a_single_strong_pitch_reads_as_tonal(self):
        _, tonal = chroma_hue(chroma_of(4))
        assert tonal[0] == pytest.approx(1.0, abs=1e-6)

    def test_opposing_pitches_cancel_to_atonal(self):
        # C and F# are half a circle apart
        _, tonal = chroma_hue(chroma_of(0, 6))
        assert tonal[0] == pytest.approx(0.0, abs=1e-6)

    def test_a_peak_over_a_noisy_floor_still_reads_as_tonal(self):
        # chroma_stft almost never returns a clean spike: a real frame is one
        # strong pitch class sitting on a floor of spectral leakage. Dividing
        # the vector sum by the raw total scores that near zero, which made the
        # signal useless on actual music -- measured 0.02 mean on a track with
        # four clearly tonal sections.
        c = np.full((12, 1), 0.45, dtype=np.float32)
        c[7, 0] = 1.0
        hue, tonal = chroma_hue(c)
        assert tonal[0] > 0.5
        assert hue[0] == pytest.approx(1 / 12, abs=1e-6)

    def test_reads_a_clearer_peak_as_more_tonal_than_a_vaguer_one(self):
        clear = np.full((12, 1), 0.2, dtype=np.float32)
        clear[7, 0] = 1.0
        vague = np.full((12, 1), 0.8, dtype=np.float32)
        vague[7, 0] = 1.0
        assert chroma_hue(clear)[1][0] > chroma_hue(vague)[1][0]

    def test_a_flat_chroma_is_atonal(self):
        _, tonal = chroma_hue(np.ones((12, 1), dtype=np.float32))
        assert tonal[0] == pytest.approx(0.0, abs=1e-6)

    def test_silence_produces_numbers_not_nans(self):
        hue, tonal = chroma_hue(np.zeros((12, 3), dtype=np.float32))
        assert np.all(np.isfinite(hue))
        assert np.all(np.isfinite(tonal))
        assert np.all(tonal == 0.0)

    def test_hue_does_not_depend_on_how_loud_the_frame_is(self):
        quiet, _ = chroma_hue(chroma_of(9) * 0.01)
        loud, _ = chroma_hue(chroma_of(9) * 100.0)
        assert quiet[0] == pytest.approx(loud[0], abs=1e-6)

    def test_outputs_stay_in_range_across_many_frames(self):
        rng = np.random.default_rng(7)
        hue, tonal = chroma_hue(rng.random((12, 200)))
        assert hue.min() >= 0.0 and hue.max() < 1.0
        assert tonal.min() >= 0.0 and tonal.max() <= 1.0

    def test_one_value_per_frame(self):
        hue, tonal = chroma_hue(np.ones((12, 41)))
        assert hue.shape == (41,)
        assert tonal.shape == (41,)

    def test_rejects_something_that_is_not_a_chroma_matrix(self):
        with pytest.raises(ValueError):
            chroma_hue(np.ones((7, 10)))


# --- smooth ----------------------------------------------------------------

class TestSmooth:
    def test_leaves_a_constant_alone(self):
        assert np.allclose(smooth(np.full(50, 0.4, dtype=np.float32), 9), 0.4, atol=1e-5)

    def test_keeps_the_length(self):
        assert smooth(np.zeros(37, dtype=np.float32), 11).shape == (37,)

    def test_a_window_of_one_changes_nothing(self):
        x = np.array([0.0, 1.0, 0.2, 0.9], dtype=np.float32)
        assert np.allclose(smooth(x, 1), x)

    def test_flattens_a_spike_without_losing_it(self):
        x = np.zeros(101, dtype=np.float32)
        x[50] = 1.0
        out = smooth(x, 21)
        assert out[50] < 0.2       # the spike is spread
        assert out[50] > 0.0       # but it is still there
        assert out[45] > 0.0       # and it has reached its neighbours

    def test_does_not_sag_at_the_edges(self):
        # edge padding, not zero padding: a loud intro must stay loud
        assert smooth(np.ones(40, dtype=np.float32), 15)[0] == pytest.approx(1.0, abs=1e-5)

    def test_handles_an_empty_track(self):
        assert smooth(np.zeros(0, dtype=np.float32), 5).shape == (0,)

    def test_survives_a_window_longer_than_the_track(self):
        out = smooth(np.array([0.0, 1.0], dtype=np.float32), 99)
        assert out.shape == (2,)
        assert np.all(np.isfinite(out))


# --- clamp_events ----------------------------------------------------------

class TestClampEvents:
    def test_drops_events_outside_the_track(self):
        assert clamp_events([-5, 0, 10, 300], 100) == [0, 10]

    def test_dedupes_and_sorts(self):
        assert clamp_events([30, 10, 30, 10, 20], 100) == [10, 20, 30]

    def test_returns_plain_ints_for_json(self):
        out = clamp_events(np.array([3, 9]), 20)
        assert out == [3, 9]
        assert all(type(v) is int for v in out)

    def test_handles_nothing(self):
        assert clamp_events([], 10) == []


# --- rescale ---------------------------------------------------------------

class TestRescale:
    def test_stretches_a_narrow_range_to_fill_zero_to_one(self):
        # spectral centroid never goes near zero, so dividing by a percentile
        # (what norm() does) would squash everything into the top of the range
        out = rescale(np.linspace(2000.0, 3000.0, 101).astype(np.float32))
        assert out.min() == pytest.approx(0.0)
        assert out.max() == pytest.approx(1.0)

    def test_keeps_the_ordering(self):
        x = np.array([5.0, 1.0, 3.0, 9.0], dtype=np.float32)
        out = rescale(x, 0.0, 100.0)
        assert list(np.argsort(out)) == list(np.argsort(x))

    def test_clips_the_tails_it_was_told_to_ignore(self):
        # one stray click must not set the ceiling for the whole track
        x = np.concatenate([np.linspace(1.0, 2.0, 98), [-500.0, 500.0]]).astype(np.float32)
        out = rescale(x, 5.0, 95.0)
        assert out[98] == 0.0  # the -500 is pinned to the floor
        assert out[99] == 1.0  # the +500 to the ceiling
        assert np.all((out >= 0.0) & (out <= 1.0))
        # and the bulk still uses most of the range rather than a sliver
        assert out[:98].max() - out[:98].min() > 0.8

    def test_a_flat_signal_does_not_divide_by_zero(self):
        out = rescale(np.full(20, 7.0, dtype=np.float32))
        assert np.all(np.isfinite(out))
        assert np.all(out == 0.0)

    def test_handles_an_empty_track(self):
        assert rescale(np.zeros(0, dtype=np.float32)).shape == (0,)

    def test_keeps_the_length(self):
        assert rescale(np.linspace(0.0, 1.0, 43).astype(np.float32)).shape == (43,)


# --- enforce_min_gap -------------------------------------------------------

class TestEnforceMinGap:
    def test_drops_events_that_crowd_the_one_before(self):
        assert enforce_min_gap([0, 5, 10, 100], 20) == [0, 100]

    def test_always_keeps_the_first(self):
        assert enforce_min_gap([7, 8, 9], 50) == [7]

    def test_measures_from_the_last_kept_event_not_the_last_seen(self):
        # 0, 15, 30 with a gap of 20: 15 is dropped, and 30 is then far enough
        # from 0 to survive. Comparing against 15 would wrongly drop it too.
        assert enforce_min_gap([0, 15, 30], 20) == [0, 30]

    def test_a_gap_of_one_changes_nothing(self):
        assert enforce_min_gap([0, 1, 2, 3], 1) == [0, 1, 2, 3]

    def test_sorts_and_dedupes_first(self):
        assert enforce_min_gap([30, 0, 30, 60], 10) == [0, 30, 60]

    def test_handles_nothing(self):
        assert enforce_min_gap([], 10) == []

    def test_returns_plain_ints_for_json(self):
        out = enforce_min_gap(np.array([0, 40]), 10)
        assert all(type(v) is int for v in out)
