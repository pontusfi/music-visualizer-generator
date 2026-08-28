#!/usr/bin/env python3
"""
Drive visualizer.html frame by frame in headless Chromium and pipe the PNGs
straight into ffmpeg. Nothing touches the disk between the two, so an
eight-minute 60 fps render doesn't leave you with 28,800 files.

    python render.py --preview 30 45          # 15s test at 1280x720
    python render.py -w 3840 -H 2160 -o out.mp4

--root points the local server at a directory other than this one, which is how
the web UI keeps concurrent jobs from seeing each other's frames.json.

Needs: pip install playwright && playwright install chromium
"""

import argparse
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
    ap.add_argument("--png", action="store_true",
                    help="lossless frame capture. ~6x slower: PNG encoding inside "
                         "Chromium is the single biggest cost in this pipeline, and "
                         "since the output is yuv420p x264 anyway, quality-100 JPEG "
                         "capture is visually indistinguishable in the final file.")
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

        fmt = "png" if args.png else "jpeg"
        shot = ({"type": "png"} if args.png
                else {"type": "jpeg", "quality": 100})

        cmd = ["ffmpeg", "-y",
               "-f", "image2pipe", "-c:v", "png" if args.png else "mjpeg",
               "-framerate", str(fps), "-i", "-"]
        if args.preview:
            cmd += ["-ss", str(args.preview[0]), "-t",
                    str(args.preview[1] - args.preview[0])]
        cmd += ["-i", str(audio),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
                "-pix_fmt", "yuv420p",
                "-x264-params", f"keyint={fps * 2}:min-keyint={fps}",
                "-c:a", "aac", "-b:a", "320k",
                "-shortest", "-movflags", "+faststart", args.out]

        print(f"rendering frames {start}-{end} at {w}x{h}, {fps} fps, "
              f"{fmt} capture, look '{meta.get('look', args.look)}'")
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
        try:
            for i in range(start, end):
                page.evaluate("i => window.renderFrame(i)", i)
                try:
                    ff.stdin.write(page.screenshot(**shot))
                except (BrokenPipeError, OSError):
                    broke = True
                    break
                done = i - start + 1
                if done % REPORT_EVERY == 0:
                    rate = done / max(1e-6, time.time() - t0)
                    left = (end - i - 1) / rate
                    progress(args.progress, frame=i + 1, start=start, end=end,
                             rate=round(rate, 2), eta=round(left, 1))
                if done % 120 == 0:
                    rate = done / (time.time() - t0)
                    print(f"  {done}/{end - start}  {rate:.1f} fps  "
                          f"~{(end - i - 1) / rate / 60:.1f} min left")
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
