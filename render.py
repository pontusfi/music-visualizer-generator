#!/usr/bin/env python3
"""
Drive visualizer.html frame by frame in headless Chromium and stream the result
into ffmpeg. Nothing touches the disk in between, so an eight-minute 60 fps
render doesn't leave you with 28,800 files.

    python render.py --preview 30 45          # 15s test at 1280x720
    python render.py -w 3840 -H 2160 -o out.mp4

By default the page encodes its own H.264 (WebCodecs) and ffmpeg only muxes it
against the audio. The older path — screenshot every frame, let x264 encode the
images — is still there behind --capture jpeg, but it is about six times slower
and slightly worse: it lost quality twice, once to JPEG and once to x264, where
the encoder now reads the canvas pixels directly. Measured at 1080p60 on the
same 15s range: 10s against 57s, and 54.4dB against 48.8dB luma PSNR.

--root points the local server at a directory other than this one, which is how
the web UI keeps concurrent jobs from seeing each other's frames.json.

Needs: pip install playwright && playwright install chromium
"""

import argparse
import base64
import collections
import functools
import http.server
import json
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).parent.resolve()

#: the web UI parses these lines off stdout; --progress keeps them off a terminal
PROGRESS_PREFIX = "##MVG "
#: how often to report while rendering — every frame would flood the pipe
REPORT_EVERY = 12


def progress(enabled: bool, **payload) -> None:
    """Machine-readable status for whoever is driving this script."""
    if not enabled:
        return
    sys.stdout.write(PROGRESS_PREFIX + json.dumps({"stage": "render", **payload}) + "\n")
    sys.stdout.flush()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Silent: this output is a user-facing log in the web UI, and one line per
    frame request drowns everything worth reading."""

    def log_message(self, *args, **kwargs) -> None:
        pass


def serve(root: Path) -> int:
    """Local HTTP server — file:// can't fetch frames.json."""
    handler = functools.partial(QuietHandler, directory=str(root))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return port


def should_report(kind: str, text: str, url: str) -> bool:
    """Console errors worth forwarding. The display font is optional — the
    template falls back to a condensed sans — so its 404 is not news."""
    if kind != "error":
        return False
    if "Failed to load resource" in text and "/fonts/" in url:
        return False
    return True


def build_url(port: int, w: int, h: int, title: str, artist: str, artwork: str,
              look: str = "burn") -> str:
    """Percent-encoded, because an ampersand in a track title is not a delimiter."""
    query = urlencode({"w": w, "h": h, "title": title, "artist": artist,
                       "art": artwork, "look": look})
    return f"http://127.0.0.1:{port}/visualizer.html?{query}"


class CaptureUnavailable(RuntimeError):
    """Asked for a capture mode this browser cannot do."""


#: Bits per pixel per frame for the in-page encoder. Live action is happy at
#: ~0.1; every look here lays film grain over the whole frame, which is the
#: worst case a bitrate-targeted encoder can be handed, so this sits above it.
BPP = 0.15
#: Below this, a small preview looks like a video call rather than a test.
MIN_BITRATE = 2_000_000
#: The crf `BPP` was chosen at, and the UI's own default.
REFERENCE_CRF = 16
#: Points of crf per doubling of bitrate — the usual x264 rule of thumb, and
#: what the numbers behind the quality picker were picked against.
CRF_PER_DOUBLING = 6.0


def target_bitrate(w: int, h: int, fps: float, crf: int = REFERENCE_CRF,
                   bpp: float = BPP) -> int:
    """Bits per second the page should aim for, from the frame it is filling.

    `crf` is carried across even though the in-page encoder has no such
    control — this Chromium refuses `bitrateMode: "quantizer"` outright, so
    quality can only be asked for as a rate. Without the mapping, the web UI's
    Archive/High/Balanced/Compact buttons would all produce identical files.
    """
    scale = 2.0 ** ((REFERENCE_CRF - crf) / CRF_PER_DOUBLING)
    return max(MIN_BITRATE, int(w * h * fps * bpp * scale))


