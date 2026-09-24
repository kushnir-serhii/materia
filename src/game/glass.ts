// Pure state machine for a single glass piece's crack/shatter behavior.
// No Phaser/Rapier imports — driven by force numbers the scene reads from
// physics.ts's per-step contact force events. See materials.ts for the
// threshold values and how they were measured.

import type { GlassParams } from './materials';

export type GlassState = 'intact' | 'cracked' | 'shattered';

export interface GlassPieceState {
  state: GlassState;
  /** seconds the piece has been continuously under load >= loadLimit */
  sustainedLoadTime: number;
  /** smoothed baseline force, used to tell a load spike (impact) from steady load */
  baselineForce: number;
}

export function createGlassPieceState(): GlassPieceState {
  return { state: 'intact', sustainedLoadTime: 0, baselineForce: 0 };
}

/** How fast the baseline tracks the current force (per second, exponential). */
const BASELINE_SMOOTHING = 4;

/**
 * Advance a glass piece's state by one step.
 *
 * @param state current state (mutated in place and returned)
 * @param force total contact force magnitude on this piece this step, in Newtons
 *   (0 if the piece had no contact this step)
 * @param dt step duration in seconds
 * @param params glass thresholds from materials.ts
 * @returns the same `state` object, for convenience
 */
export function stepGlass(
  state: GlassPieceState,
  force: number,
  dt: number,
  params: GlassParams,
): GlassPieceState {
  if (state.state === 'shattered') return state;

  // impact = how far this step's force spikes above the smoothed baseline.
  // A sudden hit shows up as a spike; steady load does not (baseline catches up).
  const impact = Math.max(0, force - state.baselineForce);

  if (impact >= params.breakForce) {
    state.state = 'shattered';
    return state;
  }
  if (impact >= params.crackForce) {
    state.state = state.state === 'cracked' ? 'shattered' : 'cracked';
    if (state.state === 'shattered') return state;
  }

  if (force >= params.loadLimit) {
    state.sustainedLoadTime += dt;
    if (state.sustainedLoadTime >= params.loadTime) {
      state.state = 'shattered';
      return state;
    }
  } else {
    state.sustainedLoadTime = 0;
  }

  // Track baseline toward the current force so the next impact can be
  // detected as a spike relative to whatever load is already resting on it.
  const alpha = 1 - Math.exp(-BASELINE_SMOOTHING * dt);
  state.baselineForce += (force - state.baselineForce) * alpha;

  return state;
}
