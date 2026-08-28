# metal-visualizer

Deterministic audio-reactive visualizer renders. Python analyses the track,
a headless browser draws the frames, ffmpeg muxes the result.

Nothing is captured live off a screen, so blast-beat transients land on the
exact frame they occur on and a re-render after a new master is bit-identical
apart from the audio itself.

## Web interface

Upload a cover and a master, press one button, get an mp4 back. Same pipeline,
same determinism — the browser is only a front door.

```bash
docker compose up --build      # http://localhost:5173
```

Everything the render needs (ffmpeg, chromium, librosa) is inside the backend
image, so this is the path that works on a machine that has none of them.

To run it on the host instead — faster iteration, your own CPU:

```bash
./run.sh                       # macOS / Linux / Git Bash
.\run.ps1                     # Windows PowerShell
```

Either script creates `.venv`, installs the Python and Node dependencies,
downloads chromium once, then serves the API on :8000 and the UI on :5173.
`--setup` / `-SetupOnly` stops after installing. ffmpeg you install yourself.

Nothing is persisted between sessions. A job is a directory under the work dir
holding the artwork, the audio, `frames.json`, its own copy of
`visualizer.html`, and the finished mp4; it is swept two hours after the job
settles. There is no database and no account.

### What the UI exposes

A left rail carries the job — source files, the burn-in credit line, and the
output preset — and the rest of the window is a stage showing what you are
about to render.

Three presets cover the usual answers: **Test window**, **Delivery** (1080p60,
crf 16), and **Master** (2160p60, crf 14). Each quotes an estimate once the
track's length is known. Behind *Advanced* sit aspect, resolution, frame rate,
x264 preset, quality, the two analysis settings worth touching from outside —
band count and the harmonic/percussive split — and the test window's own bounds.
That window is the same `--preview` range the CLI takes, and it is still the
right way to judge the look before committing an hour.

Aspect is 16:9, 9:16, or both. Resolution is the **short** edge, so 1080p means
1920x1080 landscape and 1080x1920 portrait — the same pixel count, and so the
same render time, either way. The cover is laid out against whichever edge
binds: at 16:9 it takes 62% of the height, and on a phone frame, where that
would push it off both sides, it takes 86% of the width instead and the
cover-plus-spectrum block is centred.

Ticking both cuts renders both from one upload. `frames.json` does not depend on
the frame size, so the analysis pass is shared and only the drawing repeats: one
job, one progress bar, two mp4s. It is still two renders' worth of frames, so
budget about twice the wall clock of one.

The stage plays the master locally through a WebAudio analyser and draws an
impression of the render from the cover, its highlights, and the live spectrum,
with the five levels the renderer keys off (kick, crack, wall, hit, rms) metered
underneath. It is a monitor, not a simulation: the mp4 is drawn from the frame
table `analyze.py` writes, and nothing in the preview feeds into it. The shell
also takes its accent colour from the artwork, by binning the saturated pixels
by hue and keeping the heaviest bin.

Once a job starts, the footer becomes the progress read-out and a console opens
under the stage with the log tail. When the render lands, the stage shows the
finished mp4 in place of the preview — with a tab per aspect when there are two,
and a download button for each.

### API

| method | path | |
|---|---|---|
| `GET` | `/api/health` | tool availability, accepted formats, size limits |
| `POST` | `/api/jobs` | multipart `image` + `audio` + render settings → job |
| `GET` | `/api/jobs/{id}` | state, progress, ETA, log tail |
| `GET` | `/api/jobs/{id}/events` | the same as server-sent events |
| `GET` | `/api/jobs/{id}/video` | the mp4 (`?variant=landscape\|portrait` to pick an aspect, `?download=1` to name the file) |
| `POST` | `/api/jobs/{id}/cancel` | kill the running stage |
| `DELETE` | `/api/jobs/{id}` | drop the job and its directory |

Renders run one at a time by default (`MVG_MAX_WORKERS`); two concurrent
renders on the same CPU finish no sooner and each look stalled while they wait.

### Layout

```
analyze.py  render.py  visualizer.html    the pipeline, unchanged in spirit
viz/        the design: signals, palette, assets, one file per look
backend/    FastAPI: job directories, two subprocesses, progress
frontend/   React + Vite
```

The server never imports the pipeline. It builds an argv and runs the scripts as
child processes, which is what makes a forty-minute render cancellable and keeps
librosa and Playwright out of the web worker. `backend/tests/test_stage_scripts.py`
parses the exact commands the server builds with the scripts' real argument
parsers, so a flag rename fails in CI rather than half an hour into a render.

## Command line

### Setup

