// Owns the freeze special block's whole lifecycle (GDD §2.1): detecting a
// falling freeze piece's first contact, probing the surface below it,
// building the compound "flat top" ice body (src/game/freeze.ts does the
// pure fill math), gluing it to whatever it touches, and melting it away.
// Kept out of PieceManager to stay under the file-length rule; it reaches
// into PieceManager's rapierWorld/pieces/materials directly rather than
// duplicating a parallel API surface.

import RAPIER from '@dimforge/rapier2d-compat';
import Phaser from 'phaser';
import { PX_PER_M } from '../physics/physics';
import type { Material, MaterialId } from '../game/materials';
import { computeFreezeFill, freezeTopFlatness, type FreezeStrip } from '../game/freeze';
import { drawFreezeIce } from '../ui/pieceView';
import { fxFreezeSplash, fxFreezeSolidify, fxFreezeCrack } from '../fx';
import type { PieceManager, PieceRuntime } from './PieceManager';

/** Columns the surface is probed at across the falling piece's width (GDD: ~10-12). */
const FREEZE_COLUMNS = 11;
const RAYCAST_MAX_M = 15;
/** Discrete shrink/joint-release steps spread over meltDurationS (cheap, per the task spec). */
const MELT_STEPS = 4;
/**
 * A freshly built compound ice body sits exactly flush against whatever it
 * lands on (strip bottoms == raycast hit points), and Rapier reports a large
 * one-step contact-force spike the instant those brand-new colliders are
 * registered and any hairline overlap is resolved — well above a normal
 * resting support force. Ignoring joint-break checks for this long after
 * freezing avoids that pop-in spike snapping every glue joint immediately.
 */
const GLUE_GRACE_PERIOD_S = 0.3;

/**
 * A freshly built compound ice body is several independently-sized box
 * colliders bolted together, possibly glued at only one or two points along
 * an uneven tower — nowhere near enough contact points on its own to resist
 * every torque, so simply relying on friction/contacts to keep it level
 * lets it settle into a small permanent tilt. It stays rotation-locked for
 * at least this long after freezing (covering the settle spike from
 * GLUE_GRACE_PERIOD_S), and beyond that for as long as it's still glued to
 * anything (see update()) — a solid block welded to its neighbours has no
 * business rotating independently of them. Rotation is handed back once it
 * has lost every glue joint (broken by an overload impact, or melted away),
 * so it still reacts normally as free debris from then on.
 */
const ROTATION_LOCK_S = 0.5;

export type FreezePhase = 'falling' | 'frozen' | 'melted';

export interface FreezeGlueJoint {
  joint: RAPIER.ImpulseJoint;
  /** the glued piece's primary collider handle, used to read this frame's impact force on it. */
  otherColliderHandle: number;
}

export interface FreezeRuntimeState {
  phase: FreezePhase;
  /** seconds since this piece finished freezing solid. */
  ageS: number;
  joints: FreezeGlueJoint[];
  meltStepsDone: number;
  /** true while rotation is locked right after freezing (see ROTATION_LOCK_S). */
  rotationLocked: boolean;
  /** the compound body's origin in world meters, fixed for this piece's lifetime. */
  originXM: number;
  originYM: number;
  /** strips as originally computed (world meters, pre-shrink) — melt rebuilds colliders/graphics from these. */
  baseStrips: FreezeStrip[];
}

export class FreezeController {
  private activeIcePieces = new Set<PieceRuntime>();
  private lastStrips: FreezeStrip[] = [];

  constructor(
    private pm: PieceManager,
    private scene: Phaser.Scene,
    private materials: Record<MaterialId, Material>,
  ) {}

  /** Total glue joints across every currently frozen piece (test hook). */
  jointCount(): number {
    let n = 0;
    for (const piece of this.activeIcePieces) n += piece.freeze?.joints.length ?? 0;
    return n;
  }

  /** max(top)-min(top) of the last freeze's strips; ~0 means a flat top line (test hook). */
  topFlatness(): number {
    return freezeTopFlatness(this.lastStrips);
  }

  /** Largest |rotation| in degrees across every currently frozen ice piece; 0 if none (test hook). */
  freezeAngleDeg(): number {
    let maxDeg = 0;
    for (const piece of this.activeIcePieces) {
      const deg = Math.abs((piece.body.rotation() * 180) / Math.PI);
      if (deg > maxDeg) maxDeg = deg;
    }
    return maxDeg;
  }

