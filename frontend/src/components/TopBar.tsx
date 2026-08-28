import type { Health } from "../types";

interface Props {
  health: Health | null;
}

/** The status strip. It answers one question before anything else on the page:
 *  is there an engine behind this, and does it have what it needs. */
export function TopBar({ health }: Props) {
  const online = health !== null;
  const tools = Object.entries(health?.tools ?? {});

  return (
    <header className="bar">
      <div className="bar__brand">
        <span className="mark" aria-hidden="true" />
        <span className="bar__name">Visualizer Studio</span>
        <span className="bar__tag">MVG</span>
      </div>

      <div className="bar__strap">
        <span>Deterministic render · frame index is the only clock</span>
      </div>

      <div className="bar__engine">
        <span className="mono-dim">Engine</span>
        <span className={online ? "lamp lamp--ok" : "lamp lamp--bad"}>
          <span className="lamp__dot" />
          {online ? "Online" : "No answer"}
        </span>
        {tools.length > 0 && (
          <>
            <span className="bar__pipe" aria-hidden="true">
              |
            </span>
            <span className="bar__tools">
              {tools.map(([name, ok]) => (
                <span key={name} className={ok ? "tool" : "tool tool--missing"}>
                  {name}
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
