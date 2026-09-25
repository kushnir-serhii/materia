// Owns every physics piece's runtime state: spawning, the per-step glass /
// fail-off-platform checks, and syncing Rapier bodies to their Phaser
// containers. Kept out of GameScene to stay under the file-length rule.

import Phaser from 'phaser';
import type RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld, PX_PER_M, type RapierPiece } from '../physics/physics';
import { MATERIALS, PLANK_SIZE, type Material, type MaterialId } from '../game/materials';
import { createGlassPieceState, stepGlass, type GlassPieceState } from '../game/glass';
import { createJellySpring, forceToJellyAmplitude, triggerJellySpring, stepJellySpring, type JellySpringState } from '../game/spring';
import { drawPieceBase, drawCracks } from '../ui/pieceView';
import { fxGlassCrack, fxGlassShatter } from '../fx';
import { FreezeController, type FreezeRuntimeState } from './FreezeController';

const IMPACT_MIN_FORCE = 5;
/**
 * Per-piece fx cooldown (sound/haptic/effects), not physics. Was 80ms —
 * raised to ~250ms (playtest: a handful of jelly pieces wobbling against
 * each other kept re-triggering every ~80ms, spamming sound/vibrate and
 * dropping frames). See also IMPACT_MIN_SPEED below and fx()'s own global
 * rate limit in src/fx/index.ts.
 */
const IMPACT_DEBOUNCE_MS = 250;
/**
 * A *resting* contact (something's static weight pressing down) reports a
 * contact-force event every physics step for as long as it's touching, same
 * as a real collision — Rapier doesn't distinguish them in this event. Only
 * treat it as an "impact" worth reacting to (sound/haptic/wobble) when
 * either body was actually moving at a real approach speed the instant
 * before this step resolved the contact; a settled pile (jelly on jelly,
 * near-zero relative velocity) then produces no fx at all, however large the
 * supported/support force gets.
 */
const IMPACT_MIN_SPEED_MPS = 0.6;
const SLOW_VELOCITY_THRESHOLD = 0.05;
const MAX_PIECES = 40; // GDD perf budget

export interface PieceRuntime {
  id: number;
  material: MaterialId;
  body: RAPIER.RigidBody;
  /** primary collider; a frozen ice piece has more in extraColliderHandles (compound body). */
  collider: RAPIER.Collider;
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  halfWM: number;
  halfHM: number;
  /** distance (meters, along +y) from the body's translation origin to its top surface — halfHM for a normal piece (origin = center), 0 for a frozen ice compound body (origin = its top line). Used by tallestRestingTopM. */
  topOffsetM: number;
  wPx: number;
  hPx: number;
  glassState: GlassPieceState | null;
  jellySpring: JellySpringState | null;
  lastImpactAt: number;
  /** only set for material === 'freeze'; see FreezeController. */
  freeze: FreezeRuntimeState | null;
  /** extra collider handles (beyond `collider`) also mapped to this piece in `pieces`, for a frozen ice piece's compound body. */
  extraColliderHandles: number[];
}

export type ImpactCallback = (
  pieceMaterial: MaterialId,
  otherMaterial: MaterialId | null,
  force: number,
  x: number,
  y: number,
) => void;

export class PieceManager {
  readonly rapierWorld: PhysicsWorld;
  readonly pieces = new Map<number, PieceRuntime>(); // keyed by collider handle (a frozen ice piece has one entry per strip collider)
  readonly freezeController: FreezeController;
  private nextId = 1;
  private frameForce = new Map<number, number>();
  /** Each piece's speed just before this frame's physics step, keyed by
   *  collider handle — reused every frame (see IMPACT_MIN_SPEED_MPS) rather
   *  than allocated fresh, per the no-per-frame-allocations rule. */
  private preStepSpeed = new Map<number, number>();

  /** Physics/glass values pieces are spawned with. Defaults to the canonical MATERIALS; GameScene swaps in a runtime-mutable clone under `?debug=1` so the tuning panel's sliders affect newly spawned pieces without touching MATERIALS itself. */
  private materials: Record<MaterialId, Material>;

  constructor(
    private scene: Phaser.Scene,
    private onImpact: ImpactCallback,
    private onFellOff: (piece: PieceRuntime) => void,
    materials: Record<MaterialId, Material> = MATERIALS,
  ) {
    this.rapierWorld = new PhysicsWorld();
    this.materials = materials;
    this.freezeController = new FreezeController(this, scene, materials);
  }

