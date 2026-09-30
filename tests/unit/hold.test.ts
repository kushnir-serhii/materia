import { describe, it, expect } from 'vitest';
import { applyHold, type HoldPiece } from '../../src/game/hold';

const P = (material: HoldPiece['material'], wormy = false): HoldPiece => ({ material, wormy });

describe('applyHold', () => {
  it('empty hold: hook piece goes to hold, next piece comes onto the hook', () => {
    let taken = 0;
    const r = applyHold(null, P('wood'), () => {
      taken++;
      return P('stone');
    });
    expect(r.hook).toEqual(P('stone'));
    expect(r.held).toEqual(P('wood'));
    expect(r.tookNext).toBe(true);
    expect(taken).toBe(1);
  });

  it('occupied hold: swaps hook and held without consuming next', () => {
    const r = applyHold(P('glass'), P('wood', true), () => {
      throw new Error('must not take next');
    });
    expect(r.hook).toEqual(P('glass'));
    expect(r.held).toEqual(P('wood', true));
    expect(r.tookNext).toBe(false);
  });
});
