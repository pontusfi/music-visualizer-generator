import { LOOKS, type RenderSettings } from "../settings";

interface Props {
  settings: RenderSettings;
  disabled: boolean;
  onChange: (patch: Partial<RenderSettings>) => void;
}

/** Which design the renderer draws. Orthogonal to the output preset — this is
 *  what the video looks like, not how big or how compressed it is. */
export function LookPanel({ settings, disabled, onChange }: Props) {
  const current = LOOKS.find((l) => l.id === settings.look) ?? LOOKS[0];

  return (
    <section className="rail__block">
      <div className="rail__head">
        <h2 className="rail__title">03 · Look</h2>
        <span className="rail__status">{current.name}</span>
      </div>

      <div className="looks">
        {LOOKS.map((look) => {
          const on = look.id === settings.look;
          return (
            <button
              key={look.id}
              type="button"
              className={on ? "look look--on" : "look"}
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange({ look: look.id })}
            >
              <span className={`look__glyph look__glyph--${look.id}`} aria-hidden="true" />
              <span className="look__body">
                <span className="look__name">{look.name}</span>
                <span className="look__note">{look.note}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
