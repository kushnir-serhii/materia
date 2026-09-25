// Thin wrapper over @dimforge/rapier2d-compat.
//
// Units: everything in this module (and everything below it) is in meters.
// The rest of the game (Phaser) works in pixels; PX_PER_M is the single
// conversion factor, used only at the render boundary in GameScene.
//
// Y convention: Phaser's screen y grows downward, so this world also uses a
// y-down convention (gravity is +y) to avoid a sign flip between physics and
// render code. "Up" in game terms (piece stacking higher) is -y.

import RAPIER from '@dimforge/rapier2d-compat';
import type { Material } from '../game/materials';

export const PX_PER_M = 50;
export const FIXED_STEP = 1 / 60;
export const MAX_SUBSTEPS = 4;

/** Low threshold so every piece reports contact force events (impact + load data). */
const CONTACT_FORCE_EVENT_THRESHOLD = 0.5;

let inited = false;

/** Must be called once and awaited before creating a PhysicsWorld. */
export async function initPhysics(): Promise<void> {
  if (inited) return;
  await RAPIER.init();
  inited = true;
}

export type BodyHandle = number;
export type ColliderHandle = number;

export interface RapierPiece {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface ContactForceEvent {
  /** collider handles (as reported by Rapier), NOT body handles */
  handle1: ColliderHandle;
  handle2: ColliderHandle;
  totalForceMagnitude: number;
}

export type ContactForceCallback = (event: ContactForceEvent) => void;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private eventQueue: RAPIER.EventQueue;
  private accumulator = 0;
  /** Reused across drainContactForceEvents calls to avoid per-event allocation. */
  private reusableEvent: ContactForceEvent = { handle1: 0, handle2: 0, totalForceMagnitude: 0 };

  constructor() {
    if (!inited) {
      throw new Error('initPhysics() must be awaited before creating a PhysicsWorld');
    }
    // y-down: gravity pulls pieces toward larger y (down the screen).
    this.world = new RAPIER.World({ x: 0, y: 9.81 });
    this.world.timestep = FIXED_STEP;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /**
   * Advances simulation time by `dtSeconds` using a fixed-step accumulator
   * (max MAX_SUBSTEPS per call, extra time is dropped to avoid the spiral of
   * death on a slow frame). Calls `onContactForce` once per contact-force
   * event produced during the substeps run this call.
   */
  step(dtSeconds: number, onContactForce?: ContactForceCallback): void {
    this.accumulator += dtSeconds;
    let substeps = 0;
    while (this.accumulator >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
      this.world.step(this.eventQueue);
      if (onContactForce) {
        this.eventQueue.drainContactForceEvents((event) => {
          const c1 = event.collider1();
          const c2 = event.collider2();
          this.reusableEvent.handle1 = c1;
          this.reusableEvent.handle2 = c2;
          this.reusableEvent.totalForceMagnitude = event.totalForceMagnitude();
          onContactForce(this.reusableEvent);
        });
      } else {
        this.eventQueue.clear();
      }
      this.accumulator -= FIXED_STEP;
      substeps++;
    }
    if (substeps >= MAX_SUBSTEPS) {
      // Dropped remaining accumulated time rather than spiraling.
      this.accumulator = 0;
    }
  }

  /** Static platform / ground piece. x, y, halfWidth, halfHeight in meters. */
  createStaticBox(x: number, y: number, halfWidth: number, halfHeight: number): RapierPiece {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight).setFriction(0.8);
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /** Dynamic box piece using a Material's physics params. x, y in meters; angle in radians. */
  createDynamicBox(
    material: Material,
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    angle = 0,
    gravityScale = 1,
  ): RapierPiece {
    // Glass must keep reporting contact-force events even while resting, so its
    // sustained-load rule (materials.ts / glass.ts) can see the load; Rapier
    // stops emitting force events once a body is asleep, so glass never sleeps.
    const canSleep = material.id !== 'glass';
    // Every piece starts falling (airborne) — PieceManager switches it to
    // restingLinearDamping the moment it first registers a contact (see its
    // airborne/landed handling), so this initial value is always the
    // airborne one. `gravityScale` is likewise an airborne-only value for
    // materials that use it (steel — GDD §2.0 "falls down hard and fast");
    // PieceManager resets it to 1 on landing, same pattern as damping.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(angle)
      .setLinearDamping(material.physics.airborneLinearDamping)
      .setAngularDamping(material.physics.angularDamping)
      .setGravityScale(gravityScale)
      .setCanSleep(canSleep);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight)
      .setDensity(material.physics.density)
      .setFriction(material.physics.friction)
      .setRestitution(material.physics.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONTACT_FORCE_EVENT_THRESHOLD);
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /**
   * Same as createDynamicBox, but the collider is a rounded convex trapezoid
   * (top edge `topWidthRatio` of the bottom edge's width, y-down so "top" is
   * -halfHeight) instead of a plain box — used for jelly (GDD §2.0: "top
   * slightly narrower than bottom... rounded corners"). Bottom stays
   * `halfWidth` wide so footprint/overlap logic elsewhere (camera, freeze
   * fill) that reads a jelly piece's halfWM is unaffected.
   */
  createDynamicTrapezoid(
    material: Material,
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    topWidthRatio: number,
    cornerRadius: number,
    angle = 0,
  ): RapierPiece {
    const canSleep = material.id !== 'glass';
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(angle)
      .setLinearDamping(material.physics.airborneLinearDamping)
      .setAngularDamping(material.physics.angularDamping)
      .setCanSleep(canSleep);
    const body = this.world.createRigidBody(bodyDesc);
    const topHalfWidth = halfWidth * topWidthRatio;
    const points = new Float32Array([
      -topHalfWidth, -halfHeight,
      topHalfWidth, -halfHeight,
      halfWidth, halfHeight,
      -halfWidth, halfHeight,
    ]);
    const colliderDesc = (RAPIER.ColliderDesc.roundConvexHull(points, cornerRadius) ?? RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight))
      .setDensity(material.physics.density)
      .setFriction(material.physics.friction)
      .setRestitution(material.physics.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONTACT_FORCE_EVENT_THRESHOLD);
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /**
   * Removes a rigid body — and, per Rapier, every collider and impulse joint
   * still attached to it. A no-op (not a crash) if it's already gone: a
   * caller can end up with the same body queued for removal twice (e.g. a
   * piece fails off the platform the same frame something else removes it),
   * and Rapier's WASM panics ("unreachable") on an operation against an
   * already-removed handle rather than raising a catchable JS error —
   * `isValid()` is the only way to check first instead of finding out via a
   * crash that poisons the whole physics world.
   */
  removeBody(body: RAPIER.RigidBody): void {
    if (!body.isValid()) return;
    this.world.removeRigidBody(body);
  }

  /**
   * Converts a resting dynamic body into a fixed (static) one in place —
   * used by PieceManager's piece-budget "settle" policy to retire pieces
   * buried deep under a tall tower into permanent scenery without ever
   * destroying them (keeps their visuals). A fixed body no longer counts
   * against the dynamic-body budget and never needs simulating again.
   */
  setBodyFixed(body: RAPIER.RigidBody): void {
    body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }

  /**
   * A bare dynamic body with no collider yet — used to build the freeze
   * block's compound ice body (see game/freeze.ts + FreezeController), one
   * cuboid collider per fill strip added via addBoxCollider.
   */
  createDynamicBody(x: number, y: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setCanSleep(true);
    return this.world.createRigidBody(bodyDesc);
  }

  /** Adds one cuboid collider to `body`, offset (localX, localY) from its origin. */
  addBoxCollider(
    body: RAPIER.RigidBody,
    material: Material,
    localX: number,
    localY: number,
    halfWidth: number,
    halfHeight: number,
  ): RAPIER.Collider {
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight)
      .setTranslation(localX, localY)
      .setDensity(material.physics.density)
      .setFriction(material.physics.friction)
      .setRestitution(material.physics.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONTACT_FORCE_EVENT_THRESHOLD);
    return this.world.createCollider(colliderDesc, body);
  }

