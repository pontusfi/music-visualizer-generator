import { useState } from "react";

import { formatClock } from "../format";
import { PRESETS, QUALITIES, RESOLUTIONS, type RenderSettings } from "../settings";

interface Props {
  settings: RenderSettings;
  onChange: (patch: Partial<RenderSettings>) => void;
  duration: number | null;
  disabled: boolean;
}

export function SettingsPanel({ settings, onChange, duration, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const max = duration ?? 600;

  return (
    <fieldset className="panel" disabled={disabled}>
      <div className="row">
        <label className="field">
          <span>Artist</span>
          <input
            value={settings.artist}
            maxLength={120}
            placeholder="OLD NIGHT"
            onChange={(e) => onChange({ artist: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Track</span>
          <input
            value={settings.title}
            maxLength={120}
            placeholder="Ashes In The Wind"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
      </div>

      <div className="row">
        <div className="field">
          <span>Resolution</span>
          <div className="choices">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.label}
                type="button"
                className={settings.height === r.height ? "chip chip--on" : "chip"}
                onClick={() => onChange({ width: r.width, height: r.height })}
              >
                {r.label}
                <em>{r.note}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="field field--narrow">
          <span>Frame rate</span>
          <div className="choices">
            {[30, 60].map((fps) => (
              <button
                key={fps}
                type="button"
                className={settings.fps === fps ? "chip chip--on" : "chip"}
                onClick={() => onChange({ fps })}
              >
                {fps}
                <em>fps</em>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <span>Quality</span>
          <div className="choices">
            {QUALITIES.map((q) => (
              <button
                key={q.label}
                type="button"
                className={settings.crf === q.crf ? "chip chip--on" : "chip"}
                onClick={() => onChange({ crf: q.crf })}
              >
                {q.label}
                <em>{q.note || `crf ${q.crf}`}</em>
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.previewEnabled}
          onChange={(e) => onChange({ previewEnabled: e.target.checked })}
        />
        <span>
          Render a short test instead
          <em>a 15-second window, to judge the look before committing an hour</em>
        </span>
      </label>

      {settings.previewEnabled && (
        <div className="row row--tight">
          <label className="field field--narrow">
            <span>From {formatClock(settings.previewStart)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(max) - 1)}
              value={Math.min(settings.previewStart, max)}
              onChange={(e) => {
                const start = Number(e.target.value);
                onChange({
                  previewStart: start,
                  previewEnd: Math.max(start + 1, settings.previewEnd),
                });
              }}
            />
          </label>
          <label className="field field--narrow">
            <span>To {formatClock(settings.previewEnd)}</span>
            <input
              type="range"
              min={1}
              max={Math.max(2, Math.ceil(max))}
              value={Math.min(settings.previewEnd, max)}
              onChange={(e) => {
                const end = Number(e.target.value);
                onChange({
                  previewEnd: end,
                  previewStart: Math.min(end - 1, settings.previewStart),
                });
              }}
            />
          </label>
        </div>
      )}

      <button type="button" className="link link--wide" onClick={() => setOpen(!open)}>
        {open ? "hide" : "show"} analysis settings
      </button>

      {open && (
        <div className="advanced">
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.hpss}
              onChange={(e) => onChange({ hpss: e.target.checked })}
            />
            <span>
              Split harmonic from percussive
              <em>
                keeps the kick off the guitar fundamental. Turning it off is much
                faster and much worse on dense material
              </em>
            </span>
          </label>
          <div className="row row--tight">
            <label className="field field--narrow">
              <span>Spectrum bands · {settings.bands}</span>
              <input
                type="range"
                min={8}
                max={48}
                value={settings.bands}
                onChange={(e) => onChange({ bands: Number(e.target.value) })}
              />
            </label>
            <label className="field field--narrow">
              <span>x264 preset</span>
              <select
                value={settings.preset}
                onChange={(e) => onChange({ preset: e.target.value })}
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </fieldset>
  );
}
