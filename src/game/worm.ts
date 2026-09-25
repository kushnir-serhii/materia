// Wormy wood's eating timeline (GDD §2.0 "Looks & living details") — pure,
// unit-tested (tests/unit/worm.test.ts), no Phaser/Rapier imports. A wormy
// wood piece is eaten over WORM_LIFETIME_S: holes grow and the piece shrinks
// in a few discrete, permanent steps (visible via `level`, applied to the
// collider by PieceManager) and gets weaker (see WORM_HARDNESS_FRACTIONS),
// then at the end of its lifetime it's fully eaten (`eaten: true`) and
// PieceManager removes it via the normal removal path with reason 'eaten'.

/** Discrete hole/shrink step, 0 = fresh (full size) .. 3 = about to be eaten. */
export type WormLevel = 0 | 1 | 2 | 3;

/** Seconds from spawn to fully eaten. */
export const WORM_LIFETIME_S = 120;

/** Linear size fraction (both width and height) at each level — permanent, one-way. */
export const WORM_SIZE_FRACTIONS: readonly [number, number, number, number] = [1, 0.88, 0.74, 0.58];

/** Hardness multiplier at each level (GDD: "gets weaker") — applied to the material's base hardness for this one piece. */
export const WORM_HARDNESS_FRACTIONS: readonly [number, number, number, number] = [1, 0.85, 0.65, 0.4];

export interface WormState {
  level: WormLevel;
  elapsedS: number;
  /** True once elapsedS has reached WORM_LIFETIME_S — the piece is fully eaten and should be removed (reason 'eaten'). */
  eaten: boolean;
}

export function createWormState(): WormState {
  return { level: 0, elapsedS: 0, eaten: false };
}

/**
 * Advances the timeline by dt seconds, mutating and returning `state`. Level
 * rises in fixed steps (WORM_LIFETIME_S split into 4 equal segments); once
 * elapsedS reaches WORM_LIFETIME_S, `eaten` flips true and stays true
 * (idempotent — further calls are a no-op).
 */
export function stepWorm(state: WormState, dt: number): WormState {
  if (state.eaten) return state;
  state.elapsedS += Math.max(0, dt);
  const segmentS = WORM_LIFETIME_S / WORM_SIZE_FRACTIONS.length;
  const level = Math.min(WORM_SIZE_FRACTIONS.length - 1, Math.floor(state.elapsedS / segmentS));
  state.level = level as WormLevel;
  if (state.elapsedS >= WORM_LIFETIME_S) state.eaten = true;
  return state;
}
