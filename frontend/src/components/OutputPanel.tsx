import { estimateRenderMinutes, formatApprox } from "../format";
import {
  applyPreset,
  matchPreset,
  OUTPUT_PRESETS,
  type RenderSettings,
} from "../settings";

interface Props {
  settings: RenderSettings;
  duration: number | null;
  disabled: boolean;
  advancedOpen: boolean;
  onSettings: (next: RenderSettings) => void;
  onToggleAdvanced: () => void;
}

/** Three named renders. Everything finer lives behind Advanced, because the
 *  answer is nearly always "the 1080 one". */
export function OutputPanel({
  settings,
  duration,
  disabled,
  advancedOpen,
  onSettings,
  onToggleAdvanced,
}: Props) {
  const current = matchPreset(settings);
  const chosen = OUTPUT_PRESETS.find((p) => p.id === current);

  return (
    <section className="rail__block">
      <div className="rail__head">
        <h2 className="rail__title">05 · Output</h2>
        <span className="rail__status">
          {chosen ? chosen.name : "Custom"}
          {settings.aspects.length > 1 ? " · 16:9 + 9:16" : ""}
        </span>
      </div>

      <div className="presets">
        {OUTPUT_PRESETS.map((preset) => {
          const on = preset.id === current;
          const next = applyPreset(settings, preset);
          const minutes =
            duration == null
              ? null
              : estimateRenderMinutes(
                  duration,
                  next.fps,
                  next.resolution,
                  next.previewEnabled
                    ? { start: next.previewStart, end: next.previewEnd }
                    : null,
                  next.aspects.length,
                );
          return (
            <button
              key={preset.id}
              type="button"
              className={on ? "preset preset--on" : "preset"}
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onSettings(next)}
            >
              <span className="preset__mark" aria-hidden="true" />
              <span className="preset__body">
                <span className="preset__name">{preset.name}</span>
                <span className="preset__spec">{preset.spec}</span>
              </span>
              <span className="preset__time">
                {minutes == null ? "—" : formatApprox(minutes)}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="disclose"
        aria-expanded={advancedOpen}
        onClick={onToggleAdvanced}
      >
        <span
          className={advancedOpen ? "disclose__arrow disclose__arrow--open" : "disclose__arrow"}
          aria-hidden="true"
        />
        {advancedOpen ? "Hide advanced" : "Advanced · aspect, resolution, quality, analysis"}
      </button>
    </section>
  );
}
