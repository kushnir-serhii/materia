import { describe, it, expect } from 'vitest';
import {
  createWindState,
  stepWind,
  forceGust,
  windIntensity,
  gustEnvelope,
  windForceN,
  windDragFactor,
  consumeGustStarted,
  WIND_FIRST_GUST_MIN_S,
  WIND_INTERVAL_MIN_S,
  WIND_INTERVAL_MAX_S,
} from '../../src/game/wind';
import { MATERIALS } from '../../src/game/materials';

const DT = 1 / 60;

/** Runs the scheduler and returns [startTimeS, endTimeS, dir] for each gust seen. */
function gustLog(seed: number, seconds: number): { start: number; end: number; dir: number; peak: number }[] {
  const w = createWindState(seed);
  const log: { start: number; end: number; dir: number; peak: number }[] = [];
  let cur: { start: number; end: number; dir: number; peak: number } | null = null;
  for (let t = 0; t < seconds; t += DT) {
    const i = stepWind(w, DT);
    if (i !== 0) {
      if (!cur) cur = { start: w.timeS, end: w.timeS, dir: Math.sign(i), peak: 0 };
      cur.end = w.timeS;
      cur.peak = Math.max(cur.peak, Math.abs(i));
    } else if (cur) {
      log.push(cur);
      cur = null;
    }
  }
  return log;
}

describe('gust scheduler', () => {
  it('is deterministic for a seed', () => {
    expect(gustLog(7, 200)).toEqual(gustLog(7, 200));
    expect(gustLog(7, 200)).not.toEqual(gustLog(8, 200));
  });

  it('never blows in the first 10 s, and gusts are spaced ~12-25 s apart', () => {
    for (const seed of [1, 2, 3, 42, 1337]) {
      const log = gustLog(seed, 400);
      expect(log.length).toBeGreaterThan(8);
      expect(log[0].start).toBeGreaterThanOrEqual(10);
      expect(log[0].start).toBeGreaterThanOrEqual(WIND_FIRST_GUST_MIN_S - 0.1);
      for (let i = 1; i < log.length; i++) {
        const gap = log[i].start - log[i - 1].end;
        expect(gap).toBeGreaterThanOrEqual(WIND_INTERVAL_MIN_S - 0.2);
        expect(gap).toBeLessThanOrEqual(WIND_INTERVAL_MAX_S + 0.2);
      }
    }
  });

  it('gusts last 1-2 s, come from both sides, and stay within strength 0..1', () => {
    const log = gustLog(99, 1500);
    const dirs = new Set(log.map((g) => g.dir));
    expect(dirs.has(1) && dirs.has(-1)).toBe(true);
    for (const g of log) {
      expect(g.end - g.start).toBeGreaterThan(0.8);
      expect(g.end - g.start).toBeLessThan(2.1);
      expect(g.peak).toBeLessThanOrEqual(1);
    }
  });

  it('forceGust starts immediately, ramps in and out, and signals once', () => {
    const w = createWindState(1);
    forceGust(w, -1, 1, 2);
    expect(consumeGustStarted(w)).toBe(true);
    expect(consumeGustStarted(w)).toBe(false);
    const samples: number[] = [];
    for (let t = 0; t < 2.2; t += DT) samples.push(stepWind(w, DT));
    expect(Math.min(...samples)).toBeCloseTo(-1, 1); // blows left, reaches full strength
    expect(Math.abs(samples[0])).toBeLessThan(0.1); // gentle ramp in
    expect(samples[samples.length - 1]).toBe(0); // and it ends
    expect(windIntensity(w)).toBe(0);
  });

  it('envelope is 0 outside, 1 in the middle, monotone on the ramps', () => {
    expect(gustEnvelope(0, 2)).toBe(0);
    expect(gustEnvelope(2, 2)).toBe(0);
    expect(gustEnvelope(1, 2)).toBe(1);
    expect(gustEnvelope(0.1, 2)).toBeLessThan(gustEnvelope(0.3, 2));
    expect(gustEnvelope(1.9, 2)).toBeLessThan(gustEnvelope(1.7, 2));
  });
});

describe('wind force law', () => {
  const force = (id: 'cardboard' | 'polystyrene' | 'wood' | 'stone' | 'steel' | 'jelly'): number => {
    const m = MATERIALS[id];
    return windForceN(1, m.size.width * m.size.height, m.props.airDrag, m.props.weight);
  };

  it('is signed with the wind and scales with intensity and area', () => {
    expect(windForceN(-1, 1, 0, 3)).toBeLessThan(0);
    expect(windForceN(1, 2, 3, 3)).toBeCloseTo(2 * windForceN(1, 1, 3, 3));
    expect(windForceN(0.5, 1, 3, 3)).toBeCloseTo(0.5 * windForceN(1, 1, 3, 3));
  });

  it('pushes light, draggy blocks much harder than heavy ones (force, not acceleration)', () => {
    expect(force('cardboard')).toBeGreaterThan(force('wood') * 4);
    expect(force('polystyrene')).toBeGreaterThan(force('wood') * 4);
    expect(force('wood')).toBeGreaterThan(force('stone'));
    expect(force('stone')).toBeGreaterThan(force('steel'));
    expect(force('cardboard')).toBeGreaterThan(force('stone') * 10);
    // "almost nothing" for the heavy ones: well under any resting friction.
    expect(force('steel')).toBeLessThan(0.1);
    expect(force('stone')).toBeLessThan(0.1);
  });

  it('dragFactor rises with air drag and falls with weight', () => {
    expect(windDragFactor(5, 1)).toBeGreaterThan(windDragFactor(0, 1));
    expect(windDragFactor(0, 1)).toBeGreaterThan(windDragFactor(0, 7));
  });
});

describe('autoSchedule off', () => {
  it('never starts a gust by itself, but forceGust still works', () => {
    const w = createWindState(5, false);
    for (let t = 0; t < 300; t += DT) expect(stepWind(w, DT)).toBe(0);
    forceGust(w, 1, 1, 1);
    let peak = 0;
    for (let t = 0; t < 1.2; t += DT) peak = Math.max(peak, Math.abs(stepWind(w, DT)));
    expect(peak).toBeGreaterThan(0.9);
  });
});
