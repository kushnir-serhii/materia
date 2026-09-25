import { describe, it, expect } from 'vitest';
import { computeFreezeFill, totalFreezeVolume, freezeTopFlatness, FREEZE_MAX_FILL_DEPTH_M } from '../../src/game/freeze';

const VOLUME = 1.2; // GDD ~2.0 x 0.6m plank

describe('computeFreezeFill', () => {
  it('conserves volume within 1% on a flat profile', () => {
    const surfaceYs = new Array(10).fill(15);
    const { strips } = computeFreezeFill(0, 2, surfaceYs, VOLUME);
    expect(totalFreezeVolume(strips)).toBeCloseTo(VOLUME, 1);
    expect(Math.abs(totalFreezeVolume(strips) - VOLUME) / VOLUME).toBeLessThan(0.01);
  });

  it('conserves volume within 1% on an uneven step profile', () => {
    const surfaceYs = [15, 15, 15, 15, 15, 14, 14, 14, 14, 14];
    const { strips } = computeFreezeFill(0, 2, surfaceYs, VOLUME);
    expect(Math.abs(totalFreezeVolume(strips) - VOLUME) / VOLUME).toBeLessThan(0.01);
  });

  it('top is flat across all strips', () => {
    const surfaceYs = [15, 14.7, 14.9, 15.2, 15, 14.8, 15.1, 15, 14.6, 15];
    const { strips } = computeFreezeFill(0, 2, surfaceYs, VOLUME);
    expect(freezeTopFlatness(strips)).toBeCloseTo(0, 6);
  });

  it('a flat profile produces a uniform slab of thickness volume/width', () => {
    const surfaceYs = new Array(10).fill(15);
    const { strips, topY } = computeFreezeFill(0, 2, surfaceYs, VOLUME);
    const expectedThickness = VOLUME / 2; // span=2m
    for (const s of strips) {
      expect(s.bottom - s.top).toBeCloseTo(expectedThickness, 3);
    }
    expect(15 - topY).toBeCloseTo(expectedThickness, 3);
  });

  it('an uneven step profile fills the low side deeper (bigger gap -> lower line)', () => {
    // left half is 1m lower (a gap) than the right half.
    const surfaceYs = [16, 16, 16, 16, 16, 15, 15, 15, 15, 15];
    const { strips } = computeFreezeFill(0, 2, surfaceYs, VOLUME);
    const leftDepths = strips.filter((s) => s.xCenter < 1).map((s) => s.bottom - s.top);
    const rightDepths = strips.filter((s) => s.xCenter >= 1).map((s) => s.bottom - s.top);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(leftDepths)).toBeGreaterThan(avg(rightDepths));
  });

  it('skips zero-height strips (a column already at/above the flat line)', () => {
    // one column much higher than the rest, tiny fill volume so the line
    // sits between the low columns and that one tall column.
    const surfaceYs = [15, 15, 15, 15, 15, 15, 15, 15, 15, 10];
    const { strips } = computeFreezeFill(0, 2, surfaceYs, 0.05);
    expect(strips.length).toBeLessThan(10);
    expect(strips.every((s) => s.bottom - s.top > 0)).toBe(true);
  });

  it('clamps per-column fill depth at FREEZE_MAX_FILL_DEPTH_M', () => {
    // one deep pit; even with a huge volume, that column's depth is capped.
    const surfaceYs = [15, 15, 15, 15, 15, 15, 15, 15, 15, 100];
    const { strips } = computeFreezeFill(0, 2, surfaceYs, 500);
    for (const s of strips) {
      expect(s.bottom - s.top).toBeLessThanOrEqual(FREEZE_MAX_FILL_DEPTH_M + 1e-6);
    }
  });

  it('returns no strips for a degenerate (zero-width) range', () => {
    const { strips } = computeFreezeFill(1, 1, new Array(10).fill(15), VOLUME);
    expect(strips).toEqual([]);
  });
});
