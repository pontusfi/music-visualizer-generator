/** Read a file's duration without decoding it.
 *
 * The <audio> element is the cheap way to do this, but it is also the one thing
 * on the page another extension is likely to have hooked — a capture extension
 * that swallows the metadata event leaves the UI reading "reading…" forever.
 * So this always answers, even if the answer is "I don't know".
 */
export function probeDuration(
  file: File,
  timeoutMs = 5000,
): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let url: string;
    let probe: HTMLAudioElement;
    try {
      url = URL.createObjectURL(file);
      probe = new Audio();
    } catch {
      // no object URLs, no media element: answer anyway
      resolve(null);
      return;
    }

    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      probe.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const timer = window.setTimeout(() => done(null), timeoutMs);
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    probe.onerror = () => done(null);

    probe.preload = "metadata";
    probe.src = url;
  });
}

/** Merge two answers about how long a track is.
 *
 * Two sources race: the metadata probe above, and the waveform decode. Either
 * can come back empty, and the probe's five-second timeout usually lands last
 * — so a plain assignment lets a null wipe out a length already found. First
 * real answer wins, and nothing later takes it away.
 */
export function bestDuration(
  current: number | null,
  candidate: number | null | undefined,
): number | null {
  const usable = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
  if (usable(current)) return current;
  return usable(candidate) ? candidate : null;
}