def resolve_capture(requested: str, encoder_available: bool) -> str:
    """Which capture mode to actually use.

    `auto` adapts to the browser and the caller is told which way it went. An
    explicit `webcodecs` is a guarantee: silently falling back would report
    success and hand back a file produced the slow way, which is the same shape
    of bug as a render that quietly ignored `--look`.
    """
    if requested == "auto":
        return "webcodecs" if encoder_available else "jpeg"
    if requested == "webcodecs" and not encoder_available:
        raise CaptureUnavailable(
            "this browser has no usable VideoEncoder; use --capture auto or --capture jpeg"
        )
    return requested


def ffmpeg_command(*, out, fps: float, audio, capture: str, crf: int,
                   preset: str, frames: int, preview=None) -> list[str]:
    """How the frames on stdin become the finished file.

    Two quite different jobs behind one signature. Fed images, ffmpeg is the
    encoder and `--crf`/`--preset` are the quality controls. Fed H.264 the page
    encoded itself, ffmpeg is only a muxer: the video is copied through
    untouched and x264 never runs at all.

    The copy path needs more care than it looks like it should. A raw annex-b
    stream has no timebase, and packets copied out of one reach the muxer with
    no timestamps at all, so anything that works the length out from the video
    gets it wrong. Hence `-r` rather than the demuxer's own `-framerate` (which
    is accepted and then ignored), and an explicit output `-t` rather than
    `-shortest` (which truncated the file to a fraction of its length and
    dropped the audio track on the floor).
    """
    cmd = ["ffmpeg", "-y"]
    if capture == "webcodecs":
        cmd += ["-f", "h264", "-r", str(fps), "-i", "-"]
    else:
        cmd += ["-f", "image2pipe",
                "-c:v", "png" if capture == "png" else "mjpeg",
                "-framerate", str(fps), "-i", "-"]

    # the pipe already holds only the frames we want, so it is the audio that
    # has to be moved to meet them
    if preview is not None:
        cmd += ["-ss", str(preview[0]), "-t", str(preview[1] - preview[0])]
    cmd += ["-i", str(audio), "-map", "0:v", "-map", "1:a"]

    if capture == "webcodecs":
        # keyframes were placed by the page, at the same interval as below
        cmd += ["-c:v", "copy"]
    else:
        cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf),
                "-pix_fmt", "yuv420p",
                "-x264-params", f"keyint={int(fps * 2)}:min-keyint={int(fps)}"]

    cmd += ["-c:a", "aac", "-b:a", "320k"]
    if capture == "webcodecs":
        # exactly as long as the frames we wrote, which we know precisely
        cmd += ["-t", str(frames / fps)]
    else:
        cmd += ["-shortest"]

    cmd += ["-movflags", "+faststart", str(out)]
    return cmd



#: Installed into the page once, then driven from main(). The page encodes its
#: own H.264 and hands back annex-b bytes, so no frame is ever image-encoded:
#: that step was ~45ms of the ~52ms each frame used to cost, and every byte of
#: it was thrown away again the moment ffmpeg had decoded it.
#:
#: Returns false rather than throwing if this browser cannot do it, so the
#: caller can fall back instead of dying.
ENCODER_JS = """
([W, H, fps, bitrate, first]) => {
  if (typeof VideoEncoder === "undefined") return false;
  const queue = [];
  let failure = null;
  const enc = new VideoEncoder({
    output: (chunk) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      queue.push(b);
    },
    error: (e) => { failure = String(e && e.message ? e.message : e); },
  });
  try {
    enc.configure({
      codec: "avc1.640034",          // High profile, level 5.2 — good to 4K60
      width: W, height: H,
      bitrate, framerate: fps,
      latencyMode: "quality",
      avc: { format: "annexb" },     // ffmpeg reads this straight off the pipe
    });
  } catch (e) {
    return false;
  }

  const keyint = Math.max(1, Math.round(fps * 2));
  window.__mvg = {
    error: () => failure,
    /**
     * Draw and encode a run of frames.
     *
     * Timestamps and keyframes are both counted from `first`, not from the
     * absolute frame index: a --preview starting mid-track still has to
     * produce a stream that begins at zero and opens on a keyframe, or it is
     * not decodable.
     */
    pump: async (start, n) => {
      const canvas = document.getElementById("c");
      for (let k = 0; k < n; k += 1) {
        const i = start + k;
        window.renderFrame(i);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(((i - first) * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        enc.encode(frame, { keyFrame: (i - first) % keyint === 0 });
        frame.close();
        // bounded, or an eight-minute track builds the whole video up in
        // memory before python ever gets a chance to drain it
        if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
    },
    /**
     * Everything encoded so far, as base64 — CDP has no binary channel.
     *
     * Sounds wasteful and is not: encoded H.264 is ~14KB a frame against the
     * ~378KB a quality-100 JPEG screenshot cost, so even after base64 this
     * moves a small fraction of what the old path did.
     */
    drain: async (flush) => {
      if (flush) await enc.flush();
      let len = 0;
      for (const b of queue) len += b.length;
      const all = new Uint8Array(len);
      let o = 0;
      for (const b of queue) { all.set(b, o); o += b.length; }
      queue.length = 0;
      let s = "";
      for (let i = 0; i < len; i += 0x8000)
        s += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
      return btoa(s);
    },
  };
  return true;
}
"""

