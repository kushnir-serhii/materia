import { describe, it, expect } from 'vitest';
import {
  createWormState,
  stepWorm,
  WORM_LIFETIME_S,
  WORM_SIZE_FRACTIONS,
  WORM_HARDNESS_FRACTIONS,
} from '../../src/game/worm';

describe('worm eating timeline', () => {
  it('starts fresh at level 0, not eaten', () => {
    const s = createWormState();
    expect(s.level).toBe(0);
    expect(s.elapsedS).toBe(0);
    expect(s.eaten).toBe(false);
  });

  it('advances through every level in order, never skipping, before WORM_LIFETIME_S', () => {
    let s = createWormState();
    const dt = 1; // 1s steps
    const seenLevels = [s.level];
    for (let i = 0; i < WORM_LIFETIME_S - 1; i++) {
      s = stepWorm(s, dt);
      if (s.level !== seenLevels[seenLevels.length - 1]) seenLevels.push(s.level);
    }
    expect(seenLevels).toEqual([0, 1, 2, 3]);
  });

  it('becomes eaten exactly once elapsedS reaches WORM_LIFETIME_S', () => {
    let s = createWormState();
    s = stepWorm(s, WORM_LIFETIME_S - 0.01);
    expect(s.eaten).toBe(false);
    s = stepWorm(s, 0.02);
    expect(s.eaten).toBe(true);
  });

  it('is idempotent once eaten — further steps do not change level/elapsedS', () => {
    let s = createWormState();
    s = stepWorm(s, WORM_LIFETIME_S + 50);
    const snapshot = { ...s };
    s = stepWorm(s, 10);
    expect(s).toEqual(snapshot);
  });

  it('never regresses to a lower level', () => {
    let s = createWormState();
    let prevLevel = s.level;
    for (let i = 0; i < WORM_LIFETIME_S * 2; i++) {
      s = stepWorm(s, 0.5);
      expect(s.level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = s.level;
    }
  });

  it('size and hardness fractions are non-increasing and start at 1 (fresh = full size/hardness)', () => {
    expect(WORM_SIZE_FRACTIONS[0]).toBe(1);
    expect(WORM_HARDNESS_FRACTIONS[0]).toBe(1);
    for (let i = 1; i < WORM_SIZE_FRACTIONS.length; i++) {
      expect(WORM_SIZE_FRACTIONS[i]).toBeLessThanOrEqual(WORM_SIZE_FRACTIONS[i - 1]);
      expect(WORM_HARDNESS_FRACTIONS[i]).toBeLessThanOrEqual(WORM_HARDNESS_FRACTIONS[i - 1]);
    }
  });

  it('a zero/negative dt never advances the timeline backwards or throws', () => {
    let s = createWormState();
    s = stepWorm(s, 5);
    const before = { ...s };
    s = stepWorm(s, -3);
    expect(s.elapsedS).toBe(before.elapsedS);
    expect(s.level).toBe(before.level);
  });
});
