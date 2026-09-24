import { describe, it, expect } from 'vitest';
import {
  createJellySpring,
  forceToJellyAmplitude,
  triggerJellySpring,
  stepJellySpring,
  JELLY_SPRING_PARAMS,
} from '../../src/game/spring';

describe('forceToJellyAmplitude', () => {
  it('is 0 for no force', () => {
    expect(forceToJellyAmplitude(0)).toBe(0);
  });

  it('grows with force and never exceeds maxAmplitude', () => {
    const small = forceToJellyAmplitude(5);
    const big = forceToJellyAmplitude(600);
    const huge = forceToJellyAmplitude(50000);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(huge).toBeLessThanOrEqual(JELLY_SPRING_PARAMS.maxAmplitude);
    expect(big).toBeLessThanOrEqual(JELLY_SPRING_PARAMS.maxAmplitude);
  });
});

describe('jelly spring', () => {
  it('starts inactive and produces an identity scale', () => {
    const s = createJellySpring();
    expect(s.active).toBe(false);
    expect(stepJellySpring(s, 1 / 60)).toEqual({ sx: 1, sy: 1 });
  });

  it('is volume-preserving: sx = 1+a, sy = 1-a', () => {
    const s = createJellySpring();
    triggerJellySpring(s, 0.3);
    const { sx, sy } = stepJellySpring(s, 0.001);
    expect(sx + sy).toBeCloseTo(2, 5);
    expect(sx).toBeGreaterThan(1);
    expect(sy).toBeLessThan(1);
  });

  it('clamps triggered amplitude to maxAmplitude', () => {
    const s = createJellySpring();
    triggerJellySpring(s, 999);
    expect(s.amplitude).toBe(JELLY_SPRING_PARAMS.maxAmplitude);
  });

  it('keeps the larger amplitude when re-triggered mid-wobble', () => {
    const s = createJellySpring();
    triggerJellySpring(s, 0.05);
    triggerJellySpring(s, 0.3);
    expect(s.amplitude).toBe(0.3);
    triggerJellySpring(s, 0.01);
    expect(s.amplitude).toBe(0.3);
  });

  it('decays to inactive within roughly decayTime and stays at identity after', () => {
    const s = createJellySpring();
    triggerJellySpring(s, 0.3);
    const dt = 1 / 60;
    let steps = 0;
    while (s.active && steps < 600) {
      stepJellySpring(s, dt);
      steps++;
    }
    expect(s.active).toBe(false);
    // decayTime is 0.6s -> ~36 steps at 60Hz; allow generous margin
    expect(steps).toBeLessThan(120);
    expect(stepJellySpring(s, dt)).toEqual({ sx: 1, sy: 1 });
  });

  it('never produces a negative or absurd scale for a reasonable amplitude', () => {
    const s = createJellySpring();
    triggerJellySpring(s, JELLY_SPRING_PARAMS.maxAmplitude);
    for (let i = 0; i < 60; i++) {
      const { sx, sy } = stepJellySpring(s, 1 / 60);
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBeGreaterThan(0);
      expect(sx).toBeLessThan(2);
      expect(sy).toBeLessThan(2);
    }
  });
});