  /** No-op if already removed — see removeBody's doc for why that check matters here. */
  removeCollider(collider: RAPIER.Collider): void {
    if (!collider.isValid()) return;
    this.world.removeCollider(collider, true);
  }

  /**
   * Casts a ray straight down from (xM, fromYM); returns the world y of the
   * first surface hit within maxToiM, or null if nothing was hit.
   * `excludeBody` is typically the falling freeze piece itself.
   */
  castRayDown(xM: number, fromYM: number, maxToiM: number, excludeBody?: RAPIER.RigidBody): number | null {
    const ray = new RAPIER.Ray({ x: xM, y: fromYM }, { x: 0, y: 1 });
    const hit = this.world.castRay(ray, maxToiM, true, undefined, undefined, undefined, excludeBody);
    if (!hit) return null;
    return fromYM + hit.timeOfImpact;
  }

  /** Collider handles whose AABB intersects the given box, expanded by `marginM` on every side. */
  collidersOverlappingBox(
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number,
    marginM: number,
  ): RAPIER.Collider[] {
    const found: RAPIER.Collider[] = [];
    this.world.collidersWithAabbIntersectingAabb(
      { x: centerX, y: centerY },
      { x: halfWidth + marginM, y: halfHeight + marginM },
      (collider) => {
        found.push(collider);
        return true;
      },
    );
    return found;
  }

  createImpulseJoint(desc: RAPIER.JointData, body1: RAPIER.RigidBody, body2: RAPIER.RigidBody): RAPIER.ImpulseJoint {
    return this.world.createImpulseJoint(desc, body1, body2, true);
  }

  /**
   * No-op if already removed. This is the specific guard the crash report
   * pointed at: removeRigidBody() also silently drops every impulse joint
   * attached to that body, so a joint FreezeController is still holding a
   * reference to (e.g. the glued piece on the other end fell off/shattered
   * and was removed first) is already gone by the time melt or a
   * force-break tries to remove it again — see removeBody's doc.
   */
  removeImpulseJoint(joint: RAPIER.ImpulseJoint): void {
    if (!joint.isValid()) return;
    this.world.removeImpulseJoint(joint, true);
  }

  free(): void {
    this.eventQueue.free();
  }
}

export function metersToPixels(m: number): number {
  return m * PX_PER_M;
}

export function pixelsToMeters(px: number): number {
  return px / PX_PER_M;
}
