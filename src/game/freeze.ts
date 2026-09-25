// Pure fill-to-flat-line math for the freeze special block (GDD §2.1).
// No Phaser/Rapier imports — driven by a surface profile the scene builds
// from raycasts, so this is unit-testable in isolation.
//
// Convention: y-down (larger y = lower/deeper), same as physics.ts.

/** Per-column strip of the frozen shape: a flat top at `top`, following the
 *  (possibly uneven) surface below it at `bottom`. */
export interface FreezeStrip {
  /** world x of this strip's center, meters */
  xCenter: number;
  /** strip width, meters */
  width: number;
  /** y of the flat top line (same for every strip), meters */
  top: number;
  /** y of the surface this strip rests on (>= top), meters */
  bottom: number;
}

export interface FreezeFillResult {
  strips: FreezeStrip[];
  /** the flat top line's y, meters */
  topY: number;
}

/** No single column fills deeper than this, even if volume is left over —
 *  the excess just can't be placed (topY bottoms out at minSurfaceY - this). */
export const FREEZE_MAX_FILL_DEPTH_M = 3;

const BINARY_SEARCH_ITERATIONS = 40;
const MIN_STRIP_HEIGHT_M = 1e-4;

/** Total fill volume (m^2, this is 2D) for a candidate flat top line `topY`
 *  against `surfaceYs`, each column `width` wide, depth capped per-column. */
function volumeAtTopY(surfaceYs: number[], width: number, topY: number): number {
  let v = 0;
  for (const s of surfaceYs) {
    const depth = Math.min(FREEZE_MAX_FILL_DEPTH_M, Math.max(0, s - topY));
    v += depth * width;
  }
  return v;
}

/**
 * Computes the flat-top fill shape for a piece landing across [x0, x1],
 * given a surface profile sampled at `surfaceYs.length` equal-width columns
 * spanning that range, and a fixed volume `volumeM2` to place.
 *
 * Binary-searches the flat top line `topY` so the summed fill volume across
 * all columns (each capped at FREEZE_MAX_FILL_DEPTH_M) matches `volumeM2` as
 * closely as possible, then returns one strip per column with a non-zero
 * height (zero-height strips — a column already at/above the target line —
 * are skipped).
 */
export function computeFreezeFill(x0: number, x1: number, surfaceYs: number[], volumeM2: number): FreezeFillResult {
  const n = surfaceYs.length;
  const spanM = x1 - x0;
  if (n === 0 || spanM <= 0 || volumeM2 <= 0) {
    return { strips: [], topY: n > 0 ? Math.min(...surfaceYs) : x0 };
  }
  const width = spanM / n;

  const minSurfaceY = Math.min(...surfaceYs);
  const maxSurfaceY = Math.max(...surfaceYs);

  let lo = minSurfaceY - FREEZE_MAX_FILL_DEPTH_M; // most volume (deepest possible fill)
  let hi = maxSurfaceY; // zero volume
  const maxVolume = volumeAtTopY(surfaceYs, width, lo);
  const target = Math.min(volumeM2, maxVolume);

  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const v = volumeAtTopY(surfaceYs, width, mid);
    // volumeAtTopY is monotonically non-increasing as topY grows.
    if (v > target) lo = mid;
    else hi = mid;
  }
  const topY = (lo + hi) / 2;

  const strips: FreezeStrip[] = [];
  for (let i = 0; i < n; i++) {
    const surfaceY = surfaceYs[i];
    const bottom = Math.min(surfaceY, topY + FREEZE_MAX_FILL_DEPTH_M);
    if (bottom - topY < MIN_STRIP_HEIGHT_M) continue; // skip zero-height strips
    strips.push({
      xCenter: x0 + width * (i + 0.5),
      width,
      top: topY,
      bottom,
    });
  }

  return { strips, topY };
}

/** Sum of (bottom-top)*width over all strips — for tests / sanity checks. */
export function totalFreezeVolume(strips: FreezeStrip[]): number {
  let v = 0;
  for (const s of strips) v += (s.bottom - s.top) * s.width;
  return v;
}

/** max(top) - min(top) across strips; 0 means a perfectly flat top line. */
export function freezeTopFlatness(strips: FreezeStrip[]): number {
  if (strips.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of strips) {
    if (s.top < min) min = s.top;
    if (s.top > max) max = s.top;
  }
  return max - min;
}
