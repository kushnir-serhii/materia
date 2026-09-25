// Designer-facing material properties (GDD §2.0) and the pure, monotonic
// mapping functions that derive Rapier physics values from them. No
// Phaser/Rapier imports — unit-tested in isolation (tests/unit/props.test.ts).
//
// Every mapping below is built on `lerpPoints`: a monotonic piecewise-linear
// interpolation through a handful of hand-placed control points. This keeps
// each function trivially monotonic (the control points' y-values are
// non-decreasing) while still landing close to materials.ts's pre-props
// physics values for the five materials that existed before this system
// (wood/stone/jelly/glass/freeze) — see the comment on each table.
//
// A single 0-10 scalar per property can't losslessly reconstruct every
// legacy value: a few existing materials share the same prop value (e.g.
// wood and jelly are both Weight=3) but had different tuned density. Where
// that happens the control point is a compromise between them — both stay
// within a documented tolerance, never a big swing in feel.

export interface MaterialProps {
  /** how heavy -> density. 0-10. */
  weight: number;
  /** how much impact/load before it cracks/squashes/dents, and how hard it hits others -> break/crack/squash thresholds, damage dealt. 0-10. */
  hardness: number;
  /** how slippery (10 = grippiest) -> friction. 0-10. */
  grip: number;
  /** how bouncy -> restitution. 0-10. */
  bounce: number;
  /** how slowly it falls -> extra linear damping while airborne (+ flutter for paper). 0-10. */
  airDrag: number;
}

function clampTo0_10(v: number): number {
  return Math.max(0, Math.min(10, v));
}

/**
 * Monotonic piecewise-linear interpolation through `points` (sorted
 * ascending by x; y must be non-decreasing for the result to be monotonic).
 * Clamps `x` to the input's domain (0-10) first, then clamps to the first/
 * last control point outside their x-range.
 */
