// Wind gusts (GDD "Wind"): a seeded scheduler that occasionally blows a
// gentle 1-2 s gust from the left or right, plus the pure force law that
// turns the current gust intensity into a push on one body. No Phaser or
// Rapier imports here — unit-tested in tests/unit/wind.test.ts.
//
// The force is an applied FORCE ∝ exposed area × dragFactor, deliberately
// NOT a mass-proportional acceleration: a heavy block has real inertia, so
// the same push barely moves it while a light box (cardboard, polystyrene)
// drifts noticeably. dragFactor rises with air drag and falls with weight.

export const WIND_FIRST_GUST_MIN_S = 12; // > 10 s: never a gust in the opening 10 s
export const WIND_INTERVAL_MIN_S = 12;
export const WIND_INTERVAL_MAX_S = 25;
export const WIND_DURATION_MIN_S = 1;
export const WIND_DURATION_MAX_S = 2;
export const WIND_STRENGTH_MIN = 0.5;
export const WIND_STRENGTH_MAX = 1;
/** Ramp-in / ramp-out length of a gust, seconds (capped to half the duration). */
export const WIND_RAMP_S = 0.4;
/** Newtons per (m^2 of exposed area × dragFactor) at full intensity. Tuned so a cardboard box (~0.4 kg) drifts ~1 m in a 2 s gust while wood barely stirs and stone/steel don't move. */
export const WIND_FORCE_K = 0.4;

export interface Gust {
  /** +1 blows toward +x (right), -1 toward -x (left). */
  dir: 1 | -1;
  /** 0..1 peak strength. */
  strength: number;
  durationS: number;
  elapsedS: number;
}

export interface WindState {
  rngState: number;
  timeS: number;
  /** Seconds until the next scheduled gust starts (counts down while no gust is active). */
  nextGustInS: number;
  gust: Gust | null;
  /** Set when a gust begins; the scene clears it via consumeGustStarted() so the whoosh fires once. */
  started: boolean;
  /** Random scheduling on/off (see createWindState). */
  autoSchedule: boolean;
}

/** mulberry32 — tiny seeded PRNG, returns a value in [0, 1) and advances state. */
function nextRandom(state: WindState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rngState ^ (state.rngState >>> 15), 1 | state.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function range(state: WindState, min: number, max: number): number {
  return min + nextRandom(state) * (max - min);
}

/** `autoSchedule = false` turns the random scheduler off (automation/e2e runs stay deterministic); forceGust() still works. */
export function createWindState(seed: number, autoSchedule = true): WindState {
  const state: WindState = { rngState: seed | 0, timeS: 0, nextGustInS: 0, gust: null, started: false, autoSchedule };
  state.nextGustInS = range(state, WIND_FIRST_GUST_MIN_S, WIND_INTERVAL_MAX_S);
  return state;
}

/** 0 -> 1 -> 0 envelope of a gust: smoothstep ramp in/out, flat in the middle. */
export function gustEnvelope(elapsedS: number, durationS: number, rampS = WIND_RAMP_S): number {
  if (elapsedS <= 0 || elapsedS >= durationS) return 0;
  const ramp = Math.max(1e-6, Math.min(rampS, durationS / 2));
  const x = Math.min(1, elapsedS / ramp, (durationS - elapsedS) / ramp);
  return x * x * (3 - 2 * x);
}

/** Starts a gust right now (dev button / test hook), replacing any active one. */
export function forceGust(state: WindState, dir: 1 | -1, strength: number, seconds: number): void {
  state.gust = {
    dir: dir >= 0 ? 1 : -1,
    strength: Math.min(1, Math.max(0, strength)),
    durationS: Math.max(0.05, seconds),
    elapsedS: 0,
  };
  state.started = true;
}

/** True once per gust start (then cleared) — the scene's cue to play the whoosh. */
export function consumeGustStarted(state: WindState): boolean {
  const was = state.started;
  state.started = false;
  return was;
}

/** Signed wind intensity right now in [-1, 1] (negative = blowing left). */
export function windIntensity(state: WindState): number {
  const g = state.gust;
  if (!g) return 0;
  return g.dir * g.strength * gustEnvelope(g.elapsedS, g.durationS);
}

/** Advances the scheduler by dt and returns the current signed intensity. */
export function stepWind(state: WindState, dt: number): number {
  state.timeS += dt;
  if (state.gust) {
    state.gust.elapsedS += dt;
    if (state.gust.elapsedS >= state.gust.durationS) {
      state.gust = null;
      state.nextGustInS = range(state, WIND_INTERVAL_MIN_S, WIND_INTERVAL_MAX_S);
    }
  } else if (state.autoSchedule) {
    state.nextGustInS -= dt;
    if (state.nextGustInS <= 0) {
      forceGust(
        state,
        nextRandom(state) < 0.5 ? -1 : 1,
        range(state, WIND_STRENGTH_MIN, WIND_STRENGTH_MAX),
        range(state, WIND_DURATION_MIN_S, WIND_DURATION_MAX_S),
      );
    }
  }
  return windIntensity(state);
}

/** How strongly a material catches the wind: rises with air drag, falls with weight. Cardboard (W1, D5) ≈ 12x stone (W7, D0). */
export function windDragFactor(airDrag: number, weight: number): number {
  return (1 + 0.4 * airDrag) / (1 + weight);
}

/** Horizontal wind force (N, signed) on one body: intensity × K × exposed area × dragFactor. */
export function windForceN(intensity: number, areaM2: number, airDrag: number, weight: number): number {
  return intensity * WIND_FORCE_K * areaM2 * windDragFactor(airDrag, weight);
}
