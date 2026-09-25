import { describe, it, expect } from 'vitest';
import { createSquashPieceState, stepSquash, SQUASH_HEIGHT_FRACTIONS, MAX_SQUASH_LEVEL } from '../../src/game/squash';
import { MATERIALS } from '../../src/game/materials';

const params = MATERIALS.polystyrene.squash;
const dt = 1 / 60;

describe('squash state machine', () => {
  it('starts untouched at level 0 (100% height)', () => {
    const s = createSquashPieceState();
    expect(s.level).toBe(0);
    expect(SQUASH_HEIGHT_FRACTIONS[s.level]).toBe(1);
  });

  it('a small impact does nothing', () => {
    let s = createSquashPieceState();
    s = stepSquash(s, params.impactForce - 50, dt, params);
    expect(s.level).toBe(0);
  });

  it('a single big impact advances exactly one level', () => {
    let s = createSquashPieceState();
    s = stepSquash(s, params.impactForce + 50, dt, params);
    expect(s.level).toBe(1);
  });

  it('several big impacts in a row advance one level at a time, never skipping', () => {
    let s = createSquashPieceState();
    for (let hit = 0; hit < MAX_SQUASH_LEVEL; hit++) {
      const before = s.level;
      s = stepSquash(s, params.impactForce + 50, dt, params);
      expect(s.level).toBe(before + 1);
      // let the baseline settle back toward 0 before the next hit
      for (let i = 0; i < 60; i++) s = stepSquash(s, 0, dt, params);
    }
    expect(s.level).toBe(MAX_SQUASH_LEVEL);
  });

  it('squashing is permanent: level never decreases once force drops away', () => {
    let s = createSquashPieceState();
    s = stepSquash(s, params.impactForce + 50, dt, params);
    expect(s.level).toBe(1);
    for (let i = 0; i < 300; i++) s = stepSquash(s, 0, dt, params);
    expect(s.level).toBe(1);
  });

  it('level never exceeds MAX_SQUASH_LEVEL (50% height) however much force keeps coming', () => {
    let s = createSquashPieceState();
    for (let i = 0; i < 20; i++) {
      s = stepSquash(s, params.impactForce * 5, dt, params);
      for (let j = 0; j < 30; j++) s = stepSquash(s, 0, dt, params);
    }
    expect(s.level).toBe(MAX_SQUASH_LEVEL);
    expect(SQUASH_HEIGHT_FRACTIONS[s.level]).toBe(0.5);
  });

  it('sustained load below loadLimit never squashes, even over a long time', () => {
    let s = createSquashPieceState();
    for (let i = 0; i < 600; i++) {
      s = stepSquash(s, params.loadLimit - 5, dt, params);
    }
    expect(s.level).toBe(0);
  });

  it('sustained load at/above loadLimit for loadTime advances one level', () => {
    let s = createSquashPieceState();
    const steps = Math.ceil(params.loadTime / dt) + 5;
    for (let i = 0; i < steps; i++) {
      s = stepSquash(s, params.loadLimit + 10, dt, params);
      if (s.level > 0) break;
    }
    expect(s.level).toBe(1);
  });

  it('sustained load resets its timer once the load drops away', () => {
    let s = createSquashPieceState();
    const almostThere = Math.ceil(params.loadTime / dt) - 3;
    for (let i = 0; i < almostThere; i++) {
      s = stepSquash(s, params.loadLimit + 10, dt, params);
    }
    expect(s.level).toBe(0);
    s = stepSquash(s, 0, dt, params);
    expect(s.sustainedLoadTime).toBe(0);
    for (let i = 0; i < almostThere; i++) {
      s = stepSquash(s, params.loadLimit + 10, dt, params);
    }
    expect(s.level).toBe(0);
  });

  it('three sustained-load hits in a row (e.g. three stones stacked) can walk it down to fully squashed', () => {
    let s = createSquashPieceState();
    for (let stone = 0; stone < 3; stone++) {
      for (let i = 0; i < 300 && s.level <= stone; i++) {
        s = stepSquash(s, params.loadLimit + 30, dt, params);
      }
    }
    expect(s.level).toBeGreaterThanOrEqual(3);
  });

  it('no contact (force 0) never changes level', () => {
    let s = createSquashPieceState();
    for (let i = 0; i < 300; i++) s = stepSquash(s, 0, dt, params);
    expect(s.level).toBe(0);
  });
});
