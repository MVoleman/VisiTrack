/**
 * Small synthesised UI sounds (no audio files). The AudioContext must be
 * created from a user gesture, which the kiosk's "Starta" button provides.
 */
let context: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
}

function tone(frequency: number, start: number, duration: number, peak = 0.18) {
  if (!context) return;
  const t0 = context.currentTime + start;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(context.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Bright, rising two-note chime. */
export function playSuccess() {
  tone(880, 0, 0.18); // A5
  tone(1318.5, 0.11, 0.32); // E6
}

/** Soft single note for "already registered". */
export function playNotice() {
  tone(660, 0, 0.28, 0.12);
}

/** Low double tone for errors. */
export function playError() {
  tone(220, 0, 0.16, 0.16);
  tone(196, 0.2, 0.24, 0.16);
}
