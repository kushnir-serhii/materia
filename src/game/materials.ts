// Material definitions — the only place physics/feel/glass values are tuned.
// See docs/GDD.md §2 for the design intent behind these numbers.
//
// Every material's Rapier physics values are DERIVED from a small set of
// designer-facing properties (GDD §2.0: Weight, Hardness, Grip, Bounce, Air
// drag, each 0-10) via the pure, monotonic mapping functions in props.ts —
// see physicsFromProps() below. Physics values are never hand-edited here
// directly any more; to change a material's feel, change its props.

import {
  type MaterialProps,
  weightToDensity,
  gripToFriction,
  bounceToRestitution,
  bounceToRestingDamping,
  airDragToExtraDamping,
} from './props';
import type { SquashParams } from './squash';

export type MaterialId = 'wood' | 'stone' | 'jelly' | 'glass' | 'steel' | 'polystyrene' | 'cardboard' | 'freeze';

export interface MaterialPhysics {
  /** kg / m^2 (Rapier 2D uses area density) */
  density: number;
  friction: number;
  restitution: number;
  /** applied while a piece is airborne (before its first contact) — see PieceManager's airborne/resting damping switch. Equals restingLinearDamping + props.ts's airDragToExtraDamping(airDrag), so an airDrag=0 material (every material that existed before props.ts) falls exactly as it always did. */
  airborneLinearDamping: number;
  /** applied once a piece has landed/is resting — this is what the pre-props system's single `linearDamping` used to mean. */
  restingLinearDamping: number;
  angularDamping: number;
}

export interface MaterialColors {
  /** hex fill color, e.g. 0x8a5a34 */
  fill: number;
  /** hex stroke/outline color */
  stroke: number;
}

export interface MaterialFeel {
  /** id used by src/fx/audio.ts to pick a synth voice */
  sound: string;
  /** navigator.vibrate() pattern in ms, e.g. [15, 30, 15] */
  vibrate: number[];
  /** 0..1, relative camera-shake strength on impact */
  shake: number;
}

/**
 * Glass-only breakage tuning. Forces are in Newtons as reported by Rapier's
 * CONTACT_FORCE_EVENTS on a 2.0x0.6m plank (see measurement notes below).
 *
 * - impact (a force spike above baseline) >= breakForce -> shatter immediately
 * - impact >= crackForce (and < breakForce) -> crack (a second such impact while
 *   already cracked -> shatter)
 * - load (a *sustained* contact force, not a spike) >= loadLimit continuously
 *   for loadTime seconds -> shatter, regardless of impact history
 *
 * Forces glass is checked against are first passed through props.ts's
 * damageFactor(attackerHardness, glass.props.hardness, rawForce) — see
 * PieceManager — so these thresholds are unchanged ("stay as measured") but
 * a harder attacker (steel) crosses them at a much lower raw force than a
 * softer one (jelly), without glass.ts itself knowing about materials at
 * all.
 */
export interface GlassParams {
  crackForce: number;
  breakForce: number;
  loadLimit: number;
  /** seconds the load must be sustained before it shatters the glass */
  loadTime: number;
}

/**
 * Freeze-only tuning (GDD §2.1). Like `GlassParams`, present on every
 * material entry (non-freeze materials just carry FREEZE_PARAMS unused) so
 * code can read `MATERIALS[id].freeze` without a type guard.
 */
export interface FreezeParams {
  /** target fill volume in m^2 (2D "area"), see GDD §2.1 (≈ plank area). */
  volume: number;
  /** seconds after freezing before glue joints start weakening. */
  meltStartS: number;
  /** seconds over which joints are removed and the ice shrinks. */
  meltDurationS: number;
  /** fraction (0..1) the ice's linear size shrinks by once fully melted. */
  shrinkFraction: number;
  /** impact force (N) on a glued piece that breaks its joint to the ice. */
  glueBreakForce: number;
  /** pale icy look once frozen (colors.fill/stroke are the pre-freeze water blob look). */
  iceColors: MaterialColors;
}

/** Plank shape, meters. Every material shares PLANK_SIZE (2.0 x 0.6 m — cardboard included, per designer feedback: "normal box/plank size, not a thin sheet"). */
export interface MaterialSize {
  width: number;
  height: number;
}