```bash
pip install librosa numpy playwright
playwright install chromium
# ffmpeg must be on PATH
```

Drop two files in this directory:

- `audio.wav` — the final master, 44.1 or 48 kHz
- `artwork.jpg` — the cover, at least 1400px square

(The web UI does this per job in a scratch directory instead, and passes the
uploaded cover's real filename to `visualizer.html` as `?art=`.)

### Run

```bash
# 1. analyse: one feature frame per video frame
python analyze.py audio.wav --fps 60 --bands 24 -o frames.json

# 2. preview in a real browser, with audio, before committing to a render
python -m http.server 8000
#    open http://localhost:8000/visualizer.html?preview=1&w=1280&h=720

# 3. judge a look in seconds: twelve frames across the track, one PNG.
#    No ffmpeg needed, so this works on a machine that cannot render yet.
python render.py --look orbit --contact-sheet sheet.png

# 4. render a 15-second test at 720p
python render.py --preview 30 45 --artist "BAND" --title "TRACK" -o test.mp4

# 5. render the whole thing
python render.py -w 1920 -H 1080 --look burn --artist "BAND" --title "TRACK" -o out.mp4

# 6. the same track as a phone cut — every look refits itself to the frame
python render.py -w 1080 -H 1920 --look burn --artist "BAND" --title "TRACK" -o vertical.mp4
```

`render.py` takes any even `-w`/`-H`; `viz/palette.js` lays the cover out against
whichever edge binds and every look sizes its type off the short edge, so a
portrait frame needs no other flag. The web UI drives exactly this, once per
aspect, off one `frames.json`.

### Speed

Both columns measured in the same container run, software rasterisation, same
6s range of the same track:

| output | `--capture webcodecs` (default) | `--capture jpeg` (old) | 8-minute track |
|---|---|---|---|
| 720p (1280x720 / 720x1280) @ 60 | 217 fps | 30 fps | ~2 min, was ~16 |
| 1080p (1920x1080 / 1080x1920) @ 60 | 98 fps | 16 fps | ~5 min, was ~30 |
| 2160p (3840x2160 / 2160x3840) @ 60 | 25 fps | 5 fps | ~19 min, was ~91 |

The tier is the short edge, and an aspect only turns the frame, so a portrait
cut costs what its landscape twin costs. Rendering both is two passes: two rows'
worth of time off one analysis.

### How frames leave the page

Getting the pixels out used to be the whole cost — about 45ms of the 52ms each
1080p frame took, against ~10ms to draw it. Each frame was JPEG-encoded inside
Chromium, base64'd over the debug protocol, then decoded and thrown away so
x264 could make an H.264 frame out of it.

So the page encodes its own H.264 now, via `VideoEncoder` (WebCodecs), and
ffmpeg only muxes it against the audio — `-c:v copy`, x264 never runs. It is
also *better*, because the old path lost quality twice, once to JPEG and once
to x264, where the encoder now reads the canvas pixels directly. Against a
lossless reference of the same 3s at 1080p:

| | luma PSNR | luma SSIM |
|---|---|---|
| `webcodecs` | 54.4 dB | 0.9976 |
| `jpeg` | 48.8 dB | 0.9746 |

`--capture auto` (the default) uses it where the browser has it and falls back
to `jpeg` where it does not, saying which on the `rendering frames ...` line.
Naming `--capture webcodecs` outright makes it an error rather than a silent
downgrade. `--capture png` is still there for a lossless intermediate, and is
still by far the slowest thing here.

The in-page encoder has no CRF — this Chromium refuses `bitrateMode:
"quantizer"` — so `--crf` is mapped to a target bitrate at six points per
doubling, which keeps the quality picker meaningful. `--bitrate MBPS` overrides
it. Note that on easy material the encoder simply will not spend the top of
that budget, so crf 14 and 16 can land on the same file. Use `--fps 30` while
iterating.

## The Claude Design seam

`visualizer.html` exposes exactly three things to `render.py`:

```js
window.vizReady           // true once assets are decoded
window.renderFrame(i)     // draws frame i synchronously
window.meta               // { frames, fps, look }
```

Everything else is design and can be thrown away — see **Looks** below for how
`viz/` is laid out. Build a look in Claude Design from the artwork, export
standalone HTML, then port the drawing into a `viz/looks/*.js` module under two
rules:

- **No `requestAnimationFrame` and no wall-clock time.** The frame index is the
  only clock. If the drawing consults `Date.now()` the render will not match
  the preview.
- **No `Math.random()` in the draw path.** Seed noise once at load
  (`mulberry32` is in `viz/rng.js`). Otherwise grain flickers between frames in
  a way that looks like encoder noise and eats bitrate.

Both rules are why motion trails here are analytic rather than a feedback
buffer: a look computes where a thing *was* at frame `i-k` and draws it there,
so frame `i` never depends on frame `i-1`.

## Looks

`visualizer.html` is a shell. The design lives in `viz/`, and `?look=<id>`
picks one — `render.py --look`, or the picker in the web UI.

| id | what it does |
|---|---|
| `burn` | the signature. Ten luminance thresholds of the cover ignite from its own highlights on every kick. The ember drifts with the harmony, the composition reseats itself each section, and the channel split fires on discrete onsets. |
| `orbit` | the record spins. The cover becomes a disc, the spectrum wraps its rim, and the twelve chroma classes sit outside as spokes in circle-of-fifths order. Rotation is locked to the beat grid, so it turns at the track's tempo. |
| `shear` | the artwork tears along the spectrum. Forty-four horizontal slices, each displaced by its own frequency band; onsets rip it wide and it walks back together over the frames that follow. |

Adding one is a file in `viz/looks/` and a line in `viz/looks/index.js`. A look
is `{ id, name, draw(ctx, sig, assets), init?(assets) }`, where `sig` is
everything in the table below for the current frame. A backend test asserts
every id the server accepts has a module registered, so the two cannot drift.

```
viz/main.js      the contract render.py drives, and the wiring
viz/signals.js   frame i -> what the music is doing; pure, unit-tested
viz/palette.js   the record's own colours, and where it sits in the frame
viz/assets.js    burn masks, grain, vignette — everything expensive, built once
```

Motion trails are analytic rather than a feedback buffer. Orbit computes where
the disc was at frame *i-k* and draws it there, so nothing carries state from
one frame to the next and `--preview 90 105` produces exactly the frames a full
render would.

That is enforced, not just intended: `tests/test_determinism.py` drives the real
page and checks that walking the track in order gives byte-identical frames to
jumping straight to them, for every look. It fails if you introduce a variable
that survives a frame. `node --test "viz/**/*.test.js"` covers the pure maths
and needs no dependencies at all.

## What drives what

`frames.json` is `"version": 2`. Per frame, all 0–1:

| key | source | feel |
|---|---|---|
| `kick` | 35–110 Hz, percussive only | thump. fast attack, 130ms release |
| `crack` | 1.5–6 kHz, percussive only | snare and stick attack |
| `wall` | 200 Hz–2.5 kHz, harmonic only | guitar mass. slow, a bed not a hit |
| `hit` | onset strength, percussive | transient spikes |
| `rms` | full mix | overall loudness |
| `spectrum` | 24 log bands, dB-scaled | shape |
| `beatPhase` | beat grid | 0→1 between beats; the pulse |
| `barPhase` | beat grid + meter | 0→1 across a bar |
| `sectionPhase` | segmentation | 0→1 through this part of the song |
| `hue`, `tonal` | chroma on the circle of fifths | harmony as an angle, and how much to trust it |
| `bright` | spectral centroid, log-scaled | dark verse vs. open chorus |
| `drive` | percussive / total energy | blast section vs. clean passage |
| `arc` | `rms` over ~8 s | the track's long dynamic shape |

And whole-track data, as frame indices: `beats`, `downbeats`, `onsets`,
`sections`, plus `sectionIndex` per frame, the raw 12×T `chroma`, `tempo` and
`meter`. `onsets` are discrete events, so a look can run a one-shot on its own
timeline instead of thresholding a continuous envelope.

The harmonic/percussive split is what makes this usable on death metal.
A plain FFT band at 80 Hz sees the kick *and* the down-tuned guitar
fundamental, so on a fast track everything moves at once and reads as mush.
Splitting first means `kick` follows the drums and `wall` follows the riff.

Two signals exist to be *distrusted*. `tonal` says how tonal the frame actually
is — a dense atonal wall lands near zero, and a look should weight `hue` by it
rather than swinging the palette on noise. And beat tracking is only as good as
the material: everything driven by `beatPhase` should degrade to "slightly off
pulse", never to broken.

Because `hop_length = sr/fps`, every frame index in this file — beats, onsets,
section starts — is already a video frame number. Nothing converts.

## Tuning

- `envelope(x, attack, release)` in `analyze.py` is where the feel lives.
  Slower release on `kick` if the visual strobes; faster attack on `crack` if
  snare hits feel late.
- Percentile normalisation (99th, not max) stops one cymbal crash from setting
  the ceiling for an entire track.
- Per-track normalisation means a quiet interlude will look as active as the
  heaviest section. For a full-album video, analyse the album as one file so
  the dynamics are shared across tracks.
