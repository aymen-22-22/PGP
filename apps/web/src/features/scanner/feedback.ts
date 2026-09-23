/**
 * Sound and vibration for each scan.
 *
 * This is the single biggest thing that makes scanning feel fast. With audible
 * confirmation the operator keeps their eyes on the phones and their hands
 * moving; without it they glance at the screen after every unit, which is what
 * actually costs the time.
 */
type Tone = 'accepted' | 'duplicate' | 'rejected';

const TONES: Record<Tone, { hz: number; ms: number; gain: number }> = {
  accepted: { hz: 1760, ms: 70, gain: 0.05 },
  duplicate: { hz: 900, ms: 110, gain: 0.05 },
  rejected: { hz: 320, ms: 260, gain: 0.07 },
};

const HAPTICS: Record<Tone, number | number[]> = {
  accepted: 18,
  duplicate: [14, 50, 14],
  rejected: [60, 50, 60],
};

let context: AudioContext | null = null;
let muted = false;

/** Browsers only allow audio after a gesture, so prime it on the first tap. */
export function primeScanFeedback(): void {
  if (context) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) context = new Ctor();
    void context?.resume();
  } catch {
    context = null; // no audio available; vibration still works
  }
}

export function setScanFeedbackMuted(value: boolean): void {
  muted = value;
}

export function isScanFeedbackMuted(): boolean {
  return muted;
}

export function scanFeedback(tone: Tone): void {
  if (!muted) {
    try {
      primeScanFeedback();
      if (context) {
        const { hz, ms, gain } = TONES[tone];
        // A good scan is a rising two-note chime; anything else is one flat tone.
        const notes = tone === 'accepted' ? [hz * 0.66, hz] : [hz];
        notes.forEach((freq, i) => {
          const start = context!.currentTime + i * (ms / 1000);
          const osc = context!.createOscillator();
          const vol = context!.createGain();
          osc.type = tone === 'accepted' ? 'sine' : 'square';
          osc.frequency.value = freq;
          vol.gain.setValueAtTime(gain * (tone === 'accepted' ? 2 : 1), start);
          vol.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
          osc.connect(vol).connect(context!.destination);
          osc.start(start);
          osc.stop(start + ms / 1000);
        });
      }
    } catch {
      /* a missing beep must never interrupt a scan */
    }
  }
  try {
    navigator.vibrate?.(HAPTICS[tone]);
  } catch {
    /* not supported */
  }
}
