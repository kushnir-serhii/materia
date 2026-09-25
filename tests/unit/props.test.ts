import { describe, it, expect } from 'vitest';
import {
  weightToDensity,
  gripToFriction,
  bounceToRestitution,
  bounceToRestingDamping,
  airDragToExtraDamping,
  hardnessToAttackMultiplier,
  hardnessToToughness,
  damageFactor,
} from '../../src/game/props';

const SAMPLE_XS = Array.from({ length: 21 }, (_, i) => i / 2); // 0, 0.5, 1, ..., 10

function expectMonotonicNonDecreasing(fn: (x: number) => number): void {
  let prev = -Infinity;
  for (const x of SAMPLE_XS) {
    const y = fn(x);
    expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
    prev = y;
  }
}

describe('props.ts mapping functions', () => {
  it('every mapping function is monotonic non-decreasing over 0-10', () => {
    expectMonotonicNonDecreasing(weightToDensity);
    expectMonotonicNonDecreasing(gripToFriction);
    expectMonotonicNonDecreasing(bounceToRestitution);
    expectMonotonicNonDecreasing(bounceToRestingDamping);
    expectMonotonicNonDecreasing(airDragToExtraDamping);
    expectMonotonicNonDecreasing(hardnessToAttackMultiplier);
    expectMonotonicNonDecreasing(hardnessToToughness);
  });

  it('clamps below 0 and above 10 to the endpoints', () => {
    expect(weightToDensity(-5)).toBe(weightToDensity(0));
    expect(weightToDensity(50)).toBe(weightToDensity(10));
    expect(gripToFriction(-1)).toBe(gripToFriction(0));
    expect(gripToFriction(11)).toBe(gripToFriction(10));
  });

  it('airDrag=0 produces zero extra airborne damping (every pre-props material falls unchanged)', () => {
    expect(airDragToExtraDamping(0)).toBe(0);
  });

  it('heavier weight always yields a strictly greater density at the anchor points', () => {
    expect(weightToDensity(10)).toBeGreaterThan(weightToDensity(7));
    expect(weightToDensity(7)).toBeGreaterThan(weightToDensity(5));
    expect(weightToDensity(5)).toBeGreaterThan(weightToDensity(1));
  });

  it('steel-weight density is heavy but not absurd (tuned to avoid Rapier jitter on light neighbours)', () => {
    const d = weightToDensity(10);
    expect(d).toBeGreaterThanOrEqual(5);
    expect(d).toBeLessThanOrEqual(6.5);
  });

  describe('damageFactor', () => {
    it('is strictly increasing in attacker hardness (holding force/receiver fixed)', () => {
      const force = 100;
      let prev = -Infinity;
      for (const h of SAMPLE_XS) {
        const v = damageFactor(h, 5, force);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    });

    it('is strictly decreasing in receiver hardness (holding force/attacker fixed) — tougher receivers take less effective damage', () => {
      const force = 100;
      let prev = Infinity;
      for (const h of SAMPLE_XS) {
        const v = damageFactor(5, h, force);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    });

    it('scales linearly with force', () => {
      const a = damageFactor(8, 3, 100);
      const b = damageFactor(8, 3, 200);
      expect(b).toBeCloseTo(a * 2, 5);
    });

    it('force <= 0 always yields 0', () => {
      expect(damageFactor(10, 0, 0)).toBe(0);
      expect(damageFactor(10, 0, -5)).toBe(0);
    });

    it('a steel attacker (hardness 10) hits a glass-hardness receiver (3) much harder than a wood attacker (5) does, same raw force', () => {
      const force = 500;
      const steelOnGlass = damageFactor(10, 3, force);
      const woodOnGlass = damageFactor(5, 3, force);
      expect(steelOnGlass).toBeGreaterThan(woodOnGlass * 1.5);
    });

    it('a steel attacker crushes polystyrene (hardness 2) much harder than a jelly attacker (1)', () => {
      const force = 300;
      const steelOnPoly = damageFactor(10, 2, force);
      const jellyOnPoly = damageFactor(1, 2, force);
      expect(steelOnPoly).toBeGreaterThan(jellyOnPoly * 3);
    });
  });
});
