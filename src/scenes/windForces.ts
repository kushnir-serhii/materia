// Applies the current wind gust (src/game/wind.ts) to the live pieces as a
// horizontal force ∝ exposed area × dragFactor. Rapier forces are
// PERSISTENT until reset, so every step re-sets the force from scratch, and
// the moment the gust ends the forces are cleared once.

import type { Material, MaterialId } from '../game/materials';
import { windForceN } from '../game/wind';
import type { PieceRuntime } from './PieceManager';

export class WindForces {
  private active = false;

  /** `pieces` must be unique per piece (use PieceManager.piecesById.values(), not the per-collider `pieces` map). intensity: signed gust intensity in [-1, 1] (0 = calm). Leaves the hook alone — only dynamic, non-settled bodies get pushed; sleeping ones aren't woken. */
  apply(pieces: Iterable<PieceRuntime>, materials: Record<MaterialId, Material>, intensity: number): void {
    if (intensity === 0) {
      if (this.active) {
        for (const p of pieces) if (!p.settled) p.body.resetForces(false);
        this.active = false;
      }
      return;
    }
    this.active = true;
    for (const p of pieces) {
      if (p.settled || p.body.isSleeping()) continue;
      if (p.freeze && p.freeze.phase !== 'falling') continue; // ice is glued to the tower
      const props = materials[p.material].props;
      const area = p.halfWM * 2 * p.halfHM * 2;
      p.body.resetForces(false);
      p.body.addForce({ x: windForceN(intensity, area, props.airDrag, props.weight), y: 0 }, false);
    }
  }
}
