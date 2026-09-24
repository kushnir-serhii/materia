import { describe, it, expect } from 'vitest';
import { impactToVolume, impactToPitch, impactToHaptic } from '../../src/fx/mapping';

describe('impactToVolume', () => {
  it('is 0 for weak or no force', () => {
    expect(impactToVolume(0)).toBe(0);
    expect(impactToVolume(1)).toBe(0);
  });

  it('increases with force and stays clamped to [0,1]', () => {
    const low = impactToVolume(20);
    const mid = impactToVolume(300);
    const high = impactToVolume(1200);
    const huge = impactToVolume(1_000_000);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeLessThanOrEqual(1);
    expect(huge).toBeLessThanOrEqual(1);
  });
});

describe('impactToPitch', () => {
  it('is 1 for no impact and dips slightly for a big one, never far from 1', () => {
    expect(impactToPitch(0)).toBe(1);
    const big = impactToPitch(2000);
    expect(big).toBeLessThan(1);
    expect(big).toBeGreaterThan(0.8);
  });
});

describe('impactToHaptic', () => {
  it('skips weak impacts entirely', () => {
    expect(impactToHaptic(0)).toBe(0);
    expect(impactToHaptic(14)).toBe(0);
  });

  it('has a floor and increases with force, clamped to 1', () => {
    const justFelt = impactToHaptic(15);
    const strong = impactToHaptic(400);
    const huge = impactToHaptic(1_000_000);
    expect(justFelt).toBeGreaterThanOrEqual(0.25);
    expect(strong).toBeGreaterThan(justFelt);
    expect(huge).toBeLessThanOrEqual(1);
  });
});