export interface Material {
  id: MaterialId;
  props: MaterialProps;
  physics: MaterialPhysics;
  size: MaterialSize;
  colors: MaterialColors;
  feel: MaterialFeel;
  /** only meaningful for id === 'glass', but present on every entry so code
   *  can read `MATERIALS[id].glass` without a type guard when it only cares
   *  about glass. Non-glass materials carry the same numbers unused. */
  glass: GlassParams;
  /** only meaningful for id === 'polystyrene' — see squash.ts. Present on every entry for the same reason as `glass`. */
  squash: SquashParams;
  /** only meaningful for id === 'freeze', see FreezeParams. */
  freeze: FreezeParams;
}

/** Base plank shape, meters. */
export const PLANK_SIZE: MaterialSize = { width: 2.0, height: 0.6 };

/**
 * Turns a material's designer-facing props into its Rapier physics values —
 * the single place density/friction/restitution/damping are computed. See
 * props.ts for the (monotonic, unit-tested) mapping functions themselves.
 */
function physicsFromProps(props: MaterialProps): MaterialPhysics {
  const restingLinearDamping = bounceToRestingDamping(props.bounce);
  return {
    density: weightToDensity(props.weight),
    friction: gripToFriction(props.grip),
    restitution: bounceToRestitution(props.bounce),
    restingLinearDamping,
    // A bouncier material also gets a touch more angular damping for the
    // same anti-jitter reason as its resting linear damping (see
    // props.ts's bounceToRestingDamping doc).
    angularDamping: restingLinearDamping,
    airborneLinearDamping: restingLinearDamping + airDragToExtraDamping(props.airDrag),
  };
}

/*
 * Force thresholds below were measured with a small Rapier-only script
 * (node, no Phaser/DOM) using this world setup:
 *   - gravity (0, +9.81) m/s^2, y-down, PX_PER_M = 50 (see physics.ts)
 *   - static platform, plank collider 2.0x0.6m (half-extents 1.0x0.3)
 *   - density/friction/restitution below, CONTACT_FORCE_EVENTS threshold 0.5N
 *   - forces read from TempContactForceEvent.totalForceMagnitude() on the
 *     glass collider only, over a 2-3s simulation at 1/60s fixed step
 *
 * Measured (glass plank in every case, wood/stone attacker — i.e. before
 * props.ts's damageFactor scaling, which is applied on top at the call
 * site and cancels out to ~1x for a wood-hardness attacker on glass):
 *   A. glass resting under 1 wood plank (no drop, just settling): peak ~34 N,
 *      steady-state (post-settle, pre-sleep) support force ~34 N.
 *      -> MUST NOT crack or shatter.
 *   B. glass under 2 stacked stone planks (no drop): peak ~113 N during
 *      settling, steady-state support ~99 N.
 *      -> MUST shatter by sustained load, but NOT instantly on the settle
 *         spike (113 N must stay under crackForce).
 *   C. a wood plank dropped from 3m above the glass: impact peak ~553 N.
 *      -> MUST crack, must NOT shatter from this single hit.
 *   D. a stone plank dropped from 3m above the glass: impact peak ~1932 N.
 *      -> MUST shatter immediately.
 *
 * Chosen thresholds (comfortably separate all four cases; stay as measured
 * per the round-8 task — only the *force* they're compared against changed,
 * via damageFactor, not these numbers):
 *   crackForce = 300 N   (113 < 300 < 553: only the wood drop cracks it)
 *   breakForce = 1000 N  (553 < 1000 < 1932: only the stone drop shatters it)
 *   loadLimit  = 70 N    (34 < 70 < 99: only the 2-stone stack accumulates load)
 *   loadTime   = 0.5 s   (per GDD)
 */
const GLASS_PARAMS: GlassParams = {
  crackForce: 300,
  breakForce: 1000,
  loadLimit: 70,
  loadTime: 0.5,
};

/**
 * Polystyrene-only squash tuning (GDD §2.0/§2). `force` stepSquash sees is
 * already damage-scaled (props.ts's damageFactor, attacker hardness vs
 * polystyrene's own H2 toughness — see PieceManager), so these numbers sit
 * in roughly the same range as glass's thresholds above rather than needing
 * their own separate physical-force measurement: a resting wood/jelly plank
 * stays well under loadLimit indefinitely, a resting stone (or a stack of
 * a few) crosses it within loadTime, and any solid drop-impact (stone
 * especially) advances a step immediately via impactForce.
 */
