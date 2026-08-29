import { BACKGROUNDS, type RenderSettings } from "../settings";

interface Props {
  settings: RenderSettings;
  disabled: boolean;
  onChange: (patch: Partial<RenderSettings>) => void;
}

/** The field a look draws on. Orthogonal to the look itself — every look
 *  opens with `bg.draw(ctx, s, a)` in place of its own flat fill, so any of
 *  the five works under any look. */
export function BackgroundPanel({ settings, disabled, onChange }: Props) {
  const current = BACKGROUNDS.find((b) => b.id === settings.background) ?? BACKGROUNDS[0];

  return (
    <section className="rail__block">
      <div className="rail__head">
        <h2 className="rail__title">04 · Background</h2>
        <span className="rail__status">{current.name}</span>
      </div>

      <div className="looks">
        {BACKGROUNDS.map((bg) => {
          const on = bg.id === settings.background;
          return (
            <button
              key={bg.id}
              type="button"
              className={on ? "look look--on" : "look"}
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange({ background: bg.id })}
            >
              <span className={`bg__glyph bg__glyph--${bg.id}`} aria-hidden="true" />
              <span className="look__body">
                <span className="look__name">{bg.name}</span>
                <span className="look__note">{bg.note}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
