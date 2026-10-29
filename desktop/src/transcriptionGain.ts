// Normalize the upload copy, leaving the retained/playback WAV untouched.
// A peak ceiling avoids clipping and the gain cap bounds amplification of noise.
export function amplifyQuietWav(audio: Uint8Array): Uint8Array {
  if (audio.length <= 44 || (audio.length - 44) % 2 !== 0) return audio;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let sumSquares = 0;
  let peak = 0;
  const count = (audio.length - 44) / 2;
  for (let offset = 44; offset < audio.length; offset += 2) {
    const sample = view.getInt16(offset, true);
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak === 0) return audio;
  const rms = Math.sqrt(sumSquares / count);
  const gain = Math.min(256, (0.05 * 32768) / rms, (0.95 * 32767) / peak);
  if (gain <= 1) return audio;
  const result = audio.slice();
  const output = new DataView(result.buffer, result.byteOffset, result.byteLength);
  for (let offset = 44; offset < result.length; offset += 2) {
    output.setInt16(offset, Math.round(view.getInt16(offset, true) * gain), true);
  }
  return result;
}
