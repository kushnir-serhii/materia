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

const IMPACT_MIN_FORCE = 5;
const IMPACT_DEBOUNCE_MS = 80;
const SLOW_VELOCITY_THRESHOLD = 0.05;
const MAX_PIECES = 40; // GDD perf budget

export interface PieceRuntime {
  id: number;
  material: MaterialId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  halfWM: number;
  halfHM: number;
  wPx: number;
  hPx: number;
  glassState: GlassPieceState | null;
  jellySpring: JellySpringState | null;
  lastImpactAt: number;
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
  readonly pieces = new Map<number, PieceRuntime>(); // keyed by collider handle
  private nextId = 1;
  private frameForce = new Map<number, number>();

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
      wPx,
      hPx,
      glassState: material === 'glass' ? createGlassPieceState() : null,
      jellySpring: material === 'jelly' ? createJellySpring() : null,
      lastImpactAt: 0,
    };
    this.pieces.set(collider.handle, piece);
    return piece;
  }

  /** Advances physics by dt, applies glass rules and the fail-off-platform rule. */
  step(dt: number, failY: number): void {
    this.frameForce.clear();
    this.rapierWorld.step(dt, (event) => {
      const p1 = this.pieces.get(event.handle1);
      const p2 = this.pieces.get(event.handle2);
      if (p1) {
        this.frameForce.set(event.handle1, Math.max(this.frameForce.get(event.handle1) ?? 0, event.totalForceMagnitude));
        this.handleImpact(p1, p2 ? p2.material : null, event.totalForceMagnitude);
      }
      if (p2) {
        this.frameForce.set(event.handle2, Math.max(this.frameForce.get(event.handle2) ?? 0, event.totalForceMagnitude));
        this.handleImpact(p2, p1 ? p1.material : null, event.totalForceMagnitude);
      }
    });

    const fallen: PieceRuntime[] = [];
    const shattered: PieceRuntime[] = [];

    for (const piece of this.pieces.values()) {
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

  private handleImpact(piece: PieceRuntime, otherMaterial: MaterialId | null, force: number): void {
    if (force < IMPACT_MIN_FORCE) return;
    const now = performance.now();
    if (now - piece.lastImpactAt < IMPACT_DEBOUNCE_MS) return;
    piece.lastImpactAt = now;
    if (piece.jellySpring) {
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

  /** Meters (world y, y-down) of the top surface of the highest settled piece, or null if none. */
  tallestRestingTopM(): number | null {
    let minTopM = Infinity;
    for (const piece of this.pieces.values()) {
      const vel = piece.body.linvel();
      const speed = Math.hypot(vel.x, vel.y);
      if (piece.body.isSleeping() || speed < SLOW_VELOCITY_THRESHOLD) {
        const topM = piece.body.translation().y - piece.halfHM;
        if (topM < minTopM) minTopM = topM;
      }
    }
    return minTopM === Infinity ? null : minTopM;
  }

  countByMaterial(id: MaterialId): number {
    let n = 0;
    for (const p of this.pieces.values()) if (p.material === id) n++;
    return n;
  }

  private destroy(piece: PieceRuntime, shatterFx: boolean): void {
    const x = piece.container.x;
    const y = piece.container.y;
    this.rapierWorld.removeBody(piece.body);
    this.pieces.delete(piece.collider.handle);
    piece.container.destroy();
    if (shatterFx) fxGlassShatter(x, y, this.materials[piece.material].colors.stroke);
  }

  clear(): void {
    for (const piece of Array.from(this.pieces.values())) {
      this.rapierWorld.removeBody(piece.body);
      piece.container.destroy();
    }
    this.pieces.clear();
  }
}
