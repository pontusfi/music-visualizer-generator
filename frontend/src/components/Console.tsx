import { useEffect, useRef } from "react";

import { logTone } from "../format";

interface Props {
  lines: string[];
  streaming: boolean;
}

export function Console({ lines, streaming }: Props) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <section className="console" aria-label="Render log">
      <div className="console__head">
        <span>Console</span>
        <span>
          {streaming ? "Streaming · " : ""}
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div className="console__body" ref={body}>
        {lines.map((line, i) => (
          <div key={`${i}-${line}`} className={`console__line console__line--${logTone(line)}`}>
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}
