// Material definitions — the only place physics/feel/glass values are tuned.
// See docs/GDD.md §2 for the design intent behind these numbers.

export type MaterialId = 'wood' | 'stone' | 'jelly' | 'glass' | 'freeze';

export interface MaterialPhysics {
  /** kg / m^2 (Rapier 2D uses area density) */
  density: number;
  friction: number;
  restitution: number;
  linearDamping: number;
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

export interface Material {
  id: MaterialId;
  physics: MaterialPhysics;
  colors: MaterialColors;
  feel: MaterialFeel;
  /** only meaningful for id === 'glass', but present on every entry so code
   *  can read `MATERIALS[id].glass` without a type guard when it only cares
   *  about glass. Non-glass materials carry the same numbers unused. */
  glass: GlassParams;
  /** only meaningful for id === 'freeze', see FreezeParams. */
  freeze: FreezeParams;
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
 * Measured (glass plank in every case):
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
 * Chosen thresholds (comfortably separate all four cases):
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

export const MATERIALS: Record<MaterialId, Material> = {
  wood: {
    id: 'wood',
    physics: {
      density: 0.8,
      friction: 0.6,
      restitution: 0.1,
      linearDamping: 0.05,
      angularDamping: 0.05,
    },
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
    freeze: FREEZE_PARAMS,
  },
  stone: {
    id: 'stone',
    physics: {
      density: 2.6,
      friction: 0.8,
      restitution: 0.02,
      linearDamping: 0.1,
      angularDamping: 0.1,
    },
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
    freeze: FREEZE_PARAMS,
  },
  jelly: {
    id: 'jelly',
    physics: {
      density: 0.9,
      friction: 0.9,
      restitution: 0.55,
      // Much higher than the other materials (0.02): a high-restitution body
      // left undamped keeps re-energizing itself on every tiny resting
      // micro-bounce against a neighbour (worst with several jellies stacked
      // together) and never reaches Rapier's sleep threshold. This damping
      // only bleeds velocity *between* bounces — the squash/wobble visual
      // and the sound/haptic on a real impact are untouched — but lets a
      // jelly pile actually settle and sleep within a few seconds instead of
      // jittering (and re-triggering fx) indefinitely. See PieceManager's
      // IMPACT_MIN_SPEED_MPS for the other half of that fix.
      linearDamping: 0.4,
      angularDamping: 0.4,
    },
    colors: {
      fill: 0xff6fb1,
      stroke: 0xd1408a,
    },
    feel: {
      sound: 'jelly',
      vibrate: [15, 30, 15],
      shake: 0.1,
    },
    glass: GLASS_PARAMS,
    freeze: FREEZE_PARAMS,
  },
  glass: {
    id: 'glass',
    physics: {
      density: 1.5,
      friction: 0.25,
      restitution: 0.15,
      linearDamping: 0.02,
      angularDamping: 0.02,
    },
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
    freeze: FREEZE_PARAMS,
  },
  freeze: {
    id: 'freeze',
    physics: {
      density: 0.9,
      friction: 0.5,
      restitution: 0,
      linearDamping: 0.02,
      angularDamping: 0.02,
    },
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
    freeze: FREEZE_PARAMS,
  },
};

/** Ids in the normal random hook rotation. `freeze` is deliberately excluded
 *  here (GDD §2.1: spawned ~1 in 10 pieces, never as a plain rotation slot)
 *  — see ALL_MATERIAL_IDS for the full set including it. */
export const MATERIAL_IDS: MaterialId[] = ['wood', 'stone', 'jelly', 'glass'];

/** Every material id, including the freeze special. */
export const ALL_MATERIAL_IDS: MaterialId[] = [...MATERIAL_IDS, 'freeze'];

/** Base plank shape, meters. */
export const PLANK_SIZE = { width: 2.0, height: 0.6 };

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
      physics: { ...m.physics },
      colors: { ...m.colors },
      feel: { ...m.feel, vibrate: [...m.feel.vibrate] },
      glass: { ...m.glass },
      freeze: { ...m.freeze, iceColors: { ...m.freeze.iceColors } },
    };
  }
  return clone;
}