  /** Used by FreezeController to id the new compound piece it builds on freeze. */
  allocatePieceId(): number {
    return this.nextId++;
  }

  spawn(material: MaterialId, xM: number, yM: number): PieceRuntime | null {
    if (this.pieces.size >= MAX_PIECES) return null;
    const halfWM = PLANK_SIZE.width / 2;
    const halfHM = PLANK_SIZE.height / 2;
    const { body, collider }: RapierPiece = this.rapierWorld.createDynamicBox(
      this.materials[material],
      xM,
      yM,
      halfWM,
      halfHM,
    );

    const wPx = PLANK_SIZE.width * PX_PER_M;
    const hPx = PLANK_SIZE.height * PX_PER_M;
    const id = this.nextId++;
    const graphics = this.scene.add.graphics();
    drawPieceBase(graphics, this.materials[material], wPx, hPx, id);
    const container = this.scene.add.container(xM * PX_PER_M, yM * PX_PER_M, [graphics]);

    const piece: PieceRuntime = {
      id,
      material,
      body,
      collider,
      container,
      graphics,
      halfWM,
      halfHM,
      topOffsetM: halfHM,
      wPx,
      hPx,
      glassState: material === 'glass' ? createGlassPieceState() : null,
      jellySpring: material === 'jelly' ? createJellySpring() : null,
      lastImpactAt: 0,
      freeze:
        material === 'freeze'
          ? { phase: 'falling', ageS: 0, joints: [], meltStepsDone: 0, rotationLocked: false, originXM: 0, originYM: 0, baseStrips: [] }
          : null,
      extraColliderHandles: [],
    };
    this.pieces.set(collider.handle, piece);
    return piece;
  }

  /** Advances physics by dt, applies glass rules, freeze behaviour and the fail-off-platform rule. */
  step(dt: number, failY: number): void {
    this.frameForce.clear();
    // Snapshot approach speed *before* the step resolves contacts — after the
    // step, a body that just landed already reads near-zero (that's the
    // resting/settled state), so this is the only point we can tell "was
    // this actually moving into the contact" from "was this already resting
    // under load" (see IMPACT_MIN_SPEED_MPS).
    this.preStepSpeed.clear();
    for (const [handle, piece] of this.pieces) {
      const v = piece.body.linvel();
      this.preStepSpeed.set(handle, Math.hypot(v.x, v.y));
    }

    const freezingNow = new Set<PieceRuntime>();
    this.rapierWorld.step(dt, (event) => {
      const p1 = this.pieces.get(event.handle1);
      const p2 = this.pieces.get(event.handle2);
      const approachSpeed = Math.max(this.preStepSpeed.get(event.handle1) ?? 0, this.preStepSpeed.get(event.handle2) ?? 0);
      if (p1) {
        this.frameForce.set(event.handle1, Math.max(this.frameForce.get(event.handle1) ?? 0, event.totalForceMagnitude));
        if (p1.freeze?.phase === 'falling') freezingNow.add(p1);
        this.handleImpact(p1, p2 ? p2.material : null, event.totalForceMagnitude, approachSpeed);
      }
      if (p2) {
        this.frameForce.set(event.handle2, Math.max(this.frameForce.get(event.handle2) ?? 0, event.totalForceMagnitude));
        if (p2.freeze?.phase === 'falling') freezingNow.add(p2);
        this.handleImpact(p2, p1 ? p1.material : null, event.totalForceMagnitude, approachSpeed);
      }
    });

    // Freezing (falling -> compound ice body) happens after the physics step
    // returns, never inside its contact-force callback (mutating the world
    // mid-step is unsafe). freezeController.update then handles melt timers
    // and breaking overloaded glue joints using this frame's forces.
    for (const piece of freezingNow) this.freezeController.freezePiece(piece);
    this.freezeController.update(dt, this.frameForce);

    const fallen: PieceRuntime[] = [];
    const shattered: PieceRuntime[] = [];
    const seenIds = new Set<number>(); // a frozen ice piece maps several collider handles to the same PieceRuntime

    for (const piece of this.pieces.values()) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      if (piece.material === 'glass' && piece.glassState) {
        const force = this.frameForce.get(piece.collider.handle) ?? 0;
        const wasCracked = piece.glassState.state === 'cracked';
        stepGlass(piece.glassState, force, dt, this.materials.glass.glass);
        if (piece.glassState.state === 'cracked' && !wasCracked) {
          drawCracks(piece.graphics, piece.wPx, piece.hPx, piece.id);
          fxGlassCrack(piece.container.x, piece.container.y);
        }
        if (piece.glassState.state === 'shattered') {
          shattered.push(piece);
          continue;
        }
      }
      if (piece.jellySpring) {
        const { sx, sy } = stepJellySpring(piece.jellySpring, dt);
        piece.container.setScale(sx, sy);
      }
      const t = piece.body.translation();
      if (t.y > failY) fallen.push(piece);
    }

