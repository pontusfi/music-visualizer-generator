/** How many columns the transport strip draws. */
export const PEAK_BUCKETS = 900;

/** Reduce a channel of PCM to one peak per column.
 *
 * Every sample is read rather than strided: a snare is often a single sample
 * taller than its neighbours, and a strided scan walks straight past it and
 * draws a flat wave for a busy track.
 */
export function computePeaks(channel: Float32Array, buckets: number): Float32Array {
  if (!Number.isFinite(buckets) || buckets <= 0) return new Float32Array(0);
  const out = new Float32Array(buckets);
  if (channel.length === 0) return out;

  for (let i = 0; i < buckets; i += 1) {
    const from = Math.floor((i * channel.length) / buckets);
    const to = Math.floor(((i + 1) * channel.length) / buckets);
    let peak = 0;
    for (let j = from; j < to; j += 1) {
      const v = Math.abs(channel[j]);
      // a NaN loses every comparison, so it simply never becomes the peak
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

/** Decoding a master into PCM costs roughly ten times its file size in memory.
 *  Past this, the waveform is not worth the tab. */
export const MAX_DECODE_BYTES = 160 * 1024 * 1024;

/** Best-effort waveform for the transport. Resolves to null whenever the file
 *  is too big to decode, the codec is one the browser will not open, or there
 *  is no AudioContext at all — the transport draws a flat line and moves on. */
export async function loadPeaks(
  file: File,
  buckets = PEAK_BUCKETS,
): Promise<{ peaks: Float32Array; duration: number } | null> {
  if (file.size > MAX_DECODE_BYTES) return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  let context: AudioContext | null = null;
  try {
    const bytes = await file.arrayBuffer();
    context = new Ctor();
    const buffer = await context.decodeAudioData(bytes);
    return {
      peaks: computePeaks(buffer.getChannelData(0), buckets),
      duration: buffer.duration,
    };
  } catch {
    return null;
  } finally {
    context?.close().catch(() => {});
  }
}
