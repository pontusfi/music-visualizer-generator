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

A left rail carries the job — source files, the burn-in credit line and
streaming services, the look, the background, and the output preset — and the
rest of the window is a stage showing what you are about to render.

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

### The player bench

The result player draws its own chrome — no native controls, because stock
browser UI took none of its colour from the cover. `frontend/harness.html`
mounts it on its own so the strip can be worked on without sitting through a
render first:

```bash
cd frontend && npm run dev     # then open /harness.html
```

It plays `public/sample-wide.mp4` and `public/sample-tall.mp4`: any two clips,
one of each shape. Both are gitignored (`*.mp4`), so a fresh clone shows a blank
frame until you drop two in, and `frontend/.dockerignore` keeps them out of the
image — vite copies `public/` into `dist/` verbatim and says nothing about it,
which is how 19 MB of sample video nearly shipped to every visitor.

The 9:16 tab is the one worth checking: a narrow cut is where the volume slider
drops out of the row and the mute key has to carry the level on its own.

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

# 3. judge a look and a background together in seconds: twelve frames across
#    the track, one PNG. No ffmpeg needed, so this works on a machine that
#    cannot render yet — the fast way to check whether a pair fights itself.
python render.py --look orbit --background nebula --contact-sheet sheet.png

# 4. render a 15-second test at 720p
python render.py --preview 30 45 --artist "BAND" --title "TRACK" -o test.mp4

# 5. render the whole thing, with a streaming-platform row burned in
python render.py -w 1920 -H 1080 --look burn --background drift \
    --services spotify,apple,youtube --artist "BAND" --title "TRACK" -o out.mp4

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
window.meta               // { frames, fps, look, background }
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

## The credit line

Every look draws artist and title through one shared renderer,
`viz/credit.js`, rather than each drawing its own — that used to drift: the
render shipped the type at roughly a third to a sixth the size and opacity
the web preview promised. `CREDIT.artist`/`CREDIT.title` (≈28px / 56px at
1080p) and an alpha that **floors** at 0.80/0.92 rather than ranging from
0.30 fix that; `frontend/src/preview/paint.ts` pins the same two ratios, and
`frontend/src/preview/paint.test.ts` checks the pin against `viz/credit.js`
directly, so the stage cannot go back to lying about the render quietly.

**This is a deliberate break from every render made before it.** The credit
line is bigger and brighter than it used to be, by design — anyone comparing
an old render against a new one will see the difference immediately.

A baked scrim (`buildCreditScrim` in `viz/assets.js`) sits behind the type so
it stays legible on a bright cover, which used to be the one case bone-
coloured text disappeared into the artwork entirely.

## Looks

`visualizer.html` is a shell. The design lives in `viz/`, and `?look=<id>`
picks one — `render.py --look`, or the picker in the web UI.

| id | what it does |
|---|---|
| `burn` | the signature. Ten luminance thresholds of the cover ignite from its own highlights on every kick. The ember drifts with the harmony, the composition reseats itself each section, and the channel split fires on discrete onsets. |
| `orbit` | the record spins. The cover becomes a disc, the spectrum wraps its rim, and the twelve chroma classes sit outside as spokes in circle-of-fifths order. Rotation is locked to the beat grid, so it turns at the track's tempo. |
| `shear` | the artwork tears along the spectrum. Forty-four horizontal slices, each displaced by its own frequency band; onsets rip it wide and it walks back together over the frames that follow. |
| `refract` | the cover through moving glass. A domain-warped field fills the frame and the artwork refracts through it per pixel, colour splitting where the glass bends hardest, over a two-pass bloom. The first look drawn in WebGL rather than Canvas2D — see **Rasterisation** below. Draws its own GL field as its background and ignores `?bg=`. |
| `tide` | the cover above a horizon, reflected in moving water below it. ~110 one-pixel-tall `drawImage` scanlines of a flipped copy of the cover, each offset by a sum of three sines driven by the low/mid/high spectrum thirds and the kick — the testable half lives in `waveOffset`. Canvas2D, not WebGL: a liquid reflection does not need per-pixel work, so it costs an order of magnitude less than a shader would have. |

Adding one is a file in `viz/looks/` and a line in `viz/looks/index.js`. A look
is `{ id, name, draw(ctx, sig, assets), init?(assets) }`, where `sig` is
everything in the table below for the current frame. A backend test asserts
every id the server accepts has a module registered, so the two cannot drift.

```
viz/main.js      the contract render.py drives, and the wiring
viz/signals.js   frame i -> what the music is doing; pure, unit-tested
viz/palette.js   the record's own colours, and where it sits in the frame
viz/assets.js    burn masks, grain, vignette, the credit scrim — built once
viz/credit.js    the shared artist/title renderer every look draws through
viz/services.js  streaming-platform badges, burned into the frame
viz/gl.js        the WebGL2 seam: shader looks render here and blit into #c
```

Motion trails are analytic rather than a feedback buffer. Orbit computes where
the disc was at frame *i-k* and draws it there, so nothing carries state from
one frame to the next and `--preview 90 105` produces exactly the frames a full
render would.

That is enforced, not just intended: `tests/test_determinism.py` drives the real
page and checks that walking the track in order gives byte-identical frames to
jumping straight to them, for every look, under both rasterisers. It fails if
you introduce a variable that survives a frame. `node --test "viz/**/*.test.js"`
covers the pure maths and needs no dependencies at all.

## Backgrounds

Every look used to open with a flat `fillRect` over the artwork's own darkest
bucket — close to black for most covers, so almost every render opened on
dead ground. `?bg=<id>` (`render.py --background`, or the picker in the web
UI) now picks what a look draws *on*, resolved and reused independently of
which look is chosen: twenty look/background pairs from one set of files.
There is no "flat" or "none" entry — the point is that dead ground is not a
reachable state any more, not that it is merely one option among several.