#: Frames encoded between drains. Large enough that the round-trip is noise,
#: small enough that progress still moves and memory stays flat.
ENCODE_BATCH = 60


#: Builds the grid inside the page rather than in Python, so the whole feature
#: costs no new dependency: the frames are already canvases in there.
SHEET_JS = """
([picks, cols, tw, th, fps]) => {
  const src = document.getElementById("c");
  document.querySelectorAll("#mvg-sheet").forEach((n) => n.remove());
  const sheet = document.createElement("canvas");
  sheet.id = "mvg-sheet";
  sheet.width = cols * tw;
  sheet.height = Math.ceil(picks.length / cols) * th;
  const x = sheet.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, sheet.width, sheet.height);
  picks.forEach((f, n) => {
    window.renderFrame(f);
    const cx = (n % cols) * tw;
    const cy = Math.floor(n / cols) * th;
    x.drawImage(src, cx, cy, tw, th);
    const t = f / fps;
    const label = Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
    x.font = "12px monospace";
    x.fillStyle = "rgba(0,0,0,0.65)";
    x.fillRect(cx + 4, cy + 4, 54, 17);
    x.fillStyle = "#8fe98f";
    x.fillText(label, cx + 9, cy + 17);
  });
  // visualizer.html hides overflow so the render never scrolls; the sheet is
  // wider than the viewport and would be clipped to black without this
  document.documentElement.style.overflow = "visible";
  document.body.style.overflow = "visible";
  document.body.style.margin = "0";
  sheet.style.display = "block";
  document.body.appendChild(sheet);
  return [sheet.width, sheet.height];
}
"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--out", default="visualizer.mp4")
    ap.add_argument("--root", default=str(ROOT),
                    help="directory to serve: visualizer.html, frames.json, artwork")
    ap.add_argument("--artwork", default="artwork.jpg",
                    help="artwork filename inside --root")
    ap.add_argument("--audio", default=None,
                    help="audio file to mux in (default: audio.wav inside --root)")
    ap.add_argument("-w", "--width", type=int, default=None)
    ap.add_argument("-H", "--height", type=int, default=None)
    ap.add_argument("--title", default="")
    ap.add_argument("--artist", default="")
    ap.add_argument("--crf", type=int, default=16)
    ap.add_argument("--preset", default="slow")
    ap.add_argument("--look", default="burn",
                    help="which design to draw: see viz/looks/")
    ap.add_argument("--contact-sheet", metavar="PNG",
                    help="draw a grid of frames spread across the track and stop. "
                         "Judging a look costs seconds instead of a test render, "
                         "and needs no ffmpeg.")
    ap.add_argument("--sheet-frames", type=int, default=12,
                    help="how many frames the contact sheet shows (default 12)")
    ap.add_argument("--capture", default="auto",
                    choices=["auto", "webcodecs", "jpeg", "png"],
                    help="how frames leave the page. 'webcodecs' has the page "
                         "encode its own H.264 and ffmpeg only mux it — about 5x "
                         "faster, because it skips image-encoding every frame "
                         "just to throw it away again. 'auto' (default) uses it "
                         "when the browser has it and says which way it went; "
                         "asking for it by name fails outright if it is missing.")
    ap.add_argument("--bitrate", type=float, default=None, metavar="MBPS",
                    help="target for --capture webcodecs (default: scaled from "
                         "resolution and fps). Has no effect on the image paths, "
                         "which are governed by --crf.")
    ap.add_argument("--png", action="store_true",
                    help="shorthand for --capture png. Lossless frame capture, "
                         "and by far the slowest: PNG encoding inside Chromium "
                         "costs ~270ms a frame.")
    ap.add_argument("--preview", nargs=2, type=float, metavar=("START", "END"),
                    help="render only this second range; 1280x720 unless -w/-H given")
    ap.add_argument("--progress", action="store_true",
                    help="emit machine-readable progress lines for the web UI")
    return ap


def drain(stream, sink) -> None:
    """Keep ffmpeg's last words so a failure says something useful."""
    for raw in iter(stream.readline, b""):
        sink.append(raw.decode("utf-8", "replace").rstrip())
    stream.close()


