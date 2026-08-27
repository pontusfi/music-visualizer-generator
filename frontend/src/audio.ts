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