function lerpPoints(x: number, points: ReadonlyArray<readonly [number, number]>): number {
  const v = clampTo0_10(x);
  if (v <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (v >= x0 && v <= x1) {
      const t = (v - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * Weight -> Rapier area density. Anchors: paper (W0.5) and polystyrene (W1)
 * far lighter than anything before; wood/jelly/freeze (all W3) compromise
 * around their old 0.8-0.9 density; glass (W5) and stone (W7) close to
 * their old 1.5/2.6; steel (W10) reaches ~5.6 — heavy enough to read as
 * "never gets pushed around" without being so dense Rapier jitters when it
 * rests on a light polystyrene/paper piece (measured empirically, see
 * tests/e2e/materials-v2.spec.ts's steel-on-light-materials case).
 */
const WEIGHT_DENSITY: ReadonlyArray<readonly [number, number]> = [
  [0, 0.12],
  [0.5, 0.18], // paper
  [1, 0.32], // polystyrene
  [3, 0.85], // wood / jelly / freeze
  [5, 1.55], // glass
  [7, 2.6], // stone
  [10, 5.6], // steel
];
export function weightToDensity(weight: number): number {
  return lerpPoints(weight, WEIGHT_DENSITY);
}

/**
 * Grip -> friction. The five pre-props materials were already tuned to
 * almost exactly grip/10 (wood 6->0.6, stone 8->0.8, jelly 9->0.9, freeze
 * 5->0.5); glass's 3->0.25 is the one exception, folded in as its own
 * control point (steel shares it — GDD: "slides").
 */
const GRIP_FRICTION: ReadonlyArray<readonly [number, number]> = [
  [0, 0.05],
  [3, 0.25], // glass / steel
  [5, 0.5], // freeze / polystyrene
  [6, 0.6], // wood / paper
  [8, 0.8], // stone
  [9, 0.9], // jelly
  [10, 0.95],
];
export function gripToFriction(grip: number): number {
  return lerpPoints(grip, GRIP_FRICTION);
}

/**
 * Bounce -> restitution. Stone (B0) ~0.01, jelly (B6) ~0.55 exactly match
 * their old values; wood/glass/steel share Bounce=1 (~0.1-0.15 pre-props) —
 * compromise at 0.12; polystyrene (B2) gets a little spring of its own.
 */
const BOUNCE_RESTITUTION: ReadonlyArray<readonly [number, number]> = [
  [0, 0.01], // stone
  [1, 0.12], // wood / glass / steel
  [2, 0.2], // polystyrene
  [6, 0.55], // jelly
  [10, 0.85],
];
export function bounceToRestitution(bounce: number): number {
  return lerpPoints(bounce, BOUNCE_RESTITUTION);
}

/**
 * Bounce -> resting linear/angular damping baseline (applied once a piece
 * has landed — see PieceManager's airborne/resting damping switch). A
 * bouncier material re-energizes a resting stack's micro-bounces more, so
 * needs more damping to actually settle/sleep (this is *why* jelly's
 * legacy damping was 0.4 while everything else sat near 0.02-0.1). Stone's
 * old 0.1 came from its mass settling, not bounce, and doesn't fit this
 * curve as closely as the others — a known, accepted trade-off for keeping
 * this mapping monotonic in bounce (see materials.ts's props.ts import doc).
 */
const BOUNCE_RESTING_DAMPING: ReadonlyArray<readonly [number, number]> = [
  [0, 0.03], // stone / freeze / paper
  [1, 0.05], // wood / glass / steel
  [2, 0.07], // polystyrene
  [6, 0.4], // jelly
  [10, 0.55],
];
export function bounceToRestingDamping(bounce: number): number {
  return lerpPoints(bounce, BOUNCE_RESTING_DAMPING);
}

/**
 * Air drag -> EXTRA linear damping applied only while a piece is airborne
 * (on top of restingLinearDamping — see PieceManager). Exactly 0 at
 * airDrag=0, so every material that existed before this system (all
 * airDrag=0) falls exactly as before; polystyrene (D5) and especially
 * paper (D9) fall noticeably slower, per GDD.
 */
const AIRDRAG_EXTRA_DAMPING: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [5, 1.6], // polystyrene
  [9, 4.2], // paper
  [10, 5],
];
export function airDragToExtraDamping(airDrag: number): number {
  return lerpPoints(airDrag, AIRDRAG_EXTRA_DAMPING);
}

/**
 * Hardness -> attack multiplier: how hard an impact from a material with
 * this hardness actually hits, for damageFactor(). Steel (H10) hits far
 * harder than its raw physical force alone would suggest; jelly (H1)
 * barely "hits" at all.
 */
const HARDNESS_ATTACK_MULTIPLIER: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5],
  [1, 0.6], // jelly
  [3, 0.85], // glass
  [5, 1], // wood — baseline
  [6, 1.05], // freeze
  [8, 1.15], // stone
  [10, 2.2], // steel — the one big jump, GDD: "crushes glass/polystyrene much more easily"
];
export function hardnessToAttackMultiplier(hardness: number): number {
  return lerpPoints(hardness, HARDNESS_ATTACK_MULTIPLIER);
}

/**
 * Hardness -> receiver toughness: how much of an incoming (already
 * attack-scaled) force this material's own break/crack/squash thresholds
 * effectively have to absorb before it "counts" — for damageFactor().
 * Higher hardness = tougher = divides the effective force down more.
 */
const HARDNESS_TOUGHNESS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.6],
  [1, 0.7], // jelly
  [2, 0.8], // polystyrene
  [3, 0.9], // glass — brittle, but its own crack/break thresholds already carry most of that
  [5, 1], // wood — baseline
  [6, 1.05], // freeze
  [8, 1.15], // stone
  [10, 2.2], // steel — never breaks
];
export function hardnessToToughness(hardness: number): number {
  return lerpPoints(hardness, HARDNESS_TOUGHNESS);
}

/**
 * Generic damage helper (GDD §2.0): "damage happens when impact force >=
 * f(receiver hardness) and is scaled by the attacker's hardness". Used by
 * glass (crack/shatter) and polystyrene (squash) in place of the raw
 * contact force, so the *same* physical force hits differently depending on
 * who's hitting whom — a steel plank crushes glass/polystyrene far more
 * easily than a wood one, exactly as hard as the numbers say and nothing
 * more.
 */
export function damageFactor(attackerHardness: number, receiverHardness: number, force: number): number {
  if (force <= 0) return 0;
  const attack = hardnessToAttackMultiplier(attackerHardness);
  const toughness = hardnessToToughness(receiverHardness);
  return (force * attack) / toughness;
}
