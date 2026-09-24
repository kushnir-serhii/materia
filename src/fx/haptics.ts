// Adapter over navigator.vibrate — a no-op where unsupported (desktop
// browsers, iOS Safari). This is the ONLY place that calls navigator.vibrate;
// at M2 (2.2) this gets swapped for @capacitor/haptics behind the same
// vibrate() signature.

const MIN_GAP_MS = 60;

let enabled = true;
let lastVibrateAt = 0;

export function setVibrationEnabled(on: boolean): void {
  enabled = on;
}

export function isVibrationEnabled(): boolean {
  return enabled;
}

/**
 * Vibrates using `pattern` (ms on/off, as in materials.ts's feel.vibrate),
 * already scaled/selected by the caller. Silently does nothing when
 * vibration is disabled, unsupported, the pattern is empty/zero, or another
 * buzz fired within the last MIN_GAP_MS (avoids a stutter of overlapping
 * short vibrations during a pile-up of impacts).
 */
export function vibrate(pattern: number[]): void {
  if (!enabled || pattern.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const total = pattern.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return;
  const now = performance.now();
  if (now - lastVibrateAt < MIN_GAP_MS) return;
  lastVibrateAt = now;
  navigator.vibrate(pattern);
}
