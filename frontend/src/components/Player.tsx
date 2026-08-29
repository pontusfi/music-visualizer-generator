import type React from "react";
import { useState } from "react";

import { formatClock } from "../format";
import {
  fractionAt,
  type Gain,
  progressFraction,
  seekTime,
  setVolume,
  toggleMute,
  volumeLevel,
} from "../player/controls";
import { usePlayer } from "../player/usePlayer";

interface Props {
  src: string;
  downloadUrl: string;
  gain: Gain;
  onGain: (next: Gain) => void;
  onPlay?: () => void;
}

/** The result player.
 *
 * Native controls are off: this is the one place stock browser UI used to
 * show through, and it took none of its colour from the cover. The strip is
 * built from the same parts as the source transport below the stage — the
 * same 34px keys, the same mono clocks, the same accent — and it sits inside
 * the frame because the stage box is cut to the video's ratio and cannot give
 * up any height. Covering picture is the price, so it leaves when idle. */
export function Player({ src, downloadUrl, gain, onGain, onPlay }: Props) {
  const player = usePlayer({ gain, onGain, onPlay });
  const [hover, setHover] = useState<number | null>(null);

  const { duration, now } = player;
  const played = progressFraction(now, duration);
  const level = volumeLevel(gain);
  const muted = gain.muted || gain.volume === 0;

  const hoverAt = (e: React.PointerEvent<HTMLElement>) =>
    setHover(fractionAt(e.clientX, e.currentTarget.getBoundingClientRect()));

  return (
    <div
      ref={player.rootRef}
      className={player.visible ? "player" : "player player--idle"}
      tabIndex={-1}
      onPointerMove={player.wake}
      onPointerLeave={() => {
        player.leave();
        setHover(null);
      }}
      onFocus={() => player.setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          player.setFocusWithin(false);
        }
      }}
      onKeyDown={player.handleKey}
    >
      <video
        ref={player.videoRef}
        className="player__video"
        src={src}
        autoPlay
        playsInline
        onClick={player.toggle}
      />

      <div
        className={
          player.visible ? "player__chrome" : "player__chrome player__chrome--off"
        }
        role="group"
        aria-label="Player controls"
      >
        <div
          className={player.scrubbing ? "player__scrub player__scrub--on" : "player__scrub"}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(Number.isFinite(duration) ? duration : 0)}
          aria-valuenow={Math.round(now)}
          aria-valuetext={formatClock(now)}
          onPointerDown={player.beginScrub}
          onPointerMove={(e) => {
            hoverAt(e);
            player.moveScrub(e);
          }}
          onPointerUp={player.endScrub}
          onLostPointerCapture={player.endScrub}
          onPointerLeave={() => setHover(null)}
        >
          <div className="player__rail">
            <div
              className="player__buffered"
              style={{ width: `${player.buffered * 100}%` }}
            />
            <div
              ref={player.playedRef}
              className="player__played"
              style={{ width: `${played * 100}%` }}
            />
          </div>
          <div
            ref={player.headRef}
            className="player__head"
            style={{ left: `${played * 100}%` }}
          />
          {hover !== null && !player.scrubbing && (
            <>
              <div className="player__ghost" style={{ left: `${hover * 100}%` }} />
              <div className="player__tip" style={{ left: `${hover * 100}%` }}>
                {formatClock(seekTime(hover, duration))}
              </div>
            </>
          )}
        </div>

        <div className="player__row">
          <button
            type="button"
            className={
              player.playing ? "player__key player__key--on" : "player__key"
            }
            aria-label={player.playing ? "Pause" : "Play"}
            onClick={player.toggle}
          >
            {player.playing ? "❚❚" : "▶"}
          </button>

          <span className="player__clock">{formatClock(now)}</span>
          <span className="player__pipe" aria-hidden="true">
            /
          </span>
          <span className="player__clock player__clock--dim">
            {formatClock(duration)}
          </span>

          <span className="player__spacer" />

          <div className="player__volume">
            <button
              type="button"
              className="player__key"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => onGain(toggleMute(gain))}
            >
              <span
                className={
                  muted ? "player__glyph player__glyph--mute" : "player__glyph"
                }
                aria-hidden="true"
              >
                {[1, 2, 3].map((rung) => (
                  <span
                    key={rung}
                    className={
                      level >= rung ? "player__rung player__rung--on" : "player__rung"
                    }
                  />
                ))}
              </span>
            </button>
            <input
              className="player__gain"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={gain.muted ? 0 : gain.volume}
              aria-label="Volume"
              onChange={(e) => onGain(setVolume(gain, Number(e.target.value)))}
            />
          </div>

          <button
            type="button"
            className="player__key"
            aria-label={player.fullscreen ? "Exit full screen" : "Full screen"}
            aria-pressed={player.fullscreen}
            onClick={player.toggleFullscreen}
          >
            <span
              className={
                player.fullscreen
                  ? "player__glyph player__glyph--full player__glyph--full-exit"
                  : "player__glyph player__glyph--full"
              }
              aria-hidden="true"
            />
          </button>

          <a
            className="player__key"
            href={downloadUrl}
            download
            aria-label="Download mp4"
          >
            <span className="player__glyph player__glyph--down" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
