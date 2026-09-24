import { describe, it, expect } from 'vitest';
import { createGlassPieceState, stepGlass } from '../../src/game/glass';
import { MATERIALS } from '../../src/game/materials';

const params = MATERIALS.glass.glass; // { crackForce: 300, breakForce: 1000, loadLimit: 70, loadTime: 0.5 }
const dt = 1 / 60;

describe('glass state machine', () => {
  it('starts intact', () => {
    const s = createGlassPieceState();
    expect(s.state).toBe('intact');
  });

  it('a single huge impact shatters immediately', () => {
    let s = createGlassPieceState();
    s = stepGlass(s, params.breakForce + 500, dt, params);
    expect(s.state).toBe('shattered');
  });

  it('a moderate impact cracks but does not shatter', () => {
    let s = createGlassPieceState();
    s = stepGlass(s, params.crackForce + 50, dt, params);
    expect(s.state).toBe('cracked');
  });

  it('a small impact does nothing', () => {
    let s = createGlassPieceState();
    s = stepGlass(s, params.crackForce - 50, dt, params);
    expect(s.state).toBe('intact');
  });

  it('a second crack-level impact while already cracked shatters it', () => {
    let s = createGlassPieceState();
    s = stepGlass(s, params.crackForce + 10, dt, params);
    expect(s.state).toBe('cracked');
    // let the baseline settle back toward 0 (piece stops being loaded) before the second hit
    for (let i = 0; i < 60; i++) s = stepGlass(s, 0, dt, params);
    s = stepGlass(s, params.crackForce + 10, dt, params);
    expect(s.state).toBe('shattered');
  });

  it('sustained load below loadLimit never shatters, even over a long time', () => {
    let s = createGlassPieceState();
    for (let i = 0; i < 600; i++) {
      s = stepGlass(s, params.loadLimit - 5, dt, params);
    }
    expect(s.state).toBe('intact');
  });

  it('sustained load at/above loadLimit for loadTime shatters', () => {
    let s = createGlassPieceState();
    const steps = Math.ceil(params.loadTime / dt) + 5;
    for (let i = 0; i < steps; i++) {
      s = stepGlass(s, params.loadLimit + 10, dt, params);
      if (s.state === 'shattered') break;
    }
    expect(s.state).toBe('shattered');
  });

  it('sustained load resets its timer once the load drops away', () => {
    let s = createGlassPieceState();
    const almostThere = Math.ceil(params.loadTime / dt) - 3;
    for (let i = 0; i < almostThere; i++) {
      s = stepGlass(s, params.loadLimit + 10, dt, params);
    }
    expect(s.state).toBe('intact');
    // load released before it reached loadTime
    s = stepGlass(s, 0, dt, params);
    expect(s.sustainedLoadTime).toBe(0);
    // resuming load must count from zero again, not shatter immediately
    for (let i = 0; i < almostThere; i++) {
      s = stepGlass(s, params.loadLimit + 10, dt, params);
    }
    expect(s.state).toBe('intact');
  });

  it('a shattered piece stays shattered regardless of further input', () => {
    let s = createGlassPieceState();
    s = stepGlass(s, params.breakForce + 1, dt, params);
    expect(s.state).toBe('shattered');
    s = stepGlass(s, 0, dt, params);
    expect(s.state).toBe('shattered');
  });

  it('no contact (force 0) never changes state', () => {
    let s = createGlassPieceState();
    for (let i = 0; i < 300; i++) s = stepGlass(s, 0, dt, params);
    expect(s.state).toBe('intact');
  });
});
