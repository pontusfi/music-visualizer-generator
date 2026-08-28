import { formatClock } from "../format";
import {
  PRESETS,
  QUALITIES,
  RESOLUTIONS,
  type RenderSettings,
} from "../settings";

interface Props {
  settings: RenderSettings;
  duration: number | null;
  disabled: boolean;
  onChange: (patch: Partial<RenderSettings>) => void;
}

export function AdvancedPanel({ settings, duration, disabled, onChange }: Props) {
  const max = Math.floor(duration ?? 600);

  return (
    <section className="rail__block rail__block--sunk">
      <div className="micro">Resolution</div>
      <div className="grid grid--4">
        {RESOLUTIONS.map((r) => (
          <button
            key={r.label}
            type="button"
            className={settings.height === r.height ? "cell cell--on" : "cell"}
            disabled={disabled}
            aria-pressed={settings.height === r.height}
            onClick={() => onChange({ width: r.width, height: r.height })}
          >
            {r.label}
            <em>{r.note}</em>
          </button>
        ))}
      </div>

      <div className="grid grid--2 grid--gap">
        <div>
          <div className="micro">Frame rate</div>
          <div className="grid grid--2">
            {[30, 60].map((fps) => (
              <button
                key={fps}
                type="button"
                className={settings.fps === fps ? "cell cell--on" : "cell"}
                disabled={disabled}
                aria-pressed={settings.fps === fps}
                onClick={() => onChange({ fps })}
              >
                {fps} fps
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="micro">x264 preset</div>
          <select
            className="pick"
            value={settings.preset}
            disabled={disabled}
            aria-label="x264 preset"
            onChange={(e) => onChange({ preset: e.target.value })}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="micro">Quality</div>
      <div className="grid grid--4">
        {QUALITIES.map((q) => (
          <button
            key={q.label}
            type="button"
            className={settings.crf === q.crf ? "cell cell--on" : "cell"}
            disabled={disabled}
            aria-pressed={settings.crf === q.crf}
            onClick={() => onChange({ crf: q.crf })}
          >
            {q.label}
            <em>{q.note || `crf ${q.crf}`}</em>
          </button>
        ))}
      </div>

      <hr className="rule" />
      <div className="micro">Analysis</div>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.hpss}
          disabled={disabled}
          onChange={(e) => onChange({ hpss: e.target.checked })}
        />
        <span>
          <span className="check__label">Split harmonic from percussive</span>
          <span className="check__note">
            Keeps the kick off the guitar fundamental. Off is much faster, and much
            worse on dense material.
          </span>
        </span>
      </label>

      <label className="slider">
        <span className="slider__head">
          <span>Spectrum bands</span>
          <span className="slider__value">{settings.bands}</span>
        </span>
        <input
          type="range"
          min={8}
          max={48}
          value={settings.bands}
          disabled={disabled}
          onChange={(e) => onChange({ bands: Number(e.target.value) })}
        />
      </label>

      <hr className="rule" />

      <label className="check">
        <input
          type="checkbox"
          checked={settings.previewEnabled}
          disabled={disabled}
          onChange={(e) => onChange({ previewEnabled: e.target.checked })}
        />
        <span>
          <span className="check__label">Render a test window only</span>
          <span className="check__note">
            A short excerpt, to judge the look before committing an hour.
          </span>
        </span>
      </label>

      {settings.previewEnabled && (
        <div className="grid grid--2 grid--gap">
          <label className="slider">
            <span className="slider__head">
              <span>From</span>
              <span className="slider__value">{formatClock(settings.previewStart)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, max - 1)}
              value={Math.min(settings.previewStart, max)}
              disabled={disabled}
              onChange={(e) => {
                const start = Number(e.target.value);
                onChange({
                  previewStart: start,
                  previewEnd: Math.max(start + 1, settings.previewEnd),
                });
              }}
            />
          </label>
          <label className="slider">
            <span className="slider__head">
              <span>To</span>
              <span className="slider__value">{formatClock(settings.previewEnd)}</span>
            </span>
            <input
              type="range"
              min={1}
              max={Math.max(2, max)}
              value={Math.min(settings.previewEnd, max)}
              disabled={disabled}
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
    </section>
  );
}
