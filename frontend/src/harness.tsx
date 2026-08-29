import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { Player } from "./components/Player";
import { DEFAULT_GAIN, type Gain } from "./player/controls";
import "./styles.css";

function Harness() {
  const [gain, setGain] = useState<Gain>(DEFAULT_GAIN);
  const [tall, setTall] = useState(false);
  const w = tall ? 720 : 1280;
  const h = tall ? 1280 : 720;

  return (
    <div className="app">
      <div className="stage-col" style={{ height: "100vh" }}>
        <div className="stage">
          <div className="stage__bar">
            <div className="stage__bar-left">
              <span className="stage__label">Result</span>
              <span className="stage__pipe">|</span>
              <span className="stage__tabs">
                <button
                  className={tall ? "stage__tab" : "stage__tab stage__tab--on"}
                  onClick={() => setTall(false)}
                >
                  16:9
                </button>
                <button
                  className={tall ? "stage__tab stage__tab--on" : "stage__tab"}
                  onClick={() => setTall(true)}
                >
                  9:16
                </button>
              </span>
              <span className="mono-dim">
                {w}×{h} · 30 fps · crf 28 · medium
              </span>
            </div>
            <div className="stage__bar-right">
              <span className="lamp lamp--live">
                <span className="lamp__dot" />
                Settled in 1:12
              </span>
            </div>
          </div>
          <div className="stage__frame">
            <div className="stage__canvas" style={{ aspectRatio: `${w} / ${h}` }}>
              <Player
                key={tall ? "tall" : "wide"}
                src={tall ? "/sample-tall.mp4" : "/sample-wide.mp4"}
                downloadUrl={tall ? "/sample-tall.mp4" : "/sample-wide.mp4"}
                gain={gain}
                onGain={setGain}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
