// HOLD slot (capacity 1). Pure swap rule, unit-tested in tests/unit/hold.test.ts.
import type { MaterialId } from './materials';

export interface HoldPiece {
  material: MaterialId;
  /** wormy wood variant (only meaningful for wood) */
  wormy: boolean;
}

/**
 * Tapping HOLD: with an empty slot the current hook piece goes into hold
 * and the NEXT piece (taken via `takeNext`) comes onto the hook; with a
 * piece already held, the two simply swap (takeNext is not called).
 */
export function applyHold(
  held: HoldPiece | null,
  hook: HoldPiece,
  takeNext: () => HoldPiece,
): { hook: HoldPiece; held: HoldPiece; tookNext: boolean } {
  if (held) return { hook: held, held: hook, tookNext: false };
  return { hook: takeNext(), held: hook, tookNext: true };
}
