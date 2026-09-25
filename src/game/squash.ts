// Pure state machine for polystyrene's squash behaviour (GDD §2.0/§2 table):
// compresses in permanent steps (100% -> 85% -> 70% -> 50% height) when
// sustained load or a single impact — already scaled by the attacker's
// hardness via props.ts's damageFactor() — crosses a threshold. Modeled
// directly on glass.ts's stepGlass. No Phaser/Rapier import — the caller
// (PieceManager) rebuilds the piece's collider/graphics at the new height.

export interface SquashParams {
  /** a single (damage-scaled) impact spike >= this advances one step immediately. */
  impactForce: number;
  /** a sustained (damage-scaled) load >= this, held for loadTime seconds, advances one step. */
  loadLimit: number;
  /** seconds the load must be sustained before it advances a step. */
  loadTime: number;
}

/** 0 = untouched (100%), 3 = fully squashed (50%, permanent — never un-squashes). */
export type SquashLevel = 0 | 1 | 2 | 3;

/** Height fraction (of the material's original, unsquashed height) at each level. */
export const SQUASH_HEIGHT_FRACTIONS: readonly [number, number, number, number] = [1, 0.85, 0.7, 0.5];

export const MAX_SQUASH_LEVEL: SquashLevel = 3;

export interface SquashPieceState {
  level: SquashLevel;
  /** seconds the piece has been continuously under load >= loadLimit at the current level. */
  sustainedLoadTime: number;
  /** smoothed baseline force, used to tell a load spike (impact) from steady load — same trick as glass.ts. */
  baselineForce: number;
}

export function createSquashPieceState(): SquashPieceState {
  return { level: 0, sustainedLoadTime: 0, baselineForce: 0 };
}

const BASELINE_SMOOTHING = 4;

/**
 * Advance a squashable piece's state by one step. `force` is already
 * damage-scaled (see props.ts's damageFactor) — the caller passes an
 * "effective" force, not the raw contact-force magnitude.
 */
export function stepSquash(
  state: SquashPieceState,
  force: number,
  dt: number,
  params: SquashParams,
): SquashPieceState {
  if (state.level >= MAX_SQUASH_LEVEL) return state;

  const impact = Math.max(0, force - state.baselineForce);
  if (impact >= params.impactForce) {
    state.level = (state.level + 1) as SquashLevel;
    state.sustainedLoadTime = 0;
    // Avoid the same spike immediately re-triggering next frame: the
    // baseline jumps to the current force rather than smoothing toward it.
    state.baselineForce = force;
    return state;
  }

  if (force >= params.loadLimit) {
    state.sustainedLoadTime += dt;
    if (state.sustainedLoadTime >= params.loadTime) {
      state.level = (state.level + 1) as SquashLevel;
      state.sustainedLoadTime = 0;
    }
  } else {
    state.sustainedLoadTime = 0;
  }

  const alpha = 1 - Math.exp(-BASELINE_SMOOTHING * dt);
  state.baselineForce += (force - state.baselineForce) * alpha;

  return state;
}
