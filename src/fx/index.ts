// Wires the feel pipeline (audio + haptics + effects) into the game's
// onImpact / crack / shatter hooks. GameScene binds an Effects instance once
// per scene; audio/haptics are plain module singletons.

import { MATERIALS, type MaterialId } from '../game/materials';
import { Effects } from './effects';
import {
  ensureAudioContext,
  playImpactSound,
  playGlassCrackSound,
  playGlassShatterSound,
  playSplashSound,
  playFreezeCrackleSound,
  playFreezeCrackSound,
  playSquashSound,
  playMunchSound,
  setMuted as setAudioMuted,
  isMuted as isAudioMuted,
} from './audio';
import { vibrate, setVibrationEnabled, isVibrationEnabled } from './haptics';
import { impactToHaptic } from './mapping';

export { setVibrationEnabled, isVibrationEnabled };

/** Impact force (N) above which an impact counts as "big" for hit-stop/droplets. Matches glass's breakForce-level threshold from materials.ts. */
const BIG_IMPACT_FORCE = MATERIALS.glass.glass.breakForce;
const HIT_STOP_MS = 40;
/** Steel's own, shorter hit-stop on ordinary landings (see fx()) — GDD §2.0 designer feedback: "short hit-stop". */
const STEEL_HIT_STOP_MS = 25;

let effects: Effects | null = null;

/** GameScene calls this once after creating its Effects instance. */
export function bindEffects(e: Effects): void {
  effects = e;
}

/**
 * Global safety net on top of PieceManager's per-piece impact gating
 * (velocity threshold + 250ms cooldown, see PieceManager.ts): even with
 * that, several *different* pieces landing/wobbling in the same window
 * (e.g. a handful of jellies settling together) could each fire fx() within
 * the same second. Caps actual impact fx (sound/haptic/effects) at
 * MAX_IMPACT_FX_PER_SEC — extra impacts in the same rolling second are
 * silently dropped rather than queued.
 */
const MAX_IMPACT_FX_PER_SEC = 6;
const impactFxTimestamps: number[] = [];
let impactFxCount = 0; // cumulative, for the fxImpactCount() test hook

function impactFxBudgetAvailable(): boolean {
  const now = performance.now();
  while (impactFxTimestamps.length > 0 && now - impactFxTimestamps[0] >= 1000) impactFxTimestamps.shift();
  if (impactFxTimestamps.length >= MAX_IMPACT_FX_PER_SEC) return false;
  impactFxTimestamps.push(now);
  return true;
}

/** Cumulative count of impact fx actually fired since load/reset (test hook). */
export function getImpactFxCount(): number {
  return impactFxCount;
}

/** Resets the fxImpactCount() counter (test hook, for measuring a fresh window). */
export function resetImpactFxCount(): void {
  impactFxCount = 0;
  impactFxTimestamps.length = 0;
}

/** Call from inside a user-gesture handler (pointerdown/keydown) so WebAudio can start. */
export function initFxGesture(): void {
  ensureAudioContext();
}

export function setMuted(m: boolean): void {
  setAudioMuted(m);
}

export function isMuted(): boolean {
  return isAudioMuted();
}

/** Advances pooled particle motion; call once per rendered frame with real dt. */
export function updateEffects(dtSeconds: number): void {
  effects?.update(dtSeconds);
}

/** Returns the slice of dt physics should step by this frame (0 while hit-stopped). */
export function consumeHitStopDt(dtSeconds: number): number {
  return effects ? effects.consumeDt(dtSeconds) : dtSeconds;
}

/** Main per-contact hook: sound, haptic, and material-appropriate small effects. */
export function fx(
  pieceMaterial: MaterialId,
  _otherMaterial: MaterialId | null,
  force: number,
  xPx: number,
  yPx: number,
): void {
  if (!impactFxBudgetAvailable()) return;
  impactFxCount++;
  playImpactSound(pieceMaterial, force);

  const material = MATERIALS[pieceMaterial];
  const hapticScale = impactToHaptic(force);
  if (hapticScale > 0) {
    vibrate(material.feel.vibrate.map((ms) => Math.max(1, Math.round(ms * hapticScale))));
  }

  if (effects) {
    if (pieceMaterial === 'stone') effects.dust(xPx, yPx, 8, material.colors.stroke);
    else if (pieceMaterial === 'wood') effects.dust(xPx, yPx, 4, material.colors.stroke);
    // Small dust/sparks on every solid steel landing (designer feedback
    // round), not just the biggest impacts — a bright, hot-metal color
    // rather than steel's own grey.
    else if (pieceMaterial === 'steel') effects.dust(xPx, yPx, 5, 0xffd27f);

    if (material.feel.shake > 0) {
      effects.shake(material.feel.shake * Math.min(1, force / (BIG_IMPACT_FORCE * 1.2)));
    }

    if (force >= BIG_IMPACT_FORCE) {
      effects.hitStop(HIT_STOP_MS);
      if (pieceMaterial === 'jelly') effects.droplets(xPx, yPx);
    } else if (pieceMaterial === 'steel') {
      // Steel gets its own short hit-stop on ordinary landings too (GDD
      // §2.0 designer feedback: "short hit-stop") — falling hard and fast
      // means it can land well under BIG_IMPACT_FORCE (glass's
      // breakForce) and still deserve the heavier, punchier feel.
      effects.hitStop(STEEL_HIT_STOP_MS);
    }
  }
}

/** Called once when a glass piece transitions to cracked. */
export function fxGlassCrack(_xPx: number, _yPx: number): void {
  playGlassCrackSound();
  vibrate([10]);
}

/** Called once when a piece (glass) shatters. */
export function fxGlassShatter(xPx: number, yPx: number, color: number): void {
  playGlassShatterSound();
  vibrate(MATERIALS.glass.feel.vibrate);
  effects?.shatter(xPx, yPx, color);
  effects?.hitStop(HIT_STOP_MS);
}

/** Called once a falling freeze piece first touches something and starts converting to ice. */
export function fxFreezeSplash(xPx: number, yPx: number): void {
  playSplashSound();
  effects?.dust(xPx, yPx, 6, MATERIALS.freeze.colors.fill);
}

/** Called once the freeze piece's compound ice body is built (the ~0.3s "freezing" beat). */
export function fxFreezeSolidify(xPx: number, yPx: number, spreadPx: number): void {
  playFreezeCrackleSound();
  vibrate(MATERIALS.freeze.feel.vibrate);
  effects?.frost(xPx, yPx, spreadPx, MATERIALS.freeze.freeze.iceColors.fill);
  effects?.flashScreen(0.25, 220);
}

/** Called each time a glue joint between the ice and a neighbouring piece snaps. */
export function fxFreezeCrack(xPx: number, yPx: number): void {
  playFreezeCrackSound();
  vibrate([10]);
  effects?.frost(xPx, yPx, 20, MATERIALS.freeze.freeze.iceColors.fill);
}

/** Called each time a polystyrene piece compresses one squash step (GDD §2.0). */
export function fxSquash(xPx: number, yPx: number): void {
  playSquashSound();
  vibrate([12]);
  effects?.dust(xPx, yPx, 3, MATERIALS.polystyrene.colors.stroke);
}

/** Called each time a wormy wood piece shrinks one step (GDD §2.0 — quiet munching sound + tiny haptic). */
export function fxMunch(xPx: number, yPx: number): void {
  playMunchSound();
  vibrate([6]);
  effects?.dust(xPx, yPx, 2, MATERIALS.wood.colors.stroke);
}
