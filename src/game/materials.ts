// Material definitions — the only place physics/feel/glass values are tuned.
// See docs/GDD.md §2 for the design intent behind these numbers.

export type MaterialId = 'wood' | 'stone' | 'jelly' | 'glass';

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

export interface Material {
  id: MaterialId;
  physics: MaterialPhysics;
  colors: MaterialColors;
  feel: MaterialFeel;
  /** only meaningful for id === 'glass', but present on every entry so code
   *  can read `MATERIALS[id].glass` without a type guard when it only cares
   *  about glass. Non-glass materials carry the same numbers unused. */
  glass: GlassParams;
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
  },
  jelly: {
    id: 'jelly',
    physics: {
      density: 0.9,
      friction: 0.9,
      restitution: 0.55,
      linearDamping: 0.02,
      angularDamping: 0.02,
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
  },
};

export const MATERIAL_IDS: MaterialId[] = ['wood', 'stone', 'jelly', 'glass'];

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
  for (const id of MATERIAL_IDS) {
    const m = MATERIALS[id];
    clone[id] = {
      id: m.id,
      physics: { ...m.physics },
      colors: { ...m.colors },
      feel: { ...m.feel, vibrate: [...m.feel.vibrate] },
      glass: { ...m.glass },
    };
  }
  return clone;
}
