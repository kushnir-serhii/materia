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
  ): RapierPiece {
    // Glass must keep reporting contact-force events even while resting, so its
    // sustained-load rule (materials.ts / glass.ts) can see the load; Rapier
    // stops emitting force events once a body is asleep, so glass never sleeps.
    const canSleep = material.id !== 'glass';
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(angle)
      .setLinearDamping(material.physics.linearDamping)
      .setAngularDamping(material.physics.angularDamping)
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

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
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

  removeCollider(collider: RAPIER.Collider): void {
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

  removeImpulseJoint(joint: RAPIER.ImpulseJoint): void {
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