  reset(): void {
    this.activeIcePieces.clear();
    this.lastStrips = [];
  }

  /**
   * Converts a falling freeze piece to a frozen compound ice body, the
   * instant it first touches anything. Probes the surface below it at
   * FREEZE_COLUMNS columns, fills to a flat line (game/freeze.ts), builds
   * one dynamic body with one box collider per strip, glues it to whatever
   * it now overlaps, and plays the landing/freezing feel.
   */
  freezePiece(fallingPiece: PieceRuntime): void {
    if (!fallingPiece.freeze || fallingPiece.freeze.phase !== 'falling') return;
    fallingPiece.freeze.phase = 'frozen'; // mark immediately: never process this falling piece twice

    fxFreezeSplash(fallingPiece.container.x, fallingPiece.container.y);

    const bodyPos = fallingPiece.body.translation();
    const x0 = bodyPos.x - fallingPiece.halfWM;
    const x1 = bodyPos.x + fallingPiece.halfWM;
    const fromYM = bodyPos.y - fallingPiece.halfHM - 0.05;

    const surfaceYs: number[] = [];
    for (let i = 0; i < FREEZE_COLUMNS; i++) {
      const t = (i + 0.5) / FREEZE_COLUMNS;
      const xM = x0 + (x1 - x0) * t;
      const hitY = this.pm.rapierWorld.castRayDown(xM, fromYM, RAYCAST_MAX_M, fallingPiece.body);
      // Nothing hit (shouldn't happen — the platform is always below) falls
      // back to a slab resting right where the piece already is.
      surfaceYs.push(hitY ?? bodyPos.y + fallingPiece.halfHM);
    }

    const freezeParams = this.materials.freeze.freeze;
    const { strips, topY } = computeFreezeFill(x0, x1, surfaceYs, freezeParams.volume);
    this.lastStrips = strips;

    // Remove the falling water-blob body/piece — it's replaced entirely by
    // the new compound ice body below.
    this.pm.rapierWorld.removeBody(fallingPiece.body);
    this.pm.pieces.delete(fallingPiece.collider.handle);
    fallingPiece.container.destroy();

    if (strips.length === 0) return; // nothing to fill onto (degenerate landing range)

    let maxBottom = -Infinity;
    for (const s of strips) maxBottom = Math.max(maxBottom, s.bottom);
    const originXM = (x0 + x1) / 2;
    const originYM = topY;

    const iceMaterial = this.materials.freeze;
    const body = this.pm.rapierWorld.createDynamicBody(originXM, originYM);
    // Hold it level through the settle spike (see ROTATION_LOCK_S); update()
    // unlocks it again once that's passed.
    body.lockRotations(true, true);
    const colliders: RAPIER.Collider[] = [];
    for (const s of strips) {
      const localX = s.xCenter - originXM;
      const localY = (s.top + s.bottom) / 2 - originYM;
      colliders.push(this.pm.rapierWorld.addBoxCollider(body, iceMaterial, localX, localY, s.width / 2, (s.bottom - s.top) / 2));
    }

    const wPx = (x1 - x0) * PX_PER_M;
    const hPx = (maxBottom - topY) * PX_PER_M;
    const graphics = this.scene.add.graphics();
    drawFreezeIce(graphics, strips, originXM, originYM, iceMaterial.freeze.iceColors);
    const container = this.scene.add.container(originXM * PX_PER_M, originYM * PX_PER_M, [graphics]);

    const icePiece: PieceRuntime = {
      id: this.pm.allocatePieceId(),
      material: 'freeze',
      body,
      collider: colliders[0],
      container,
      graphics,
      halfWM: (x1 - x0) / 2,
      halfHM: (maxBottom - topY) / 2,
      // The compound body's origin (originYM) IS its flat top line, not its
      // center (unlike a normal piece's symmetric collider) — see
      // PieceRuntime.topOffsetM.
      topOffsetM: 0,
      wPx,
      hPx,
      glassState: null,
      jellySpring: null,
      lastImpactAt: 0,
      freeze: { phase: 'frozen', ageS: 0, joints: [], meltStepsDone: 0, rotationLocked: true, originXM, originYM, baseStrips: strips },
      extraColliderHandles: colliders.slice(1).map((c) => c.handle),
    };
    for (const c of colliders) this.pm.pieces.set(c.handle, icePiece);
    this.activeIcePieces.add(icePiece);

    fxFreezeSolidify(container.x, container.y, wPx);
    this.glue(icePiece, x0, x1, topY, maxBottom);
  }