const POLYSTYRENE_SQUASH_PARAMS: SquashParams = {
  impactForce: 220,
  loadLimit: 85,
  loadTime: 0.35,
};

/**
 * Steel-only: extra gravity while airborne so it visibly drops faster than
 * every other material (GDD §2.0 designer feedback — "falls down HARD and
 * fast"). PieceManager resets a steel piece's Rapier gravityScale back to 1
 * the instant it lands (see landPiece), so it doesn't press down on
 * whatever it's resting on any harder than its weight alone would.
 */
export const STEEL_AIRBORNE_GRAVITY_SCALE = 1.8;

/**
 * Jelly-only shape (GDD §2.0 designer feedback): top edge is this fraction
 * of the bottom edge's width — a trapezoid, not a plain box — with rounded
 * corners. Both the Rapier collider (createDynamicTrapezoid) and the drawn
 * look use these same numbers, so stacking actually reflects the taper.
 */
export const JELLY_TOP_WIDTH_RATIO = 0.85;
export const JELLY_CORNER_RADIUS_M = 0.05;

/*
 * Freeze glue-break force: GDD §2.1 wants it "≈ stone 3 m drop" — measurement
 * D in the glass comment above found a stone plank dropped from 3m hits with
 * a ~1932 N peak, so glueBreakForce sits comfortably under that (a stone
 * drop from height WILL pop the glue) but well above ordinary settling
 * impacts (wood resting ~34N, 2-stone stack settle spike ~113N).
 */
const FREEZE_PARAMS: FreezeParams = {
  volume: 1.2, // ~= PLANK_SIZE.width * PLANK_SIZE.height
  // Whole block melts within 1 minute (GDD §2.1): glue starts weakening at
  // 30s, fully gone/unglued by 30+30 = 60s.
  meltStartS: 30,
  meltDurationS: 30,
  shrinkFraction: 0.3,
  glueBreakForce: 1700,
  iceColors: {
    fill: 0xe8f7fb,
    stroke: 0xa9d8e6,
  },
};

/** Props per GDD §2.0's material table — the only per-material "physics tuning" left; everything in `physics` is derived from these via physicsFromProps(). */
const PROPS: Record<MaterialId, MaterialProps> = {
  wood: { weight: 3, hardness: 5, grip: 6, bounce: 1, airDrag: 0 },
  stone: { weight: 7, hardness: 8, grip: 8, bounce: 0, airDrag: 0 },
  steel: { weight: 10, hardness: 10, grip: 3, bounce: 1, airDrag: 0 },
  jelly: { weight: 3, hardness: 1, grip: 9, bounce: 6, airDrag: 0 },
  glass: { weight: 5, hardness: 3, grip: 3, bounce: 1, airDrag: 0 },
  polystyrene: { weight: 1, hardness: 2, grip: 5, bounce: 2, airDrag: 5 },
  cardboard: { weight: 1, hardness: 2, grip: 6, bounce: 1, airDrag: 5 },
  freeze: { weight: 3, hardness: 6, grip: 5, bounce: 0, airDrag: 0 },
};

