import type { RefObject } from "react";

import { formatClock } from "../format";

interface Props {
  metersRef: RefObject<HTMLCanvasElement | null>;
  waveRef: RefObject<HTMLCanvasElement | null>;
  playing: boolean;
  now: number;
  duration: number | null;
  hasAudio: boolean;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
}

/** The monitor: five levels and a scrub strip.
 *
 * This plays the file in the browser so the look can be judged before an hour
 * of rendering. It is not the render — the mp4 comes from the frame table
 * analyse.py writes, and nothing here feeds into it. */
export function Transport({
  metersRef,
  waveRef,
  playing,
  now,
  duration,
  hasAudio,
  onToggle,
  onSeek,
}: Props) {
  const seekAt = (clientX: number, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    if (box.width > 0) onSeek((clientX - box.left) / box.width);
  };

  return (
    <>
      <div className="meters">
        <span className="meters__label">Signal</span>
        <canvas ref={metersRef} />
      </div>

      <div className="transport">
        <button
          type="button"
          className={playing ? "transport__play transport__play--on" : "transport__play"}
          disabled={!hasAudio}
          aria-label={playing ? "Pause" : "Play"}
          onClick={onToggle}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="transport__clock">{formatClock(now)}</span>
        <div
          className="transport__wave"
          role="slider"
          tabIndex={hasAudio ? 0 : -1}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration ?? 0)}
          aria-valuenow={Math.round(now)}
          aria-valuetext={formatClock(now)}
          onClick={(e) => seekAt(e.clientX, e.currentTarget)}
          onKeyDown={(e) => {
            if (!duration) return;
            if (e.key === "ArrowRight") onSeek((now + 5) / duration);
            else if (e.key === "ArrowLeft") onSeek((now - 5) / duration);
            else return;
            e.preventDefault();
          }}
        >
          <canvas ref={waveRef} />
        </div>
        <span className="transport__clock transport__clock--dim">
          {duration ? formatClock(duration) : "--:--"}
        </span>
      </div>
    </>
  );
}