  /**
   * Creates a fixed joint between `icePiece` and every other piece whose
   * collider AABB overlaps the ice's bounding box within a 0.05m margin,
   * anchored so the current relative pose is preserved exactly.
   */
  private glue(icePiece: PieceRuntime, x0: number, x1: number, topY: number, maxBottom: number): void {
    const marginM = 0.05;
    const cx = (x0 + x1) / 2;
    const cy = (topY + maxBottom) / 2;
    const halfW = (x1 - x0) / 2;
    const halfH = (maxBottom - topY) / 2;
    const candidates = this.pm.rapierWorld.collidersOverlappingBox(cx, cy, halfW, halfH, marginM);

    const gluedIds = new Set<number>();
    for (const collider of candidates) {
      const other = this.pm.pieces.get(collider.handle);
      if (!other || other === icePiece || gluedIds.has(other.id)) continue;
      gluedIds.add(other.id);
      this.createGlueJoint(icePiece, other);
    }
  }

  private createGlueJoint(icePiece: PieceRuntime, other: PieceRuntime): void {
    if (!icePiece.freeze) return;
    const iceOrigin = icePiece.body.translation();
    const iceAngle = icePiece.body.rotation();
    const otherOrigin = other.body.translation();
    const otherAngle = other.body.rotation();

    // anchor1 (ice-local) = otherOrigin expressed in the ice body's local
    // frame; anchor2 = other body's own origin; frame1 = the relative
    // rotation that keeps both bodies' current world orientation — together
    // this preserves the exact relative pose at glue time.
    const dx = otherOrigin.x - iceOrigin.x;
    const dy = otherOrigin.y - iceOrigin.y;
    const cos = Math.cos(-iceAngle);
    const sin = Math.sin(-iceAngle);
    const anchor1 = { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    const frame1 = otherAngle - iceAngle;

    const jointData = RAPIER.JointData.fixed(anchor1, frame1, { x: 0, y: 0 }, 0);
    const joint = this.pm.rapierWorld.createImpulseJoint(jointData, icePiece.body, other.body);
    // The ice's strip colliders sit flush against `other` (zero clearance by
    // construction), so its ordinary contact constraint and this fixed joint
    // would otherwise fight over the exact same surface and blow up into a
    // huge spurious "impact" force every step — let the joint alone hold the
    // glued pose, and read real impacts from the *other* neighbours/floor
    // `other` is still touching normally.
    joint.setContactsEnabled(false);
    icePiece.freeze.joints.push({ joint, otherColliderHandle: other.collider.handle });
  }

  /** Removes every glue joint this piece has (does not touch its colliders/body). */
  releaseJoints(piece: PieceRuntime): void {
    if (!piece.freeze) return;
    for (const gj of piece.freeze.joints) this.pm.rapierWorld.removeImpulseJoint(gj.joint);
    piece.freeze.joints = [];
    this.activeIcePieces.delete(piece);
  }

  /**
   * Root cause of the "everything disappears" crash: removing a rigid body
   * in Rapier also removes every impulse joint attached to it, on BOTH
   * ends — but only the ice side of a glue joint keeps a JS reference to it
   * (icePiece.freeze.joints). If the *other*, non-ice piece it's glued to
   * gets destroyed first (falls off the platform, glass shatters, …), that
   * reference goes stale the moment PieceManager removes its body: Rapier
   * has already forgotten the joint, but FreezeController hasn't, and the
   * next time melt or a force-break walks that piece's joints and calls
   * removeImpulseJoint() on it, that's a stale handle.
   *
   * PieceManager.destroy() must call this for *every* piece it's about to
   * remove (not just frozen ones — the removed piece is usually the glued
   * *other* side, not the ice), and before the body actually goes, so the
   * joint is still valid to explicitly remove and forget here.
   */
  purgeJointsTo(removedPiece: PieceRuntime): void {
    const handles = new Set<number>([removedPiece.collider.handle, ...removedPiece.extraColliderHandles]);
    for (const icePiece of this.activeIcePieces) {
      if (icePiece === removedPiece || !icePiece.freeze) continue;
      for (let i = icePiece.freeze.joints.length - 1; i >= 0; i--) {
        const gj = icePiece.freeze.joints[i];
        if (handles.has(gj.otherColliderHandle)) {
          this.pm.rapierWorld.removeImpulseJoint(gj.joint);
          icePiece.freeze.joints.splice(i, 1);
        }
      }
    }
  }

  /** Per-frame upkeep for every frozen ice piece: break overloaded glue joints, advance melt. */
  update(dt: number, frameForce: Map<number, number>): void {
    const breakForce = this.materials.freeze.freeze.glueBreakForce;
    for (const piece of this.activeIcePieces) {
      if (!piece.freeze) continue;
      piece.freeze.ageS += dt;
      if (piece.freeze.ageS >= GLUE_GRACE_PERIOD_S) {
        for (let i = piece.freeze.joints.length - 1; i >= 0; i--) {
          const gj = piece.freeze.joints[i];
          const force = frameForce.get(gj.otherColliderHandle) ?? 0;
          if (force >= breakForce) {
            this.pm.rapierWorld.removeImpulseJoint(gj.joint);
            piece.freeze.joints.splice(i, 1);
            fxFreezeCrack(piece.container.x, piece.container.y);
          }
        }
      }
      // See ROTATION_LOCK_S: locked for at least that long, and for as long
      // after that as it's still glued to something.
      if (piece.freeze.rotationLocked && piece.freeze.ageS >= ROTATION_LOCK_S && piece.freeze.joints.length === 0) {
        piece.body.lockRotations(false, true);
        piece.freeze.rotationLocked = false;
      }
      this.updateMelt(piece);
    }
  }

  private updateMelt(piece: PieceRuntime): void {
    const f = piece.freeze;
    if (!f || f.phase === 'melted') return;
    const params = this.materials.freeze.freeze;
    if (f.ageS < params.meltStartS) return;
    const elapsed = f.ageS - params.meltStartS;
    const progress = Math.min(1, elapsed / params.meltDurationS);
    const targetStep = Math.min(MELT_STEPS, Math.floor(progress * MELT_STEPS + 1e-6));
    while (f.meltStepsDone < targetStep) {
      f.meltStepsDone++;
      this.applyMeltStep(piece);
    }
  }

  /** One discrete melt step: shrinks colliders+graphics toward the block's fill-origin and drops one glue joint. */
  private applyMeltStep(piece: PieceRuntime): void {
    const f = piece.freeze;
    if (!f) return;
    const params = this.materials.freeze.freeze;
    const scale = 1 - params.shrinkFraction * (f.meltStepsDone / MELT_STEPS);

    this.pm.pieces.delete(piece.collider.handle);
    for (const h of piece.extraColliderHandles) this.pm.pieces.delete(h);
    const oldColliderCount = piece.body.numColliders();
    const oldColliders: RAPIER.Collider[] = [];
    for (let i = 0; i < oldColliderCount; i++) oldColliders.push(piece.body.collider(i));
    for (const c of oldColliders) this.pm.rapierWorld.removeCollider(c);

    const iceMaterial = this.materials.freeze;
    const newColliders: RAPIER.Collider[] = [];
    const scaledStrips: FreezeStrip[] = [];
    for (const s of f.baseStrips) {
      const localX = (s.xCenter - f.originXM) * scale;
      const localTop = (s.top - f.originYM) * scale;
      const localBottom = (s.bottom - f.originYM) * scale;
      const width = s.width * scale;
      const halfH = (localBottom - localTop) / 2;
      if (halfH <= 0 || width <= 0) continue;
      newColliders.push(this.pm.rapierWorld.addBoxCollider(piece.body, iceMaterial, localX, localTop + halfH, width / 2, halfH));
      scaledStrips.push({ xCenter: f.originXM + localX, width, top: f.originYM + localTop, bottom: f.originYM + localBottom });
    }
    if (f.meltStepsDone >= MELT_STEPS) {
      // Final melt step: remove the ice piece entirely via the normal piece-removal
      // path, which already purges joints and doesn't count as a lost heart.
      f.phase = 'melted';
      this.pm.removePiece(piece);
      return;
    }
    if (newColliders.length === 0) {
      // No colliders could be built (degenerate shrink), but not final step yet.
      return;
    }
    piece.collider = newColliders[0];
    piece.extraColliderHandles = newColliders.slice(1).map((c) => c.handle);
    for (const c of newColliders) this.pm.pieces.set(c.handle, piece);

    drawFreezeIce(piece.graphics, scaledStrips, f.originXM, f.originYM, iceMaterial.freeze.iceColors);

    if (f.joints.length > 0) {
      const gj = f.joints.shift();
      if (gj) this.pm.rapierWorld.removeImpulseJoint(gj.joint);
    }
  }
}