def main() -> int:
    args = build_parser().parse_args()
    # playwright is slow to import and not needed for --help
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    root = Path(args.root).resolve()
    audio = Path(args.audio).resolve() if args.audio else root / "audio.wav"
    if not (root / "visualizer.html").exists():
        print(f"no visualizer.html in {root}", file=sys.stderr)
        return 2
    if not audio.exists():
        print(f"no audio at {audio}", file=sys.stderr)
        return 2

    # An explicit -w/-H wins; otherwise a preview drops to 720p to stay quick.
    w = args.width or (1280 if args.preview else 1920)
    h = args.height or (720 if args.preview else 1080)

    port = serve(root)
    url = build_url(port, w, h, args.title, args.artist, args.artwork, args.look)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb",
                                           "--disable-lcd-text"])
        page = browser.new_page(viewport={"width": w, "height": h},
                                device_scale_factor=1)
        # surface the page's own complaints, or a missing asset looks like a hang
        page.on("pageerror", lambda e: print(f"page error: {e}", file=sys.stderr))
        page.on("console", lambda m: (
            should_report(m.type, m.text, (m.location or {}).get("url", ""))
            and print(f"console: {m.text}", file=sys.stderr)))
        page.goto(url)
        try:
            page.wait_for_function("window.vizReady === true", timeout=120_000)
        except PlaywrightError as exc:
            browser.close()
            print(f"the visualizer never became ready: {exc}", file=sys.stderr)
            return 3

        meta = page.evaluate("window.meta")
        fps, total = meta["fps"], meta["frames"]

        start, end = 0, total
        if args.preview:
            start = int(args.preview[0] * fps)
            end = min(total, int(args.preview[1] * fps))
        if end <= start:
            browser.close()
            print("nothing to render: the preview range is outside the track",
                  file=sys.stderr)
            return 2

        if args.contact_sheet:
            n = max(1, args.sheet_frames)
            # evenly spaced and offset by half a step, so neither the first nor
            # the last frame -- both often atypical -- stands for the track
            picks = [min(end - 1, start + round((k + 0.5) * (end - start) / n))
                     for k in range(n)]
            cols = min(4, n)
            w_, h_ = page.evaluate(SHEET_JS, [picks, cols, 480, round(480 * h / w), fps])
            # grow the window to the sheet, or the part past the right edge of
            # the render viewport is captured as black
            page.set_viewport_size({"width": int(w_), "height": int(h_)})
            page.locator("#mvg-sheet").screenshot(path=args.contact_sheet)
            browser.close()
            print(f"wrote {args.contact_sheet} ({w_}x{h_}, {n} frames, "
                  f"look '{meta.get('look', args.look)}')")
            return 0

        requested = "png" if args.png else args.capture
        bitrate = (int(args.bitrate * 1e6) if args.bitrate
                   else target_bitrate(w, h, fps, args.crf))
        encoder_ok = False
        if requested in ("auto", "webcodecs"):
            try:
                encoder_ok = bool(page.evaluate(ENCODER_JS,
                                                [w, h, fps, bitrate, start]))
            except PlaywrightError as exc:
                print(f"could not start the page encoder: {exc}", file=sys.stderr)
        try:
            capture = resolve_capture(requested, encoder_ok)
        except CaptureUnavailable as exc:
            browser.close()
            print(str(exc), file=sys.stderr)
            return 6

        shot = ({"type": "png"} if capture == "png"
                else {"type": "jpeg", "quality": 100})
        cmd = ffmpeg_command(out=args.out, fps=fps, audio=audio, capture=capture,
                             crf=args.crf, preset=args.preset, frames=end - start,
                             preview=tuple(args.preview) if args.preview else None)

        detail = (f"{bitrate / 1e6:.0f} Mbps in-page" if capture == "webcodecs"
                  else f"crf {args.crf}")
        print(f"rendering frames {start}-{end} at {w}x{h}, {fps} fps, "
              f"{capture} capture ({detail}), look '{meta.get('look', args.look)}'")
        progress(args.progress, frame=start, start=start, end=end,
                 message=f"Rendering {end - start} frames at {w}x{h}")
        try:
            ff = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE, text=False)
        except FileNotFoundError:
            browser.close()
            print("ffmpeg is not on PATH", file=sys.stderr)
            return 4

        tail = collections.deque(maxlen=40)
        stderr_pump = threading.Thread(target=drain, args=(ff.stderr, tail),
                                       daemon=True)
        stderr_pump.start()

        t0 = time.time()
        broke = False

        #: last 120-frame milestone printed to the terminal, so a batch that
        #: advances 60 at a time reports as often as a per-frame loop does and
        #: no more
        milestone = [0]

        def report(reached: int, every: int) -> None:
            """Progress for the web UI and for whoever is watching the terminal."""
            done = reached - start
            if done <= 0:
                return
            rate = done / max(1e-6, time.time() - t0)
            left = (end - reached) / max(1e-6, rate)
            if done % every == 0 or reached >= end:
                progress(args.progress, frame=reached, start=start, end=end,
                         rate=round(rate, 2), eta=round(left, 1))
            if done // 120 > milestone[0]:
                milestone[0] = done // 120
                print(f"  {done}/{end - start}  {rate:.1f} fps  "
                      f"~{left / 60:.1f} min left")

        def write(payload: bytes) -> bool:
            try:
                ff.stdin.write(payload)
                return True
            except (BrokenPipeError, OSError):
                return False

        try:
            if capture == "webcodecs":
                # the page draws and encodes a batch, then hands back the bytes
                for off in range(start, end, ENCODE_BATCH):
                    n = min(ENCODE_BATCH, end - off)
                    page.evaluate("([s, n]) => window.__mvg.pump(s, n)", [off, n])
                    err = page.evaluate("() => window.__mvg.error()")
                    if err:
                        print(f"the page encoder failed: {err}", file=sys.stderr)
                        broke = True
                        break
                    if not write(base64.b64decode(page.evaluate(
                            "() => window.__mvg.drain(false)"))):
                        broke = True
                        break
                    report(off + n, ENCODE_BATCH)
                if not broke:
                    # whatever the encoder is still holding once input stops
                    broke = not write(base64.b64decode(page.evaluate(
                        "() => window.__mvg.drain(true)")))
            else:
                for i in range(start, end):
                    page.evaluate("i => window.renderFrame(i)", i)
                    if not write(page.screenshot(**shot)):
                        broke = True
                        break
                    report(i + 1, REPORT_EVERY)
        finally:
            try:
                ff.stdin.close()
            except OSError:
                pass
            ff.wait()
            stderr_pump.join(timeout=2)
            browser.close()

    if ff.returncode != 0 or broke:
        for line in tail:
            print(line, file=sys.stderr)
        print(f"ffmpeg exited with {ff.returncode}", file=sys.stderr)
        return 5

    elapsed = (time.time() - t0) / 60
    print(f"wrote {args.out} in {elapsed:.1f} min")
    progress(args.progress, frame=end, start=start, end=end, message="Encoded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
