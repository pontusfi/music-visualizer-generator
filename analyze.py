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


def band_energy(S: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sel = (freqs >= lo) & (freqs < hi)
    if not sel.any():
        sel = np.zeros_like(freqs, dtype=bool)
        sel[np.argmin(np.abs(freqs - lo))] = True
    return S[sel].mean(axis=0)


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

    def pad(a):
        a = np.asarray(a, dtype=np.float32)[:T]
        return np.pad(a, (0, T - len(a)))

    r3 = lambda a: [round(float(v), 3) for v in pad(a)]

    data = {
        "fps": args.fps,
        "frames": T,
        "duration": duration,
        "bands": args.bands,
        "tempo": tempo,
        "spectrum": [[round(float(v), 3) for v in spectrum[:, i]] for i in range(T)],
        "kick": r3(kick),
        "crack": r3(crack),
        "wall": r3(wall),
        "rms": r3(rms),
        "hit": r3(hit),
    }

    Path(args.out).write_text(json.dumps(data, separators=(",", ":")))
    mb = Path(args.out).stat().st_size / 1e6
    print(f"wrote {args.out} ({mb:.1f} MB)")
    say(pct=1.0, message="Analysis complete", frames=T, duration=duration, tempo=tempo)


if __name__ == "__main__":
    main()
