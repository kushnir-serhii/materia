import { describe, it, expect } from 'vitest';
import { MATERIALS, MATERIAL_IDS, PLANK_SIZE } from '../../src/game/materials';

describe('materials', () => {
  it('has all four material ids', () => {
    expect(MATERIAL_IDS).toEqual(['wood', 'stone', 'jelly', 'glass']);
    expect(Object.keys(MATERIALS).sort()).toEqual(['glass', 'jelly', 'stone', 'wood']);
  });

  it.each(MATERIAL_IDS)('%s has all required fields in sane ranges', (id) => {
    const m = MATERIALS[id];
    expect(m.id).toBe(id);

    expect(m.physics.density).toBeGreaterThan(0);
    expect(m.physics.density).toBeLessThan(10);
    expect(m.physics.friction).toBeGreaterThanOrEqual(0);
    expect(m.physics.friction).toBeLessThanOrEqual(2);
    expect(m.physics.restitution).toBeGreaterThanOrEqual(0);
    expect(m.physics.restitution).toBeLessThanOrEqual(1);
    expect(m.physics.linearDamping).toBeGreaterThanOrEqual(0);
    expect(m.physics.angularDamping).toBeGreaterThanOrEqual(0);

    expect(Number.isInteger(m.colors.fill)).toBe(true);
    expect(m.colors.fill).toBeGreaterThanOrEqual(0);
    expect(m.colors.fill).toBeLessThanOrEqual(0xffffff);
    expect(Number.isInteger(m.colors.stroke)).toBe(true);

    expect(typeof m.feel.sound).toBe('string');
    expect(m.feel.sound.length).toBeGreaterThan(0);
    expect(Array.isArray(m.feel.vibrate)).toBe(true);
    expect(m.feel.vibrate.length).toBeGreaterThan(0);
    m.feel.vibrate.forEach((v) => expect(v).toBeGreaterThan(0));
    expect(m.feel.shake).toBeGreaterThanOrEqual(0);
    expect(m.feel.shake).toBeLessThanOrEqual(1);

    expect(m.glass.crackForce).toBeGreaterThan(0);
    expect(m.glass.breakForce).toBeGreaterThan(m.glass.crackForce);
    expect(m.glass.loadLimit).toBeGreaterThan(0);
    expect(m.glass.loadTime).toBeCloseTo(0.5);
  });

  it('stone is denser and less bouncy than jelly', () => {
    expect(MATERIALS.stone.physics.density).toBeGreaterThan(MATERIALS.jelly.physics.density);
    expect(MATERIALS.stone.physics.restitution).toBeLessThan(MATERIALS.jelly.physics.restitution);
  });

  it('glass thresholds separate the measured scenarios (see materials.ts comment)', () => {
    const g = MATERIALS.glass.glass;
    // A: 1 wood resting (~34N) and B: 2 stone stacked settle spike (~113N)
    // must both stay under crackForce.
    expect(g.crackForce).toBeGreaterThan(113);
    // C: wood dropped 3m (~553N) must cross crackForce but not breakForce.
    expect(g.crackForce).toBeLessThan(553);
    expect(g.breakForce).toBeGreaterThan(553);
    // D: stone dropped 3m (~1932N) must cross breakForce.
    expect(g.breakForce).toBeLessThan(1932);
    // Sustained load: 1 wood resting (~34N) must stay under loadLimit,
    // 2 stone stacked (~99N) must exceed it.
    expect(g.loadLimit).toBeGreaterThan(34);
    expect(g.loadLimit).toBeLessThan(99);
  });

  it('plank size matches GDD base piece', () => {
    expect(PLANK_SIZE.width).toBeCloseTo(2.0);
    expect(PLANK_SIZE.height).toBeCloseTo(0.6);
  });
});
