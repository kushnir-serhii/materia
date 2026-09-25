// Pure damped-spring math driving a jelly piece's squash/wobble visual.
// No Phaser import — the physics body is untouched, this only produces a
// volume-preserving scale (sx = 1+a, sy = 1-a) for the piece's container.
// See docs/GDD.md §2 (jelly) and §6 (feel budget).

export interface JellySpringParams {
  /** Hz, wobble frequency. */
  frequencyHz: number;
  /** seconds until the wobble has decayed to ~2% of its initial amplitude. */
  decayTime: number;
  /** clamp on |a|, keeps the squash from turning the piece inside out. */
  maxAmplitude: number;
}

export const JELLY_SPRING_PARAMS: JellySpringParams = {
  frequencyHz: 8,
  decayTime: 0.6,
  maxAmplitude: 0.35,
};

export interface JellySpringState {
  /** current envelope amplitude (set on trigger, decays as the spring runs) */
  amplitude: number;
  /** seconds since trigger */
  t: number;
  active: boolean;
}

export function createJellySpring(): JellySpringState {
  return { amplitude: 0, t: 0, active: false };
}

/**
 * Impact force (Newtons) -> initial squash amplitude, log scale + clamp.
 * Small forces (something merely landing on top) still produce a small,
 * visible jiggle instead of a hard on/off cliff; big impacts saturate at
 * maxAmplitude rather than flipping the piece inside out.
 */
export function forceToJellyAmplitude(force: number, params: JellySpringParams = JELLY_SPRING_PARAMS): number {
  if (force <= 0) return 0;
  const REFERENCE_FORCE = 600; // ~ a solid drop onto jelly; maps close to max amplitude
  const norm = Math.log1p(force) / Math.log1p(REFERENCE_FORCE);
  return Math.min(1, Math.max(0, norm)) * params.maxAmplitude;
}

/**
 * Starts (or restarts) a squash/wobble. If the spring is already mid-wobble,
 * keeps the larger of the two amplitudes rather than resetting to a smaller
 * one, so a big hit isn't visually cut short by a following small one.
 */
export function triggerJellySpring(
  state: JellySpringState,
  amplitude: number,
  params: JellySpringParams = JELLY_SPRING_PARAMS,
): void {
  const clamped = Math.min(params.maxAmplitude, Math.max(0, amplitude));
  state.amplitude = Math.max(state.active ? state.amplitude : 0, clamped);
  state.t = 0;
  state.active = true;
}

/**
 * Advances the spring by dt seconds and returns this frame's scale.
 * Returns {sx:1, sy:1} (no-op) once the wobble has decayed away or was
 * never triggered — callers can apply this every frame unconditionally.
 */
export function stepJellySpring(
  state: JellySpringState,
  dt: number,
  params: JellySpringParams = JELLY_SPRING_PARAMS,
): { sx: number; sy: number } {
  if (!state.active) return { sx: 1, sy: 1 };
  state.t += dt;
  // exp(-decayRate * decayTime) ~= 0.02 (ln(50) ~= 3.9)
  const decayRate = 3.9 / params.decayTime;
  const envelope = state.amplitude * Math.exp(-decayRate * state.t);
  if (envelope < params.maxAmplitude * 0.02) {
    state.active = false;
    return { sx: 1, sy: 1 };
  }
  const a = envelope * Math.cos(2 * Math.PI * params.frequencyHz * state.t);
  return { sx: 1 + a, sy: 1 - a };
}

/**
 * The wobble's current envelope magnitude (0 once inactive/decayed) without
 * advancing it — used by the jelly-look redraw (drifting ripples along its
 * outline get bigger right after an impact, fading with the same envelope
 * as the squash/wobble itself) and to decide how often it's worth redrawing
 * at all (PieceManager.updateLivingLook).
 */
export function jellySpringEnvelope(state: JellySpringState, params: JellySpringParams = JELLY_SPRING_PARAMS): number {
  if (!state.active) return 0;
  const decayRate = 3.9 / params.decayTime;
  return state.amplitude * Math.exp(-decayRate * state.t);
}