| id | what it draws | per-frame cost |
|---|---|---|
| `drift` | soft diagonal bands of ground↔ember sliding across the frame, the pitch breathing with the low end. Default — the quietest of the five, so an existing render changes the least. | 1 `drawImage` of a pre-built 2W sheet |
| `nebula` | four layered radial glows on slow seeded orbits, brightening with `rms` and `arc` | 4 `drawImage`, `lighter` |
| `rays` | light rays from behind the cover, rotating with `barPhase`, flaring on `downbeatPulse` | 1 rotated `drawImage` of a pre-built wedge sheet |
| `dust` | three parallax layers of seeded specks, drifting at their own rates | 6 `drawImage` (two each, for the wrap) |
| `grid` | a perspective grid receding to a horizon, advancing on the beat grid rather than the frame counter | ~40 strokes |

A background is `{ id, name, draw(ctx, sig, assets), init?(assets) }`, in
`viz/backgrounds/`, registered in `viz/backgrounds/index.js` exactly the way
a look is. `draw` lays the ground fill itself — a look's opening is
`bg.draw(ctx, s, a)` in place of its own `fillRect`. `refract` is the one
exception: its GL field already *is* a computed, bass-reactive background, so
it draws that and ignores `?bg=` rather than compositing a second,
independently-designed field underneath it.

## Streaming services

`?services=<comma-separated ids>` (`render.py --services`, or the checkboxes
in the web UI's burn-in panel) badges a "LISTEN ON" row into the frame,
beneath the credit block, on the same scrim. The marks in `viz/services.js`
are simplified monochrome paths tinted to the artwork's bone colour, not
shipped logo assets — no trademarked image enters the repo, and a path scales
cleanly from 720p to 4K where a bitmap would not. `layoutServices` wraps to a
second row rather than overflowing when several are picked at 9:16; an
unpicked service draws nothing.

Registry order is draw order, always: `spotify`, `apple`, `youtube`,
`soundcloud`, `bandcamp`, `tidal`, `deezer`, `amazon`, regardless of the
order they were clicked in.

## Rasterisation

Headless Chromium draws on SwiftShader, which is a CPU implementation of a GPU.
`--gpu` puts it on the real one instead. It is opt-in and never detected: the
two rasterisers do not produce identical pixels, so choosing between them by
what hardware happens to be present would make the output depend silently on
the machine. The renderer actually obtained is printed on the
`rendering frames ...` line, so a refused flag is visible rather than just slow.

Per frame at 1080p, measured on this host:

| look | SwiftShader | RTX 4060 Ti |
|---|---|---|
| `burn` | 9.4 ms | 0.06 ms |
| `orbit` | 13.7 ms | 0.08 ms |
| `shear` | 9.9 ms | 0.10 ms |
| `refract` | 42 ms | 0.06 ms |

`tide` was measured on a different machine than the table above (this was
written from a container without that RTX 4060 Ti, so the two are not
directly comparable in absolute terms) — 14.9 ms SwiftShader / 0.2 ms GPU,
against Shear's 20.0 ms / 0.1 ms on that same machine in the same run: about
0.75x Shear's cost, comfortably the same shape as the other Canvas2D looks
rather than anything closer to Refract. `ROWS` (110) was left as specified on
that basis; if a 1080p render on the reference host lands materially above
the ~10 ms the other 2D looks cost there, bring it down until it does and
update this note with the real number.

Speed is not really the point — with the in-page encoder overlapping the draw,
1080p goes from 98 fps to about 139, because encoding becomes the floor. The
point is that a heavy per-pixel shader costs *less* than the Canvas2D looks, so
effects that were unaffordable stop being so: `refract`'s bloom is a real
two-pass blur, where `burn` has to approximate one with ten masks thresholded at
init.

`refract` is the one look that wants the GPU. On software it costs about 4.5x
what the others do, and almost all of that is one fixed cost: getting a WebGL
frame out at all is ~9 ms on SwiftShader whatever is drawn, and its five passes
add the rest. It still renders correctly in the container, just slowly. (There
is no shortcut around it — capturing straight from the GL canvas measures 9.33
ms against the 9.47 ms of going through the 2D one, so the blit is not the
cost; WebGL on a CPU rasteriser is.)

**Two caveats, both measured rather than assumed.**

The determinism contract narrows to *the same machine with the same flags*.
Frame `i` still depends on nothing but `i`, which is the property that matters,
but the two rasterisers do not agree pixel-for-pixel and different GPU vendors
will not either.

And `orbit` and `shear` are not order-stable under `--gpu` — nor, independent
of which look draws on top of it, is the `grid` background. Chromium's
accelerated 2D canvas carries something between draws: Shear's frame 150 comes
out one way when drawn four times running and another when 149 is drawn before
each one — settled both ways, not a warm-up. The deltas are 3 for Orbit and 121
across 12% of the frame for Shear; `burn`, `refract` and `tide` are exact
either way, and so are `drift`, `nebula`, `rays` and `dust` as backgrounds.
Grid was found the same way `burn` proved it isn't at fault: `burn` over
`grid` still drifts on the GPU, which isolates the instability to the
background's own strokes rather than to whatever look is compositing over it.
A straight sequential render is fine either way; what stops matching is
`--preview` and the contact sheet against the same frames of a full render.
`render.py` says so when you combine an unstable look or background with
`--gpu`, and `tests/test_determinism.py` skips exactly those combinations
from the same two lists in `render.py`, so the two cannot drift.

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
