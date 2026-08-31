# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A deterministic audio-reactive music video renderer. `analyze.py` (librosa) turns
a master into a per-video-frame feature table, `visualizer.html` + `viz/` draw
each frame in headless Chromium, and ffmpeg muxes the result. A FastAPI backend
and a React frontend wrap the same two scripts as a web app.

`README.md` is unusually complete and is the reference for *why* things are the
way they are — the signal table, the look and background catalogues, measured
performance numbers, and the tuning knobs. This file covers what you need to
work in the repo without re-deriving it.

## Commands

Three test suites, three runners. All three are fast and none needs a browser.

```bash
# Python: server + job manager + the scripts' CLI contract
.venv/Scripts/python.exe -m pytest backend/tests -q        # Windows
.venv/bin/python -m pytest backend/tests -q                # POSIX

# JS: the pure maths in viz/ — no dependencies, no bundler
node --test "viz/**/*.test.js"

# TypeScript: the frontend
cd frontend && npm test
```

A single test, in each:

```bash
python -m pytest backend/tests/test_pipeline.py::TestParseProgress -q
python -m pytest tests/test_determinism.py -k "burn and software" -q
node --test --test-name-pattern "counts back before the first beat" "viz/**/*.test.js"
cd frontend && npx vitest run src/preview/paint.test.ts -t "keeps title larger"
```

`tests/` at the repo root is the slow suite: it drives real Chromium through
Playwright to prove every look and background is a pure function of the frame
index. It skips itself where Playwright or chromium is missing, and skips the
GPU parametrisation where `--gpu` still lands on SwiftShader. Run it after
touching anything under `viz/` or `render.py`.

Typecheck and build the frontend with `cd frontend && npm run build` (`tsc -b`
then `vite build`). There is no linter and no formatter configured.

### Running the stack

`docker compose up --build` → UI on :5173, API on :8000. This is the reliable
path: ffmpeg, chromium and librosa all live in the backend image.

`./run.sh` / `.\run.ps1` runs it on the host instead — faster iteration, but
ffmpeg has to be on your PATH or renders fail at the mux. `--setup` /
`-SetupOnly` installs without starting.

`frontend/harness.html` (`npm run dev`, then open `/harness.html`) mounts the
result player alone against two gitignored sample clips, so player work does not
require sitting through a render.

## Architecture

### The pipeline is two subprocesses, never an import

`backend/app/pipeline.py` builds an argv and runs `analyze.py` / `render.py` as
child processes. This is deliberate: librosa and Playwright each want to own
their process, and a subprocess is the only thing that can be killed when a user
cancels a forty-minute render. **Do not import the pipeline into the server.**

The stages report progress by printing `##MVG {json}` lines on stdout
(`PROGRESS_PREFIX`); everything else on stdout is kept as a log line.
`backend/tests/test_stage_scripts.py` feeds the commands the server builds into
the scripts' *real* argparse parsers, so a flag rename fails in CI rather than
half an hour into a render. Change a flag on one side and that test is where you
will hear about it.

`backend/app/jobs.py` owns job state: a job is a scratch directory holding the
artwork, the audio, `frames.json`, its own copy of `visualizer.html`, and the
mp4s, swept `MVG_JOB_TTL_SECONDS` after it settles. No database. Analysis runs
once per job and every requested aspect renders off that one `frames.json`.

### The `viz/` seam

`visualizer.html` exposes exactly three things to `render.py`:

```js
window.vizReady           // true once assets are decoded
window.renderFrame(i)     // draws frame i synchronously
window.meta               // { frames, fps, look, background }
```

Two rules hold everywhere under `viz/`, and they are the whole reason the output
is reproducible:

- **The frame index is the only clock.** No `requestAnimationFrame`, no
  `Date.now()`. (`viz/main.js` has one `rAF` loop, used solely to scrub the
  in-browser preview; `render.py` never takes that path.)
- **No `Math.random()` in the draw path.** Seed once at load with `mulberry32`
  from `viz/rng.js`.

