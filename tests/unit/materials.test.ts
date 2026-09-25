import { describe, it, expect } from 'vitest';
import { MATERIALS, MATERIAL_IDS, ALL_MATERIAL_IDS, PLANK_SIZE } from '../../src/game/materials';

describe('materials', () => {
  it('has the 7 rotation material ids, plus freeze as a special (not in rotation)', () => {
    expect(MATERIAL_IDS).toEqual(['wood', 'stone', 'jelly', 'glass', 'steel', 'polystyrene', 'cardboard']);
    expect(ALL_MATERIAL_IDS).toEqual(['wood', 'stone', 'jelly', 'glass', 'steel', 'polystyrene', 'cardboard', 'freeze']);
    expect(Object.keys(MATERIALS).sort()).toEqual(
      ['freeze', 'glass', 'jelly', 'cardboard', 'polystyrene', 'steel', 'stone', 'wood'].sort(),
    );
  });

  it.each(ALL_MATERIAL_IDS)('%s has all required fields in sane ranges', (id) => {
    const m = MATERIALS[id];
    expect(m.id).toBe(id);

    expect(m.physics.density).toBeGreaterThan(0);
    expect(m.physics.density).toBeLessThan(10);
    expect(m.physics.friction).toBeGreaterThanOrEqual(0);
    expect(m.physics.friction).toBeLessThanOrEqual(2);
    expect(m.physics.restitution).toBeGreaterThanOrEqual(0);
    expect(m.physics.restitution).toBeLessThanOrEqual(1);
    expect(m.physics.airborneLinearDamping).toBeGreaterThanOrEqual(0);
    expect(m.physics.restingLinearDamping).toBeGreaterThanOrEqual(0);
    expect(m.physics.airborneLinearDamping).toBeGreaterThanOrEqual(m.physics.restingLinearDamping);
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

    expect(m.squash.impactForce).toBeGreaterThan(0);
    expect(m.squash.loadLimit).toBeGreaterThan(0);
    expect(m.squash.loadTime).toBeGreaterThan(0);

    for (const p of [m.props.weight, m.props.hardness, m.props.grip, m.props.bounce, m.props.airDrag]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(10);
    }

    expect(m.size.width).toBeGreaterThan(0);
    expect(m.size.height).toBeGreaterThan(0);
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
    expect(m.physics.density).toBeGreaterThan(0.7);
    expect(m.physics.density).toBeLessThan(1.1);
    expect(m.physics.friction).toBeCloseTo(0.5);
    expect(m.physics.restitution).toBeLessThan(0.05);
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

  it('cardboard is a normal plank size (GDD §2.0), not a thin sheet', () => {
    expect(MATERIALS.cardboard.size).toEqual(PLANK_SIZE);
  });

  it('steel is the heaviest, hardest, most-shake material and never breaks like glass', () => {
    const densities = ALL_MATERIAL_IDS.map((id) => MATERIALS[id].physics.density);
    expect(MATERIALS.steel.physics.density).toBe(Math.max(...densities));
    expect(MATERIALS.steel.props.hardness).toBe(10);
    expect(MATERIALS.steel.feel.shake).toBe(1);
    // Low grip ("slides") -> low friction, on par with glass.
    expect(MATERIALS.steel.physics.friction).toBeLessThan(MATERIALS.wood.physics.friction);
  });

  it('polystyrene and cardboard are far lighter than wood and fall slower (more airborne damping)', () => {
    expect(MATERIALS.polystyrene.physics.density).toBeLessThan(MATERIALS.wood.physics.density);
    expect(MATERIALS.cardboard.physics.density).toBeLessThan(MATERIALS.wood.physics.density);
    expect(MATERIALS.polystyrene.physics.airborneLinearDamping).toBeGreaterThan(
      MATERIALS.wood.physics.airborneLinearDamping,
    );
    expect(MATERIALS.cardboard.physics.airborneLinearDamping).toBeGreaterThan(
      MATERIALS.wood.physics.airborneLinearDamping,
    );
    // Once resting, both settle back down near the baseline (not floaty forever).
    expect(MATERIALS.polystyrene.physics.restingLinearDamping).toBeLessThan(
      MATERIALS.polystyrene.physics.airborneLinearDamping,
    );
    expect(MATERIALS.cardboard.physics.restingLinearDamping).toBeLessThan(
      MATERIALS.cardboard.physics.airborneLinearDamping,
    );
  });

  it("wood/stone/jelly/glass/freeze keep ~their pre-props physics values (props.ts's derivation is a compromise, documented per-property)", () => {
    // Generous tolerance: several of these materials share a prop value
    // (e.g. wood/jelly/freeze are all Weight=3) with a *different* legacy
    // value, so a single-scalar-per-property mapping can't hit every one
    // exactly — see props.ts's file comment. This checks the derivation
    // stayed in the same ballpark, not exact parity.
    const closeWithin = (actual: number, legacy: number, fraction: number): void => {
      expect(Math.abs(actual - legacy)).toBeLessThanOrEqual(Math.max(0.05, legacy * fraction));
    };
    closeWithin(MATERIALS.wood.physics.density, 0.8, 0.15);
    closeWithin(MATERIALS.stone.physics.density, 2.6, 0.1);
    closeWithin(MATERIALS.jelly.physics.density, 0.9, 0.15);
    closeWithin(MATERIALS.glass.physics.density, 1.5, 0.15);

    closeWithin(MATERIALS.wood.physics.friction, 0.6, 0.05);
    closeWithin(MATERIALS.stone.physics.friction, 0.8, 0.05);
    closeWithin(MATERIALS.jelly.physics.friction, 0.9, 0.05);
    closeWithin(MATERIALS.glass.physics.friction, 0.25, 0.05);
    closeWithin(MATERIALS.freeze.physics.friction, 0.5, 0.05);

    closeWithin(MATERIALS.stone.physics.restitution, 0.02, 0.5);
    closeWithin(MATERIALS.jelly.physics.restitution, 0.55, 0.1);

    closeWithin(MATERIALS.jelly.physics.restingLinearDamping, 0.4, 0.15);
  });
});
