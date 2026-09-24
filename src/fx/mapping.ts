// Pure impact-force -> feel mappings. No WebAudio/DOM here so these are
// unit-testable in isolation; audio.ts and haptics.ts (via fx/index.ts) both
// read force through these instead of hard-coding their own curves.

const MIN_AUDIBLE_FORCE = 3;
/** Force (N) that maps to ~full volume / haptic intensity. Roughly a big stone drop. */
const REFERENCE_FORCE = 1200;
const MIN_HAPTIC_FORCE = 15; // weaker impacts are skipped entirely (per spec)
const REFERENCE_HAPTIC_FORCE = 400;
const HAPTIC_FLOOR = 0.25; // a felt hit is never a barely-there buzz

/** Force (N) -> playback volume in [0,1], log scale, clamped. 0 below MIN_AUDIBLE_FORCE. */
export function impactToVolume(force: number): number {
  if (force <= MIN_AUDIBLE_FORCE) return 0;
  const norm = Math.log1p(force - MIN_AUDIBLE_FORCE) / Math.log1p(REFERENCE_FORCE);
  return Math.min(1, Math.max(0, norm));
}

/** Force (N) -> pitch multiplier around 1 (bigger hits sit slightly lower). */
export function impactToPitch(force: number): number {
  return 1 - impactToVolume(force) * 0.12;
}

/** Force (N) -> haptic intensity scale in [0,1]; 0 means "skip, too weak to feel". */
export function impactToHaptic(force: number): number {
  if (force < MIN_HAPTIC_FORCE) return 0;
  const norm = Math.log1p(force - MIN_HAPTIC_FORCE) / Math.log1p(REFERENCE_HAPTIC_FORCE);
  return Math.min(1, Math.max(HAPTIC_FLOOR, norm));
}
