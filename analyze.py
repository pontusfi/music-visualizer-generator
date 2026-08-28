#!/usr/bin/env python3
"""
Pre-compute one feature frame per *video* frame so the render is deterministic.

The whole trick is hop_length = sample_rate / fps. At 44100 Hz and 60 fps that's
exactly 735 samples, so analysis frame i is video frame i. No resampling, no
interpolation, no drift over an eight-minute track.

    python analyze.py audio.wav --fps 60 --bands 24 -o frames.json
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

#: the web UI parses these lines off stdout; on a terminal they are just noise,
#: so they only appear with --progress.
PROGRESS_PREFIX = "##MVG "


def progress(enabled: bool, **payload) -> None:
    """Machine-readable status for whoever is driving this script."""
    if not enabled:
        return
    sys.stdout.write(PROGRESS_PREFIX + json.dumps({"stage": "analyze", **payload}) + "\n")
    sys.stdout.flush()


def envelope(x: np.ndarray, attack: float, release: float) -> np.ndarray:
    """One-pole follower with asymmetric time constants.

    Fast attack keeps transients sharp (this is the whole point for blast beats);
    slow release stops the visual from strobing at 240 BPM.
    Coefficients are per-frame, so they're already fps-relative.
    """
    out = np.empty_like(x, dtype=np.float32)
    y = 0.0
    for i, v in enumerate(x):
        c = attack if v > y else release
        y += (float(v) - y) * c
        out[i] = y
    return out


def norm(x: np.ndarray, pct: float = 99.0) -> np.ndarray:
    """Normalise against a high percentile rather than the max.

    A single cymbal peak or a stray click shouldn't set the ceiling for the
    entire track — that's what flattens a loud mix into a flat visual.
    """
    ref = np.percentile(x, pct)
    return np.clip(x / ref, 0.0, 1.0) if ref > 0 else np.zeros_like(x)


def rescale(x: np.ndarray, lo_pct: float = 5.0, hi_pct: float = 95.0) -> np.ndarray:
    """Stretch a signal's own working range across 0..1.

    norm() divides by a percentile, which is right for a quantity that rests at
    zero between hits. It is wrong for one that never goes near zero — spectral
    centroid sits between 1 and 4 kHz all track, and dividing by its 99th
    percentile would squash every frame into the top of the range.
    """
    a = np.asarray(x, dtype=np.float32)
    if a.size == 0:
        return a.astype(np.float32, copy=True)
    lo, hi = np.percentile(a, lo_pct), np.percentile(a, hi_pct)
    if hi <= lo:
        return np.zeros_like(a, dtype=np.float32)
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def band_energy(S: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sel = (freqs >= lo) & (freqs < hi)
    if not sel.any():
        sel = np.zeros_like(freqs, dtype=bool)
        sel[np.argmin(np.abs(freqs - lo))] = True
    return S[sel].mean(axis=0)


#: pitch classes in circle-of-fifths order. Binning by this rather than by
#: semitone means neighbouring keys get neighbouring hues — a modulation to the
#: dominant nudges the colour, it doesn't throw it across the wheel.
FIFTHS = (0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5)


def beat_phase(beats, T: int) -> np.ndarray:
    """0->1 sawtooth between consecutive beats, one value per video frame.

    Because hop_length = sr/fps, the beat indices librosa returns *are* video
    frame indices, so there is nothing to convert.
    """
    out = np.zeros(max(0, int(T)), dtype=np.float32)
    b = np.unique(np.asarray(beats, dtype=np.int64))
    if out.size == 0 or b.size < 2:
        return out  # one beat gives no interval, so there is no phase to report
    i = np.arange(out.size)
    k = np.clip(np.searchsorted(b, i, side="right") - 1, 0, b.size - 2)
    span = (b[k + 1] - b[k]).astype(np.float64)
    span[span <= 0] = 1.0
    # the modulo keeps the pulse running outside the tracked range instead of
    # freezing: before the first beat and after the last it extrapolates at the
    # nearest known tempo, which is what a listener would keep tapping
    return np.mod((i - b[k]) / span, 1.0).astype(np.float32)


def pick_downbeat_phase(beats, kick, meter: int = 4) -> int:
    """Which beat of the bar the kick lands on.

    Beat trackers find the pulse but not the bar line, and starting every bar on
    whichever beat happened to be detected first puts the downbeat in a random
    place. On this material the downbeat is wherever the kick is, so score each
    candidate phase by the kick energy on its beats and take the loudest.
    """
    k = np.asarray(kick, dtype=np.float32)
    b = np.unique(np.asarray(beats, dtype=np.int64))
    b = b[(b >= 0) & (b < k.size)]
    if b.size == 0 or meter < 1:
        return 0
    best, score = 0, -np.inf
    for p in range(int(meter)):
        sel = b[p::int(meter)]
        if sel.size == 0:
            continue
        strength = float(k[sel].mean())
        if strength > score:
            best, score = p, strength
    return best


def bar_phase(beats, T: int, phase: int = 0, meter: int = 4) -> np.ndarray:
    """0->1 across a whole bar, so a look can breathe over four beats."""
    out = np.zeros(max(0, int(T)), dtype=np.float32)
    b = np.unique(np.asarray(beats, dtype=np.int64))
    if out.size == 0 or b.size < 2 or meter < 1:
        return out
    i = np.arange(out.size)
    ordinal = np.searchsorted(b, i, side="right") - 1
    position = np.mod(ordinal - int(phase), int(meter)).astype(np.float32)
    return ((position + beat_phase(b, out.size)) / float(meter)).astype(np.float32)


def _section_bounds(boundaries, T: int) -> np.ndarray:
    """Boundaries as a clean ascending run from 0 to T.

    Segmentation can hand back something that skips frame 0, repeats an index,
    or runs past the end; none of those should produce an empty section.
    """
    b = np.unique(np.asarray(boundaries, dtype=np.int64))
    b = b[(b > 0) & (b < int(T))]
    return np.concatenate(([0], b, [int(T)])).astype(np.int64)


def section_index(boundaries, T: int) -> np.ndarray:
    """Which section each frame belongs to."""
    T = max(0, int(T))
    if T == 0:
        return np.zeros(0, dtype=np.int32)
    starts = _section_bounds(boundaries, T)[:-1]
    return (np.searchsorted(starts, np.arange(T), side="right") - 1).astype(np.int32)


def section_phase(boundaries, T: int) -> np.ndarray:
    """0->1 through the current section: how far into this part of the song."""
    T = max(0, int(T))
    if T == 0:
        return np.zeros(0, dtype=np.float32)
    b = _section_bounds(boundaries, T)
    idx = section_index(boundaries, T)
    start = b[idx]
    span = (b[idx + 1] - start).astype(np.float64)
    span[span <= 0] = 1.0
    return np.clip((np.arange(T) - start) / span, 0.0, 1.0).astype(np.float32)


def chroma_hue(chroma) -> tuple[np.ndarray, np.ndarray]:
    """Reduce a 12 x T chroma matrix to a hue angle and a tonal confidence.

    Twelve numbers per frame is more than a palette needs. Projecting them onto
    the circle of fifths gives one angle that tracks the harmony and one
    magnitude that says how much to trust it — a dense atonal wall lands near
    zero and leaves the colour alone.
    """
    C = np.asarray(chroma, dtype=np.float64)
    if C.ndim != 2 or C.shape[0] != 12:
        raise ValueError(f"chroma must be 12 x frames, got {C.shape}")

    # Measure the peaks, not the floor. chroma_stft almost never returns a
    # clean spike — a real frame is one or two strong pitch classes sitting on
    # a bed of spectral leakage — and projecting that raw scores even plainly
    # tonal music near zero (0.02 mean across a test track with four clear
    # keys). Subtracting the median leaves only what stands above the floor,
    # and cubing sharpens what is left.
    median = np.median(C, axis=0)
    peak = C.max(axis=0)
    # How far the strongest pitch class stands clear of the floor. Without
    # this, one class beating a high floor by a hair scores the same as one
    # standing alone, because the projection below is scale-invariant.
    prominence = np.divide(peak - median, peak,
                           out=np.zeros_like(peak), where=peak > 0)
    C = np.maximum(0.0, C - median) ** 3

    angle = np.zeros(12, dtype=np.float64)
    for position, pitch_class in enumerate(FIFTHS):
        angle[pitch_class] = 2.0 * np.pi * position / 12.0
    x = np.cos(angle) @ C
    y = np.sin(angle) @ C
    total = C.sum(axis=0)
    hue = np.mod(np.arctan2(y, x) / (2.0 * np.pi), 1.0)
    # how much the surviving classes agree on one direction ...
    concentration = np.divide(np.hypot(x, y), total,
                              out=np.zeros_like(total), where=total > 0)
    # ... and how much there was to agree about
    tonal = concentration * prominence
    return hue.astype(np.float32), np.clip(tonal, 0.0, 1.0).astype(np.float32)


def smooth(x, window: int) -> np.ndarray:
    """Moving average with edge padding.

    Edge padding rather than zero padding: a track that opens loud should not
    fade up out of nothing because the filter ran off the front.
    """
    a = np.asarray(x, dtype=np.float32)
    w = max(1, int(window))
    if a.size == 0 or w == 1:
        return a.astype(np.float32, copy=True)
    w = min(w, a.size * 2 + 1)  # a window far longer than the track is just the mean
    pad = w // 2
    padded = np.pad(a, (pad, w - 1 - pad), mode="edge")
    return np.convolve(padded, np.full(w, 1.0 / w), mode="valid").astype(np.float32)


def clamp_events(events, T: int) -> list[int]:
    """Discrete frame indices, sorted, deduped and inside the track."""
    e = np.unique(np.asarray(events, dtype=np.int64))
    return [int(v) for v in e[(e >= 0) & (e < int(T))]]


def enforce_min_gap(events, min_gap: int) -> list[int]:
    """Thin out events that crowd the one before them.

    Measured from the last event *kept*, not the last one seen, so a burst of
    three close boundaries does not veto the next legitimate one.
    """
    kept: list[int] = []
    for v in np.unique(np.asarray(events, dtype=np.int64)):
        if not kept or int(v) - kept[-1] >= int(min_gap):
            kept.append(int(v))
    return kept


#: below this there is no structure worth finding — a short loop or an intro
#: sting would just get chopped into arbitrary pieces
MIN_SECTION_TRACK_SECONDS = 40.0
#: no section shorter than this, however hard the clustering wants one
MIN_SECTION_SECONDS = 8.0


def find_sections(chroma: np.ndarray, beats: list[int], T: int,
                  duration: float, fps: int) -> list[int]:
    """Frame indices where the song changes character.

    Beat-synchronise the chroma first: clustering 28,000 frame columns is slow
    and mostly measures noise, while a thousand beat columns measures the music.
    Anything unexpected falls back to a single section — a bad section map
    should cost a look its structure, never the whole render.
    """
    import librosa  # already imported by main(); the module cache makes this free

    if T <= 0 or len(beats) < 8 or duration < MIN_SECTION_TRACK_SECONDS:
        return [0]
    try:
        edges = list(beats) + [int(T)]
        starts, cols = [], []
        for a, b in zip(edges[:-1], edges[1:]):
            if b > a:
                starts.append(int(a))
                cols.append(chroma[:, a:b].mean(axis=1))
        if len(cols) < 4:
            return [0]
        synced = librosa.util.normalize(np.stack(cols, axis=1), axis=0)
        # roughly one section per 25 seconds, kept within a sane range
        k = int(np.clip(round(duration / 25.0), 4, 12))
        k = min(k, synced.shape[1] - 1)
        if k < 2:
            return [0]
        bounds = librosa.segment.agglomerative(synced, k)
        found = clamp_events([0] + [starts[int(b)] for b in bounds
                                    if 0 <= int(b) < len(starts)], T)
        # clustering will happily put two boundaries a beat apart; a section
        # nobody can perceive is worse than one boundary fewer
        return enforce_min_gap(found, int(fps * MIN_SECTION_SECONDS))
    except Exception as exc:
        print(f"  section detection failed ({exc}); treating this as one section")
        return [0]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio")
    ap.add_argument("-o", "--out", default="frames.json")
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--sr", type=int, default=44100)
    ap.add_argument("--bands", type=int, default=24)
    ap.add_argument("--fmin", type=float, default=40.0)
    ap.add_argument("--fmax", type=float, default=16000.0)
    ap.add_argument("--no-hpss", action="store_true",
                    help="skip harmonic/percussive split (much faster, less useful)")
    ap.add_argument("--progress", action="store_true",
                    help="emit machine-readable progress lines for the web UI")
    return ap


def main() -> None:
    args = build_parser().parse_args()
    # librosa pulls in numba and takes seconds to import; keep it out of --help
    import librosa

    say = lambda **kw: progress(args.progress, **kw)

    if args.sr % args.fps:
        raise SystemExit(
            f"{args.sr} Hz doesn't divide evenly by {args.fps} fps. "
            "Use 44100/30, 44100/60, 48000/30, 48000/60, or accept sub-frame drift."
        )
    hop = args.sr // args.fps
    n_fft = 2048

    say(pct=0.02, message="Loading audio")
    print(f"loading {args.audio} at {args.sr} Hz")
    y, sr = librosa.load(args.audio, sr=args.sr, mono=True)
    duration = len(y) / sr
    print(f"  {duration:.1f}s, hop={hop} samples ({args.fps} fps)")

    if args.no_hpss:
        y_h = y_p = y
    else:
        say(pct=0.10, message="Separating harmonic / percussive")
        print("separating harmonic / percussive (this is the slow part)")
        y_h, y_p = librosa.effects.hpss(y)

    say(pct=0.55, message="Transforming")
    stft = lambda sig: np.abs(librosa.stft(sig, n_fft=n_fft, hop_length=hop))
    S, Sp, Sh = stft(y), stft(y_p), stft(y_h)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    T = S.shape[1]
    print(f"  {T} frames")

    say(pct=0.72, message="Measuring bands")
    # --- log-spaced spectrum, dB-scaled so quiet detail survives -------------
    edges = np.geomspace(args.fmin, args.fmax, args.bands + 1)
    raw = np.stack([band_energy(S, freqs, edges[i], edges[i + 1])
                    for i in range(args.bands)])
    db = librosa.amplitude_to_db(raw, ref=np.max(raw))
    spectrum = np.clip((db + 70.0) / 70.0, 0.0, 1.0)
    spectrum = np.stack([envelope(b, 0.55, 0.16) for b in spectrum])

    say(pct=0.85, message="Following envelopes")
    # --- named drivers ------------------------------------------------------
    # kick: percussive sub/low. Fast attack, slowish release -> a real thump.
    kick = envelope(norm(band_energy(Sp, freqs, 35, 110)), 1.0, 0.13)
    # crack: snare body + stick attack, percussive only so guitars don't bleed in
    crack = envelope(norm(band_energy(Sp, freqs, 1500, 6000)), 1.0, 0.20)
    # wall: the harmonic guitar mass. Slow both ways — this is a bed, not a hit.
    wall = envelope(norm(band_energy(Sh, freqs, 200, 2500)), 0.30, 0.10)

    rms = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop)[0][:T]
    rms = envelope(norm(rms), 0.60, 0.12)

    onset_env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(Sp),
                                             sr=sr, hop_length=hop)[:T]
    hit = envelope(norm(onset_env, 98.0), 1.0, 0.28)

    try:  # librosa >= 0.11 moved tempo out of librosa.beat, and lazy-loads it
        from librosa.feature.rhythm import tempo as tempo_fn
    except ImportError:
        tempo_fn = librosa.beat.tempo
    tempo = float(np.atleast_1d(
        tempo_fn(onset_envelope=onset_env, sr=sr, hop_length=hop))[0])
    print(f"  estimated tempo: {tempo:.1f} BPM")

    say(pct=0.88, message="Finding the pulse")
    # --- the grid -----------------------------------------------------------
    # hop = sr/fps, so every index librosa hands back here is already a video
    # frame number. Nothing to convert, nothing to drift.
    try:
        beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr,
                                              hop_length=hop, units="frames")[1]
    except Exception as exc:  # a tracker that gives up should not fail the run
        print(f"  beat tracking failed ({exc}); the pulse will be unavailable")
        beat_frames = []
    beats = clamp_events(beat_frames, T)
    meter = 4
    downbeat = pick_downbeat_phase(beats, kick, meter)
    downbeats = beats[downbeat::meter]
    print(f"  {len(beats)} beats, downbeat on {downbeat + 1} of {meter}")

    try:
        onsets = clamp_events(
            librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr,
                                       hop_length=hop, units="frames"), T)
    except Exception as exc:
        print(f"  onset detection failed ({exc})")
        onsets = []

    say(pct=0.92, message="Reading harmony")
    # --- colour and texture -------------------------------------------------
    chroma = librosa.feature.chroma_stft(S=S, sr=sr)[:, :T]
    hue, tonal = chroma_hue(chroma)

    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0][:T]
    # log first: pitch is logarithmic, so a linear centroid spends the whole
    # track bunched at the bottom of its own range
    bright = envelope(rescale(np.log1p(centroid)), 0.40, 0.12)

    # how much of the mix is transient rather than sustained — separates a blast
    # section from a clean passage. With --no-hpss this is flat 1.0 by
    # construction, since Sp is S.
    total = S.mean(axis=0)
    drive = np.divide(Sp.mean(axis=0), total,
                      out=np.zeros_like(total), where=total > 0)
    drive = envelope(rescale(drive), 0.35, 0.10)

    # the track's long shape, over about eight seconds
    arc = rescale(smooth(rms, int(args.fps * 8)))

    say(pct=0.96, message="Finding sections")
    sections = find_sections(chroma, beats, T, duration, args.fps)
    print(f"  {len(sections)} sections")

    def pad(a):
        a = np.asarray(a, dtype=np.float32)[:T]
        return np.pad(a, (0, T - len(a)))

    r3 = lambda a: [round(float(v), 3) for v in pad(a)]
    # chroma is twelve numbers a frame and the biggest thing in the file; two
    # decimals is well past what any colour decision can see
    r2 = lambda a: [round(float(v), 2) for v in pad(a)]

    data = {
        # bumped whenever a key is added, so a look can default what is missing
        # instead of throwing on someone's older frames.json
        "version": 2,
        "fps": args.fps,
        "frames": T,
        "duration": duration,
        "bands": args.bands,
        "tempo": tempo,
        "meter": meter,
        "spectrum": [[round(float(v), 3) for v in spectrum[:, i]] for i in range(T)],
        "kick": r3(kick),
        "crack": r3(crack),
        "wall": r3(wall),
        "rms": r3(rms),
        "hit": r3(hit),
        # --- v2 -------------------------------------------------------------
        "beats": beats,
        "downbeats": downbeats,
        "onsets": onsets,
        "sections": sections,
        "beatPhase": r3(beat_phase(beats, T)),
        "barPhase": r3(bar_phase(beats, T, downbeat, meter)),
        "sectionIndex": [int(v) for v in section_index(sections, T)],
        "sectionPhase": r3(section_phase(sections, T)),
        "hue": r3(hue),
        "tonal": r3(tonal),
        "bright": r3(bright),
        "drive": r3(drive),
        "arc": r3(arc),
        "chroma": [r2(chroma[p]) for p in range(12)],
    }

    Path(args.out).write_text(json.dumps(data, separators=(",", ":")))
    mb = Path(args.out).stat().st_size / 1e6
    print(f"wrote {args.out} ({mb:.1f} MB)")
    say(pct=1.0, message="Analysis complete", frames=T, duration=duration, tempo=tempo)


if __name__ == "__main__":
    main()
