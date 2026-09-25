import { describe, it, expect } from 'vitest';
import { MATERIALS, MATERIAL_IDS, ALL_MATERIAL_IDS, PLANK_SIZE } from '../../src/game/materials';

describe('materials', () => {
  it('has the 4 rotation material ids, plus freeze as a special (not in rotation)', () => {
    expect(MATERIAL_IDS).toEqual(['wood', 'stone', 'jelly', 'glass']);
    expect(ALL_MATERIAL_IDS).toEqual(['wood', 'stone', 'jelly', 'glass', 'freeze']);
    expect(Object.keys(MATERIALS).sort()).toEqual(['freeze', 'glass', 'jelly', 'stone', 'wood']);
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

  it('freeze has sane physics/feel and GDD §2.1 timings', () => {
    const m = MATERIALS.freeze;
    expect(m.physics.density).toBeCloseTo(0.9);
    expect(m.physics.friction).toBeCloseTo(0.5);
    expect(m.physics.restitution).toBe(0);
    expect(m.feel.vibrate).toEqual([20, 40, 20]);
    expect(m.freeze.volume).toBeGreaterThan(0);
    // Whole block melts within 1 minute: 30s to start weakening + 30s to fully melt.
    expect(m.freeze.meltStartS).toBeCloseTo(30);
    expect(m.freeze.meltDurationS).toBeCloseTo(30);
    expect(m.freeze.meltStartS + m.freeze.meltDurationS).toBeLessThanOrEqual(60);
    expect(m.freeze.shrinkFraction).toBeCloseTo(0.3);
    expect(m.freeze.glueBreakForce).toBeGreaterThan(0);
    expect(Number.isInteger(m.freeze.iceColors.fill)).toBe(true);
    expect(Number.isInteger(m.freeze.iceColors.stroke)).toBe(true);
  });

  it('every material carries a freeze field (unused unless id === freeze)', () => {
    for (const id of ALL_MATERIAL_IDS) {
      expect(MATERIALS[id].freeze).toBeDefined();
      expect(MATERIALS[id].freeze.volume).toBeGreaterThan(0);
    }
  });

  it('plank size matches GDD base piece', () => {
    expect(PLANK_SIZE.width).toBeCloseTo(2.0);
    expect(PLANK_SIZE.height).toBeCloseTo(0.6);
  });
});