    for (const piece of shattered) this.destroy(piece, true);
    for (const piece of fallen) {
      this.destroy(piece, false);
      this.onFellOff(piece);
    }
  }

  private handleImpact(piece: PieceRuntime, otherMaterial: MaterialId | null, force: number, approachSpeed: number): void {
    if (force < IMPACT_MIN_FORCE) return;
    // A settled pile keeps reporting contact-force events every step purely
    // from resting weight, with no real approach speed behind them — skip
    // those so a resting stack (jelly on jelly especially) can't keep
    // re-triggering fx/wobble off its own static support force.
    if (approachSpeed < IMPACT_MIN_SPEED_MPS) return;
    const now = performance.now();
    if (now - piece.lastImpactAt < IMPACT_DEBOUNCE_MS) return;
    piece.lastImpactAt = now;
    if (piece.jellySpring) {
      // Purely visual (scales the Phaser container, never touches the
      // Rapier body) — the wobble itself cannot feed back into physics or
      // retrigger more contact events on its own.
      triggerJellySpring(piece.jellySpring, forceToJellyAmplitude(force));
    }
    this.onImpact(piece.material, otherMaterial, force, piece.container.x, piece.container.y);
  }

  syncRender(): void {
    for (const piece of this.pieces.values()) {
      const t = piece.body.translation();
      piece.container.x = t.x * PX_PER_M;
      piece.container.y = t.y * PX_PER_M;
      piece.container.rotation = piece.body.rotation();
    }
  }

  /** True once every current piece's body has gone to sleep (test hook — perf/jelly-spam checks). */
  allSleeping(): boolean {
    if (this.pieces.size === 0) return true;
    for (const piece of this.pieces.values()) {
      if (!piece.body.isSleeping()) return false;
    }
    return true;
  }

  /** Meters (world y, y-down) of the top surface of the highest settled piece, or null if none. */
  tallestRestingTopM(): number | null {
    let minTopM = Infinity;
    for (const piece of this.pieces.values()) {
      // A just-frozen ice body is already placed exactly where it's staying
      // (its shape was built to sit flush the instant it landed) — it always
      // counts toward height even though the pop-in settle spike from its
      // brand-new flush colliders (see GLUE_GRACE_PERIOD_S in
      // FreezeController) can leave it and its neighbours with a residual
      // velocity above SLOW_VELOCITY_THRESHOLD for a few frames. Without
      // this, the height HUD would drop to 0 right after every freeze.
      const isSettledIce = piece.freeze?.phase === 'frozen';
      const vel = piece.body.linvel();
      const speed = Math.hypot(vel.x, vel.y);
      if (isSettledIce || piece.body.isSleeping() || speed < SLOW_VELOCITY_THRESHOLD) {
        const topM = piece.body.translation().y - piece.topOffsetM;
        if (topM < minTopM) minTopM = topM;
      }
    }
    return minTopM === Infinity ? null : minTopM;
  }

  countByMaterial(id: MaterialId): number {
    const seenIds = new Set<number>();
    let n = 0;
    for (const p of this.pieces.values()) {
      if (p.material !== id || seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      n++;
    }
    return n;
  }

  private destroy(piece: PieceRuntime, shatterFx: boolean): void {
    const x = piece.container.x;
    const y = piece.container.y;
    if (piece.freeze) this.freezeController.releaseJoints(piece);
    this.rapierWorld.removeBody(piece.body);
    this.pieces.delete(piece.collider.handle);
    for (const handle of piece.extraColliderHandles) this.pieces.delete(handle);
    piece.container.destroy();
    if (shatterFx) fxGlassShatter(x, y, this.materials[piece.material].colors.stroke);
  }

  clear(): void {
    const seenIds = new Set<number>();
    for (const piece of Array.from(this.pieces.values())) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      this.rapierWorld.removeBody(piece.body);
      piece.container.destroy();
    }
    this.pieces.clear();
    this.freezeController.reset();
  }
}