Motion trails are therefore analytic, not a feedback buffer: a look computes
where a thing *was* at frame `i-k` and draws it there, so frame `i` never
depends on frame `i-1`. `tests/test_determinism.py` enforces this by checking
that walking the track in order gives byte-identical frames to jumping straight
to them.

### Registries that must not drift

A look and a background are the same shape — `{ id, name, draw(ctx, sig, assets), init?(assets) }`
— registered in `viz/looks/index.js` and `viz/backgrounds/index.js`. But the id
is duplicated in two other places, on purpose, so a typo is a 422 at upload time
rather than a blank video later:

| | source of truth | mirrors |
|---|---|---|
| looks | `viz/looks/index.js` | `backend/app/schemas.py` `LOOKS`/`Look`, `frontend/src/settings.ts` |
| backgrounds | `viz/backgrounds/index.js` | `backend/app/schemas.py` `BACKGROUNDS`/`Background`, `frontend/src/settings.ts` |
| services | `viz/services.js` | `backend/app/schemas.py` `SERVICES`/`Service`, `frontend/src/settings.ts` |

Adding one means: the `viz/` module, its `index.js` line, the `Literal` and
tuple in `schemas.py`, the frontend's settings list and panel, and a query-string
pass-through in `render.py` and `pipeline.render_command`. Backend tests assert
every id the server accepts has a module registered.

Service *draw* order always follows the registry in `viz/services.js`, never the
order the user clicked.

### The preview is a monitor, not a simulation

`frontend/src/preview/` reimplements enough of the render in TypeScript to draw
an impression from a live WebAudio analyser. It shares no code with `viz/` —
the frontend's Docker build context is `./frontend` alone, so it cannot import
across the repo. Nothing in the preview feeds the render; the mp4 comes only
from `frames.json`.

The one place the two are pinned together is the credit line's size ratios:
`frontend/src/preview/paint.test.ts` reads `viz/credit.js` **as text** (not as a
module, which would break `tsc -b` in the container build) and asserts
`CREDIT_RATIO` matches. That pin exists because the stage used to promise a
burn-in far larger than the render produced. If you change `CREDIT.artist` or
`CREDIT.title`, change `paint.ts` with it.

### Conventions worth knowing

- **Resolution is the short edge.** `1080` means 1920x1080 landscape *and*
  1080x1920 portrait — same pixel count, same render cost. Every look sizes its
  type off the short edge; `viz/palette.js` lays the cover against whichever
  edge binds.
- **`sample_rate % fps` must be 0**, because `hop_length = sr/fps` is what makes
  every frame index in `frames.json` (beats, onsets, section starts) already a
  video frame number. Validated in `schemas.py`.
- **Both frame edges must be even** — yuv420p subsamples chroma.
- **Capture path**: the page encodes its own H.264 via WebCodecs and ffmpeg
  muxes with `-c:v copy`. `--capture auto` falls back to `jpeg` where WebCodecs
  is missing; naming `webcodecs` outright makes a missing encoder an error
  rather than a silent 4x slowdown. There is no CRF in the in-page encoder, so
  `--crf` maps to a target bitrate.
- **GPU rasterisation is opt-in and never detected** (`--gpu`), because the two
  rasterisers do not produce identical pixels and auto-detection would make
  output depend on the machine. `GPU_UNSTABLE_LOOKS` / `GPU_UNSTABLE_BACKGROUNDS`
  in `render.py` list the combinations that are not order-stable under GPU
  raster; `tests/test_determinism.py` skips from those same two lists, so they
  cannot drift apart. Keep them in sync if you measure a new one.
- **Config is environment-only**, all `MVG_*`, in `backend/app/config.py`.

### Commit style

Sentence-form subject lines describing the change in the project's own voice
("Let the page encode its own H.264"), not conventional-commits prefixes. Bodies
are prose paragraphs explaining what was wrong and why the fix takes the shape
it does, usually closing with the test counts.
