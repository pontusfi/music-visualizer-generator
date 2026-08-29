// @vitest-environment jsdom
/** The hook's wiring, not its maths — controls.test.ts owns the pure rules.
 *
 * What is worth a DOM here is the auto-hide: it is the one behaviour driven by
 * a timer racing the element's own event stream, and a unit test of
 * chromeVisible cannot see that race. */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHROME_IDLE_MS, DEFAULT_GAIN, type Gain } from "./controls";
import { type Player, usePlayer } from "./usePlayer";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let latest: Player;

function Probe() {
  const [gain, setGain] = useState<Gain>(DEFAULT_GAIN);
  latest = usePlayer({ gain, onGain: setGain });
  return <video ref={latest.videoRef} />;
}

let container: HTMLDivElement;
let root: Root;
let clock = 0;

/** The element jsdom gives us reports no duration and no time; the player reads
 *  both off it every timeupdate, so they have to answer something real. */
function stubMedia(el: HTMLVideoElement) {
  Object.defineProperty(el, "currentTime", {
    configurable: true,
    get: () => clock,
    set: (v: number) => {
      clock = v;
    },
  });
  Object.defineProperty(el, "duration", { configurable: true, get: () => 120 });
}

/** Playback, reported the way a real element reports it: about four times a
 *  second, each tick landing its own render before the next one arrives.
 *
 * The per-tick act() is the whole point. Batch the ticks into one and React
 * renders once at the end, the effects re-run once, and a timer that is in
 * fact being restarted on every tick looks like it fires on time. */
function playFor(el: HTMLVideoElement, ms: number) {
  const step = 250;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    act(() => {
      clock += step / 1000;
      el.dispatchEvent(new Event("timeupdate"));
    });
    act(() => {
      vi.advanceTimersByTime(step);
    });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // the bar's rAF loop is not what these tests are about, and a self-
  // rescheduling frame would spin against the fake clock
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  clock = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  stubMedia(latest.videoRef.current!);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePlayer auto-hide", () => {
  it("keeps the chrome up while the video is paused", () => {
    act(() => {
      latest.wake();
    });
    playFor(latest.videoRef.current!, CHROME_IDLE_MS * 2);
    expect(latest.visible).toBe(true);
  });

  it("hides the chrome once the pointer goes quiet, even though playback keeps reporting time", () => {
    const el = latest.videoRef.current!;
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    expect(latest.playing).toBe(true);

    act(() => {
      latest.wake();
    });
    expect(latest.visible).toBe(true);

    // the pointer never moves again; only the element talks
    playFor(el, CHROME_IDLE_MS * 2);

    expect(latest.visible).toBe(false);
  });

  it("brings the chrome back when the pointer moves again", () => {
    const el = latest.videoRef.current!;
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    act(() => {
      latest.wake();
    });
    playFor(el, CHROME_IDLE_MS * 2);
    expect(latest.visible).toBe(false);

    act(() => {
      latest.wake();
    });
    expect(latest.visible).toBe(true);
  });
});