export const MATERIALS: Record<MaterialId, Material> = {
  wood: {
    id: 'wood',
    props: PROPS.wood,
    physics: physicsFromProps(PROPS.wood),
    size: PLANK_SIZE,
    colors: {
      fill: 0x8a5a34,
      stroke: 0x5c3a1e,
    },
    feel: {
      sound: 'wood',
      vibrate: [20],
      shake: 0.15,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  stone: {
    id: 'stone',
    props: PROPS.stone,
    physics: physicsFromProps(PROPS.stone),
    size: PLANK_SIZE,
    colors: {
      fill: 0x8c8c8c,
      stroke: 0x555555,
    },
    feel: {
      sound: 'stone',
      vibrate: [45],
      shake: 0.6,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  steel: {
    id: 'steel',
    props: PROPS.steel,
    physics: physicsFromProps(PROPS.steel),
    size: PLANK_SIZE,
    colors: {
      // Brushed grey-blue.
      fill: 0x7b8794,
      stroke: 0x4a5568,
    },
    feel: {
      sound: 'steel',
      // Strong short pulse — designer feedback round: "strong short haptic".
      vibrate: [65],
      // Max shake — GDD: "big camera shake" (materials.test.ts caps shake at 1).
      shake: 1,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  jelly: {
    id: 'jelly',
    props: PROPS.jelly,
    physics: physicsFromProps(PROPS.jelly),
    size: PLANK_SIZE,
    colors: {
      // Green (GDD §2.0 "Looks & living details" — was pink).
      fill: 0x6fd15a,
      stroke: 0x2f8a1e,
    },
    feel: {
      sound: 'jelly',
      vibrate: [15, 30, 15],
      shake: 0.1,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  glass: {
    id: 'glass',
    props: PROPS.glass,
    physics: physicsFromProps(PROPS.glass),
    size: PLANK_SIZE,
    colors: {
      fill: 0xbfe8f0,
      stroke: 0x7fc4d6,
    },
    feel: {
      sound: 'glass',
      vibrate: [10, 20, 60],
      shake: 0.25,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  polystyrene: {
    id: 'polystyrene',
    props: PROPS.polystyrene,
    physics: physicsFromProps(PROPS.polystyrene),
    size: PLANK_SIZE,
    colors: {
      // Bright white with a faint warm-grey line/dot texture (pieceView.ts).
      fill: 0xf5f5f0,
      stroke: 0xc9c9c0,
    },
    feel: {
      sound: 'polystyrene',
      vibrate: [12],
      shake: 0.05,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  cardboard: {
    id: 'cardboard',
    props: PROPS.cardboard,
    physics: physicsFromProps(PROPS.cardboard),
    size: PLANK_SIZE,
    colors: {
      // Kraft-brown cardboard box (pieceView.ts: flap line, tape strip, creases, ink markings).
      fill: 0xc79a63,
      stroke: 0x9a713d,
    },
    feel: {
      sound: 'cardboard',
      vibrate: [10],
      shake: 0,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  freeze: {
    id: 'freeze',
    props: PROPS.freeze,
    physics: physicsFromProps(PROPS.freeze),
    size: PLANK_SIZE,
    // Water-blue translucent while falling/unfrozen; freeze.iceColors is the
    // pale icy look used once it lands and freezes (see FreezeController).
    colors: {
      fill: 0x4fb0ff,
      stroke: 0x2a7fc9,
    },
    feel: {
      sound: 'freeze',
      vibrate: [20, 40, 20],
      shake: 0,
    },
    glass: GLASS_PARAMS,
    squash: POLYSTYRENE_SQUASH_PARAMS,
    freeze: FREEZE_PARAMS,
  },
};

/** Ids in the normal random hook rotation. `freeze` is deliberately excluded
 *  here (GDD §2.1: spawned ~1 in 10 pieces, never as a plain rotation slot)
 *  — see ALL_MATERIAL_IDS for the full set including it. */
export const MATERIAL_IDS: MaterialId[] = ['wood', 'stone', 'jelly', 'glass', 'steel', 'polystyrene', 'cardboard'];

/** Every material id, including the freeze special. */
export const ALL_MATERIAL_IDS: MaterialId[] = [...MATERIAL_IDS, 'freeze'];

/**
 * A deep, independent copy of MATERIALS for the `?debug=1` tuning panel to
 * mutate at runtime. Game code that needs to respect live tuning (spawning,
 * glass thresholds) reads from this copy instead of MATERIALS directly, so
 * dragging a slider never touches the canonical values above.
 */
export function cloneMaterialsForRuntime(): Record<MaterialId, Material> {
  const clone = {} as Record<MaterialId, Material>;
  for (const id of ALL_MATERIAL_IDS) {
    const m = MATERIALS[id];
    clone[id] = {
      id: m.id,
      props: { ...m.props },
      physics: { ...m.physics },
      size: { ...m.size },
      colors: { ...m.colors },
      feel: { ...m.feel, vibrate: [...m.feel.vibrate] },
      glass: { ...m.glass },
      squash: { ...m.squash },
      freeze: { ...m.freeze, iceColors: { ...m.freeze.iceColors } },
    };
  }
  return clone;
}
