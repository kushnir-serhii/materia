// Owns every physics piece's runtime state: spawning, the per-step glass /
// fail-off-platform checks, and syncing Rapier bodies to their Phaser
// containers. Kept out of GameScene to stay under the file-length rule.

import Phaser from 'phaser';
import type RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld, PX_PER_M, type RapierPiece } from '../physics/physics';
import {
  MATERIALS,
  STEEL_AIRBORNE_GRAVITY_SCALE,
  JELLY_TOP_WIDTH_RATIO,
  JELLY_CORNER_RADIUS_M,
  type Material,
  type MaterialId,
} from '../game/materials';
import { createGlassPieceState, stepGlass, type GlassPieceState } from '../game/glass';
import {
  createJellySpring,
  forceToJellyAmplitude,
  triggerJellySpring,
  stepJellySpring,
  jellySpringEnvelope,
  type JellySpringState,
} from '../game/spring';
import { createSquashPieceState, stepSquash, SQUASH_HEIGHT_FRACTIONS, type SquashPieceState } from '../game/squash';
import { createWormState, stepWorm, WORM_SIZE_FRACTIONS, WORM_HARDNESS_FRACTIONS, type WormState } from '../game/worm';
import { damageFactor } from '../game/props';
import { drawPieceBase, drawCracks, drawWormHoles } from '../ui/pieceView';
import { fxGlassCrack, fxGlassShatter, fxSquash, fxMunch } from '../fx';
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
const MAX_REMOVAL_LOG = 20;
/**
 * Any non-'reset'/'froze'/'culled' removal of a piece younger than this is
 * logged as a warning — it's the symptom of the "dropped piece just
 * vanishes" playtest bug (a stale, handle-based cross-piece reference
 * misfiring on an unrelated, freshly-spawned piece that happened to reuse a
 * recycled collider handle number). 'reset'/'froze'/'culled' are excluded
 * because they're legitimately fast by design (a manual/error reset can
 * happen the instant after a drop; a freeze piece "removes" itself and is
 * replaced by its ice body within its very first physics step; a cull under
 * extreme chaos can by design reach a piece that only just spawned).
 */
const YOUNG_REMOVAL_WARN_MS = 1500;
/**
 * Piece-budget policy (CLAUDE.md: "≤ 40 dynamic bodies", but a long-running
 * tower must never hit a hard "spawn refused" wall — see spawn()/
 * maintainPieceBudget()). Once the *dynamic* body count exceeds this, the
 * lowest resting pieces well below the current tower top are converted to
 * fixed (static) bodies — cheap "permanent scenery" that keeps its visuals
 * but no longer simulates, generates fx, or counts toward this budget. If
 * that alone can't bring the count back down (nothing down there is resting
 * — mid-collapse chaos), the lowest pieces are forcibly removed instead
 * (reason 'culled') so spawn() never has to refuse.
 */
const DYNAMIC_PIECE_BUDGET = 30;
/** A resting piece must be at least this far (meters) below the current tower top before it's eligible to settle — keeps the *visible* part of the tower (and anything the player might still interact with) fully dynamic. */
const SETTLE_DEPTH_M = 4;
/** Settled pieces are dimmed slightly to read as "locked in" — subtle, not a strong visual change. */
const SETTLED_ALPHA = 0.82;
/** Attacker hardness used for a contact whose other side isn't a tracked piece (e.g. resting directly on the static platform) — wood-equivalent, the pre-props baseline. */
const BASELINE_ATTACKER_HARDNESS = 5;
/** Paper's airborne sideways flutter (GDD §2: "falls very slowly and flutters side to side"). Small enough it never meaningfully displaces the drop, stops the instant it lands (see the airborne/resting switch). */
const PAPER_FLUTTER_FREQ_HZ = 2.4;
const PAPER_FLUTTER_FORCE_N = 0.045;
const PAPER_FLUTTER_TORQUE = 0.012;
/** GDD §2.0: ~1 in 6 wood pieces spawn as a "wormy" variant (see worm.ts). */
const WORMY_WOOD_CHANCE = 1 / 6;
/** How often (ms) a wormy-wood piece's cheap cosmetic animation (peeking worm) is allowed to redraw — see updateLivingLook. Deliberately coarse, never every frame. */
const LIVING_LOOK_REDRAW_MS = 300;
/** Jelly's cosmetic redraw rate while idle/resting (GDD §2.0 designer feedback: "~20Hz when idle"). */
const JELLY_IDLE_REDRAW_MS = 50;
/** Jelly's cosmetic redraw rate while actively wobbling (right after an impact) — faster than idle so the ripple reads as animated, still throttled (never every frame). */
const JELLY_WOBBLE_REDRAW_MS = 33;

/** Why a piece was removed — every removal goes through PieceManager.destroy()/logRemoval() so this is always recorded (see removals()/window.__materia.removals()). */
export type RemovalReason =
  | 'fell' // crossed the fail line (off the platform / off the bottom of the world)
  | 'shatter' // glass, sustained/impact overload
  | 'melt' // freeze's final melt step
  | 'froze' // a falling freeze piece converted into its compound ice body (not a loss — id changes)
  | 'reset' // manual or error-recovery reset cleared the board
  | 'error' // removed while recovering from an uncaught error mid-frame
  | 'culled' // piece-budget policy forcibly removed it (see DYNAMIC_PIECE_BUDGET) because nothing was resting/settleable
  | 'eaten'; // a wormy wood piece's worm.ts timeline reached WORM_LIFETIME_S (not a loss — no heart lost)

export interface RemovalRecord {
  id: number;
  material: MaterialId;
  reason: RemovalReason;
  /** ms between spawn and removal. */
  ageMs: number;
  /** performance.now() at removal. */
  at: number;
}

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
  /** only set for material === 'polystyrene'; see squash.ts. */
  squash: SquashPieceState | null;
  /** the piece's half-height (meters) as spawned, before any squash steps — squash.ts's SQUASH_HEIGHT_FRACTIONS are fractions of this, not of the current (possibly already-shrunk) halfHM. */
  baseHalfHM: number;
  /** only set for a wormy wood piece (~1 in 6 wood spawns, or forced via the dev picker's Wormy swatch); see worm.ts. Non-wormy wood and every other material carry null. A piece is never both squash and worm (only polystyrene squashes, only wood worms), so worm shrink reuses baseHalfHM as its own height baseline too — baseHalfWM is the matching width baseline. */
  worm: WormState | null;
  baseHalfWM: number;
  /** Slow phase accumulator for jelly's drifting bubbles / a wormy piece's peeking worm — advanced (and the graphics redrawn) only every LIVING_LOOK_REDRAW_MS, never per frame, per the "cheap" requirement (GDD §2.0). Unused (stays 0) for every other material/variant. */
  visualPhase: number;
  nextVisualRedrawMs: number;
  /** phase accumulator (radians) for paper's airborne flutter — only advanced/used for material === 'paper'. */
  flutterPhase: number;
  lastImpactAt: number;
  /** only set for material === 'freeze'; see FreezeController. */
  freeze: FreezeRuntimeState | null;
  /** extra collider handles (beyond `collider`) also mapped to this piece in `pieces`, for a frozen ice piece's compound body. */
  extraColliderHandles: number[];
  /** performance.now() when this PieceRuntime was created (see RemovalRecord.ageMs). */
  spawnedAtMs: number;
  /**
   * True once the piece-budget policy has converted this piece's body to a
   * fixed (static) Rapier body (see DYNAMIC_PIECE_BUDGET/maintainPieceBudget).
   * A settled piece keeps its visuals and its PieceRuntime entry (it can
   * still be a glue-joint target's `otherPieceId`, though its own joints are
   * released) but no longer simulates, reports contact forces, gets fx, or
   * counts toward the dynamic-body budget.
   */
  settled: boolean;
  /**
   * True from spawn until this piece's first contact-force event — see the
   * airborne/resting linear-damping switch in step(). While true, the body
   * runs with material.physics.airborneLinearDamping (set at creation);
   * the moment it lands, this flips false and the body switches to
   * material.physics.restingLinearDamping so a landed polystyrene/paper
   * stack still settles and sleeps normally instead of feeling floaty
   * forever.
   */
  airborne: boolean;
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
  /**
   * Keyed by the piece's own stable id (never changes across its lifetime,
   * unlike a Rapier collider handle — see RemovalReason's "froze"/'melt'
   * cases and FreezeController's glue joints). Any per-piece record that
   * must survive more than one frame (e.g. FreezeGlueJoint) should
   * reference a piece by this id and look it up here, never by a raw
   * collider handle: Rapier recycles freed handle numbers for the next
   * created collider/body, so a handle stored across frames can silently
   * start pointing at a completely unrelated piece.
   */
  readonly piecesById = new Map<number, PieceRuntime>();
  readonly freezeController: FreezeController;
  private nextId = 1;
  private frameForce = new Map<number, number>();
  /** Same shape as frameForce, but each value has already gone through props.ts's damageFactor(attackerHardness, thisPiece'sHardness, rawForce) — what glass/squash compare against their thresholds, instead of the raw physical force (see effectiveDamageForce). */
  private frameDamageForce = new Map<number, number>();
  /** Each piece's speed just before this frame's physics step, keyed by
   *  collider handle — reused every frame (see IMPACT_MIN_SPEED_MPS) rather
   *  than allocated fresh, per the no-per-frame-allocations rule. */
  private preStepSpeed = new Map<number, number>();
  private removalLog: RemovalRecord[] = [];

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

  /**
   * `wormyOverride` only matters for material === 'wood': true/false forces
   * the wormy variant on/off (used by GameScene's "Wormy" dev-picker
   * swatch, and by e2e tests for a deterministic wormy spawn); omitted, a
   * plain wood spawn rolls WORMY_WOOD_CHANCE itself. Ignored for every
   * other material.
   */
  spawn(material: MaterialId, xM: number, yM: number, wormyOverride?: boolean): PieceRuntime | null {
    // spawn() must ALWAYS succeed — a long-running tower (round-6 playtest
    // follow-up) must never hit a hard "drop refused" dead end. The old
    // MAX_PIECES hard cap here (checked, worse, against `pieces.size` — a
    // *collider*-handle count inflated by a frozen ice piece's up to
    // FREEZE_COLUMNS=11 strip colliders) was the round-5 "every drop just
    // vanishes" bug's root cause. It's replaced by maintainPieceBudget(),
    // called at the end of every step(): once the *dynamic* body count
    // exceeds DYNAMIC_PIECE_BUDGET it settles (or, failing that, culls) the
    // lowest pieces so there's always room for the next spawn().
    const size = this.materials[material].size;
    const halfWM = size.width / 2;
    const halfHM = size.height / 2;
    // Decided once, up front, so the initial graphics (worm holes or not)
    // and the PieceRuntime's `worm` state never disagree.
    const wormy = material === 'wood' && (wormyOverride ?? Math.random() < WORMY_WOOD_CHANCE);
    const { body, collider }: RapierPiece =
      material === 'jelly'
        ? this.rapierWorld.createDynamicTrapezoid(
            this.materials[material],
            xM,
            yM,
            halfWM,
            halfHM,
            JELLY_TOP_WIDTH_RATIO,
            JELLY_CORNER_RADIUS_M,
          )
        : this.rapierWorld.createDynamicBox(
            this.materials[material],
            xM,
            yM,
            halfWM,
            halfHM,
            0,
            material === 'steel' ? STEEL_AIRBORNE_GRAVITY_SCALE : 1,
          );

    const wPx = size.width * PX_PER_M;
    const hPx = size.height * PX_PER_M;
    const id = this.nextId++;
    const graphics = this.scene.add.graphics();
    drawPieceBase(graphics, this.materials[material], wPx, hPx, id);
    if (wormy) drawWormHoles(graphics, wPx, hPx, 0, id, 0);
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
      squash: material === 'polystyrene' ? createSquashPieceState() : null,
      baseHalfHM: halfHM,
      worm: wormy ? createWormState() : null,
      baseHalfWM: halfWM,
      visualPhase: Math.random() * Math.PI * 2,
      nextVisualRedrawMs: 0,
      flutterPhase: Math.random() * Math.PI * 2,
      lastImpactAt: 0,
      freeze:
        material === 'freeze'
          ? { phase: 'falling', ageS: 0, joints: [], meltStepsDone: 0, rotationLocked: false, originXM: 0, originYM: 0, baseStrips: [] }
          : null,
      extraColliderHandles: [],
      spawnedAtMs: performance.now(),
      settled: false,
      airborne: true,
    };
    this.pieces.set(collider.handle, piece);
    this.piecesById.set(id, piece);
    // Polystyrene: lock rotation while airborne so it falls smoothly without rotating.
    if (material === 'polystyrene') {
      body.lockRotations(true, true);
      body.setAngvel(0, true);
    }
    return piece;
  }

  /** Advances physics by dt, applies glass/squash rules, freeze behaviour and the fail-off-platform rule. */
  step(dt: number, failY: number): void {
    this.frameForce.clear();
    this.frameDamageForce.clear();
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

    // Paper's airborne flutter (GDD §2: "falls very slowly and flutters
    // side to side... a gentle rotation wobble while airborne, stops once
    // resting"). Applied once per logical piece, before the physics step so
    // it's part of this frame's integration; naturally stops the instant
    // `airborne` flips false in the contact-force callback below.
    for (const piece of this.piecesById.values()) {
      if (piece.material !== 'paper' || !piece.airborne || piece.settled) continue;
      piece.flutterPhase += dt * PAPER_FLUTTER_FREQ_HZ * Math.PI * 2;
      piece.body.addForce({ x: Math.sin(piece.flutterPhase) * PAPER_FLUTTER_FORCE_N, y: 0 }, true);
      piece.body.addTorque(Math.sin(piece.flutterPhase * 0.6 + 1) * PAPER_FLUTTER_TORQUE, true);
    }

    const freezingNow = new Set<PieceRuntime>();
    this.rapierWorld.step(dt, (event) => {
      const p1 = this.pieces.get(event.handle1);
      const p2 = this.pieces.get(event.handle2);
      const approachSpeed = Math.max(this.preStepSpeed.get(event.handle1) ?? 0, this.preStepSpeed.get(event.handle2) ?? 0);
      // Settled (fixed-body) pieces don't need contact-force tracking, fx or
      // load-checking any more — they're permanent scenery now (see
      // maintainPieceBudget/settlePiece). A fixed body can still generate a
      // contact-force event against the dynamic piece resting on it, so this
      // guard matters, not just an optimization.
      if (p1 && !p1.settled) {
        this.frameForce.set(event.handle1, Math.max(this.frameForce.get(event.handle1) ?? 0, event.totalForceMagnitude));
        this.frameDamageForce.set(
          event.handle1,
          Math.max(this.frameDamageForce.get(event.handle1) ?? 0, this.effectiveDamageForce(p1, p2?.material ?? null, event.totalForceMagnitude)),
        );
        this.landPiece(p1);
        if (p1.freeze?.phase === 'falling') freezingNow.add(p1);
        this.handleImpact(p1, p2 ? p2.material : null, event.totalForceMagnitude, approachSpeed);
      }
      if (p2 && !p2.settled) {
        this.frameForce.set(event.handle2, Math.max(this.frameForce.get(event.handle2) ?? 0, event.totalForceMagnitude));
        this.frameDamageForce.set(
          event.handle2,
          Math.max(this.frameDamageForce.get(event.handle2) ?? 0, this.effectiveDamageForce(p2, p1?.material ?? null, event.totalForceMagnitude)),
        );
        this.landPiece(p2);
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
    const eaten: PieceRuntime[] = [];
    const seenIds = new Set<number>(); // a frozen ice piece maps several collider handles to the same PieceRuntime

    for (const piece of this.pieces.values()) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      if (piece.settled) continue; // fixed body: can't crack/shatter/wobble/fall any more
      if (piece.material === 'glass' && piece.glassState) {
        // Damage-scaled, not raw: a steel attacker crosses these same
        // crackForce/breakForce/loadLimit thresholds at a much lower raw
        // force than a softer one (props.ts's damageFactor / GDD §2.0).
        const force = this.frameDamageForce.get(piece.collider.handle) ?? 0;
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
      if (piece.material === 'polystyrene' && piece.squash) {
        const force = this.frameDamageForce.get(piece.collider.handle) ?? 0;
        const levelBefore = piece.squash.level;
        stepSquash(piece.squash, force, dt, this.materials.polystyrene.squash);
        if (piece.squash.level > levelBefore) this.applySquashStep(piece);
      }
      if (piece.worm) {
        const levelBefore = piece.worm.level;
        stepWorm(piece.worm, dt);
        if (piece.worm.eaten) {
          eaten.push(piece);
          continue;
        }
        if (piece.worm.level > levelBefore) this.applyWormShrink(piece);
      }
      this.updateLivingLook(piece, dt);
      if (piece.jellySpring) {
        const { sx, sy } = stepJellySpring(piece.jellySpring, dt);
        piece.container.setScale(sx, sy);
      }
      const t = piece.body.translation();
      if (t.y > failY) fallen.push(piece);
    }

    for (const piece of shattered) this.destroy(piece, 'shatter');
    for (const piece of eaten) this.destroy(piece, 'eaten');
    for (const piece of fallen) {
      this.destroy(piece, 'fell');
      this.onFellOff(piece);
    }

    this.maintainPieceBudget();
  }

  /**
   * Effective ("damage") force a contact deals to `receiver`, per GDD §2.0:
   * scaled up by the *other* side's hardness (a steel attacker hits harder)
   * and down by the receiver's own hardness/toughness (props.ts's
   * damageFactor). `otherMaterial` is null when the other side of the
   * contact isn't a tracked piece (e.g. resting directly on the static
   * platform), which uses BASELINE_ATTACKER_HARDNESS — the same
   * wood-equivalent assumption the original glass measurements were made
   * under, so this is a no-op change for every pre-existing scenario.
   */
  private effectiveDamageForce(receiver: PieceRuntime, otherMaterial: MaterialId | null, rawForce: number): number {
    const attackerHardness = otherMaterial ? this.materials[otherMaterial].props.hardness : BASELINE_ATTACKER_HARDNESS;
    let receiverHardness = this.materials[receiver.material].props.hardness;
    // A wormy wood piece gets structurally weaker as it's eaten (GDD §2.0) —
    // scale its own hardness down by worm.ts's per-level fraction. Doesn't
    // affect anything else's thresholds, only how *this* piece takes a hit.
    if (receiver.worm) receiverHardness *= WORM_HARDNESS_FRACTIONS[receiver.worm.level];
    return damageFactor(attackerHardness, receiverHardness, rawForce);
  }

  /** First-contact transition: switches a piece from its airborne linear damping to its (lower) resting one, so a landed polystyrene/paper stack settles and sleeps normally instead of feeling floaty forever (GDD §2.0). Unlocks rotation for polystyrene. No-op past the first call. */
  private landPiece(piece: PieceRuntime): void {
    if (!piece.airborne) return;
    piece.airborne = false;
    piece.body.setLinearDamping(this.materials[piece.material].physics.restingLinearDamping);
    // Polystyrene: unlock rotation on first contact so it can tip realistically on the tower.
    if (piece.material === 'polystyrene') {
      piece.body.lockRotations(false, true);
    }
    // Steel: its extra airborne gravityScale (GDD §2.0 "falls hard and
    // fast") is only meant to speed up the drop, not press down on
    // whatever it lands on any harder than its own weight — back to normal
    // the instant it's resting.
    if (piece.material === 'steel') {
      piece.body.setGravityScale(1, true);
    }
  }

  /**
   * Rebuilds a polystyrene piece's collider/graphics at its new, shorter
   * squash height (SQUASH_HEIGHT_FRACTIONS[piece.squash.level] of its
   * original baseHalfHM), keeping its *bottom* fixed against whatever it's
   * resting on (the body's center moves down by exactly the height lost,
   * so the top compresses down onto the support with no pop/jump).
   */
  private applySquashStep(piece: PieceRuntime): void {
    if (!piece.squash) return;
    const newHalfHM = piece.baseHalfHM * SQUASH_HEIGHT_FRACTIONS[piece.squash.level];
    if (newHalfHM >= piece.halfHM) return; // already at/below this height (shouldn't happen — squash is monotonic)
    const oldHalfHM = piece.halfHM;
    const pos = piece.body.translation();
    const material = this.materials[piece.material];

    this.pieces.delete(piece.collider.handle);
    this.rapierWorld.removeCollider(piece.collider);
    const newCollider = this.rapierWorld.addBoxCollider(piece.body, material, 0, 0, piece.halfWM, newHalfHM);
    // Bottom stays put: center moves down (y-down) by exactly the height lost.
    piece.body.setTranslation({ x: pos.x, y: pos.y + (oldHalfHM - newHalfHM) }, true);

    piece.collider = newCollider;
    piece.halfHM = newHalfHM;
    piece.topOffsetM = newHalfHM;
    piece.hPx = newHalfHM * 2 * PX_PER_M;
    this.pieces.set(newCollider.handle, piece);

    drawPieceBase(piece.graphics, material, piece.wPx, piece.hPx, piece.id);
    fxSquash(piece.container.x, piece.container.y);
  }

  /**
   * Rebuilds a wormy wood piece's collider/graphics at its new, smaller
   * worm-eaten size (WORM_SIZE_FRACTIONS[piece.worm.level] of its original
   * baseHalfWM/baseHalfHM in both dimensions), keeping its *bottom* fixed
   * against whatever it's resting on — same no-pop technique as
   * applySquashStep, just shrinking width too (centered horizontally, which
   * is purely cosmetic since it's symmetric).
   */
  private applyWormShrink(piece: PieceRuntime): void {
    if (!piece.worm) return;
    const fraction = WORM_SIZE_FRACTIONS[piece.worm.level];
    const newHalfWM = piece.baseHalfWM * fraction;
    const newHalfHM = piece.baseHalfHM * fraction;
    if (newHalfHM >= piece.halfHM && newHalfWM >= piece.halfWM) return; // already at/below (shouldn't happen — worm level is monotonic)
    const oldHalfHM = piece.halfHM;
    const pos = piece.body.translation();
    const material = this.materials[piece.material];

    this.pieces.delete(piece.collider.handle);
    this.rapierWorld.removeCollider(piece.collider);
    const newCollider = this.rapierWorld.addBoxCollider(piece.body, material, 0, 0, newHalfWM, newHalfHM);
    // Bottom stays put: center moves down (y-down) by exactly the height lost.
    piece.body.setTranslation({ x: pos.x, y: pos.y + (oldHalfHM - newHalfHM) }, true);

    piece.collider = newCollider;
    piece.halfWM = newHalfWM;
    piece.halfHM = newHalfHM;
    piece.topOffsetM = newHalfHM;
    piece.wPx = newHalfWM * 2 * PX_PER_M;
    piece.hPx = newHalfHM * 2 * PX_PER_M;
    this.pieces.set(newCollider.handle, piece);

    drawPieceBase(piece.graphics, material, piece.wPx, piece.hPx, piece.id, piece.visualPhase);
    drawWormHoles(piece.graphics, piece.wPx, piece.hPx, piece.worm.level, piece.id, piece.visualPhase);
    fxMunch(piece.container.x, piece.container.y);
  }

  /**
   * Advances and, at a throttled rate, redraws a jelly or wormy-wood
   * piece's cheap cosmetic animation (drifting bubbles/bugs, an animated
   * ripple along jelly's outline, a peeking worm — GDD §2.0). No-op for
   * every other piece; deliberately never done every frame (see
   * PieceRuntime.visualPhase's doc). Jelly redraws faster while actively
   * wobbling (right after an impact) than while idle/resting — "redraw
   * only when wobbling or on a low rate (~20Hz) when idle" — everything
   * else (wormy wood) always uses the slower, coarser rate.
   */
  private updateLivingLook(piece: PieceRuntime, dt: number): void {
    if (piece.material !== 'jelly' && !piece.worm) return;
    const now = performance.now();
    if (now < piece.nextVisualRedrawMs) return;
    const wobbleMag = piece.jellySpring ? jellySpringEnvelope(piece.jellySpring) : 0;
    const interval = piece.material === 'jelly' && wobbleMag > 0 ? JELLY_WOBBLE_REDRAW_MS : piece.material === 'jelly' ? JELLY_IDLE_REDRAW_MS : LIVING_LOOK_REDRAW_MS;
    piece.nextVisualRedrawMs = now + interval;
    piece.visualPhase += dt * 60 * (interval / 1000); // keep motion roughly frame-rate independent despite the throttled redraw cadence
    const material = this.materials[piece.material];
    drawPieceBase(piece.graphics, material, piece.wPx, piece.hPx, piece.id, piece.visualPhase, wobbleMag);
    if (piece.worm) drawWormHoles(piece.graphics, piece.wPx, piece.hPx, piece.worm.level, piece.id, piece.visualPhase);
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
    const seenIds = new Set<number>();
    for (const piece of this.pieces.values()) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      if (piece.settled) continue; // fixed body never moves again — position/rotation already correct
      const t = piece.body.translation();
      piece.container.x = t.x * PX_PER_M;
      piece.container.y = t.y * PX_PER_M;
      piece.container.rotation = piece.body.rotation();
    }
  }

  /** True once every current (non-settled) piece's body has gone to sleep (test hook — perf/jelly-spam checks). A settled/fixed body counts as sleeping — it's permanently at rest. */
  allSleeping(): boolean {
    if (this.pieces.size === 0) return true;
    for (const piece of this.pieces.values()) {
      if (!piece.settled && !piece.body.isSleeping()) return false;
    }
    return true;
  }

  /**
   * Meters (world y, y-down) of this piece's top surface if it currently
   * counts as "resting" (settled/fixed, a just-frozen ice body, asleep, or
   * moving slower than SLOW_VELOCITY_THRESHOLD) — null otherwise. Shared by
   * tallestRestingTopM (HUD height) and maintainPieceBudget (settle
   * candidates).
   */
  private restingTopM(piece: PieceRuntime): number | null {
    if (piece.settled) return piece.body.translation().y - piece.topOffsetM;
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
      return piece.body.translation().y - piece.topOffsetM;
    }
    return null;
  }

  /** Meters (world y, y-down) of the top surface of the highest settled piece, or null if none. */
  tallestRestingTopM(): number | null {
    let minTopM = Infinity;
    for (const piece of this.pieces.values()) {
      const topM = this.restingTopM(piece);
      if (topM !== null && topM < minTopM) minTopM = topM;
    }
    return minTopM === Infinity ? null : minTopM;
  }

  /** Number of pieces whose Rapier body is still dynamic (counts toward DYNAMIC_PIECE_BUDGET). Test hook. */
  dynamicPieceCount(): number {
    let n = 0;
    for (const piece of this.piecesById.values()) {
      if (!piece.settled) n++;
    }
    return n;
  }

  /** Number of pieces whose Rapier body has been converted to fixed by the settle policy. Test hook. */
  settledPieceCount(): number {
    let n = 0;
    for (const piece of this.piecesById.values()) {
      if (piece.settled) n++;
    }
    return n;
  }

  /**
   * Piece-budget policy: once the dynamic (non-settled) body count exceeds
   * DYNAMIC_PIECE_BUDGET, converts the lowest resting pieces at least
   * SETTLE_DEPTH_M below the current tower top into fixed bodies (see
   * settlePiece). If that alone isn't enough — nothing down there is resting,
   * e.g. mid-collapse chaos — forcibly removes the lowest remaining dynamic
   * pieces (reason 'culled') so spawn() never has to refuse. Called once at
   * the end of every step().
   */
  private maintainPieceBudget(): void {
    let over = this.dynamicPieceCount() - DYNAMIC_PIECE_BUDGET;
    if (over <= 0) return;

    const towerTopM = this.tallestRestingTopM();
    if (towerTopM !== null) {
      const seenIds = new Set<number>();
      const candidates: { piece: PieceRuntime; topM: number }[] = [];
      for (const piece of this.pieces.values()) {
        if (seenIds.has(piece.id)) continue;
        seenIds.add(piece.id);
        if (piece.settled) continue;
        const topM = this.restingTopM(piece);
        if (topM === null) continue;
        if (topM - towerTopM < SETTLE_DEPTH_M) continue; // too close to the visible top — keep dynamic
        candidates.push({ piece, topM });
      }
      candidates.sort((a, b) => b.topM - a.topM); // deepest (largest y) first
      for (const { piece } of candidates) {
        if (over <= 0) break;
        this.settlePiece(piece);
        over--;
      }
    }

    if (over > 0) this.cullLowestDynamic(over);
  }

  /** Converts a resting piece's body to fixed in place — see maintainPieceBudget. */
  private settlePiece(piece: PieceRuntime): void {
    // Same joint-cleanup calls destroy() makes: any OTHER ice piece glued to
    // this one must drop that reference (id-based — see FreezeGlueJoint's
    // doc), and if this piece is itself frozen ice, its own outgoing joints
    // and melt tracking must stop (a fixed body should never keep melting or
    // pulling on a glue joint).
    this.freezeController.purgeJointsTo(piece);
    if (piece.freeze) this.freezeController.releaseJoints(piece);
    this.rapierWorld.setBodyFixed(piece.body);
    piece.settled = true;
    piece.container.setAlpha(SETTLED_ALPHA);
  }

  /** Forcibly removes the lowest `count` still-dynamic pieces (reason 'culled') — fallback when settling alone can't bring the dynamic count back under budget. */
  private cullLowestDynamic(count: number): void {
    const seenIds = new Set<number>();
    const candidates: PieceRuntime[] = [];
    for (const piece of this.pieces.values()) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      if (piece.settled) continue;
      candidates.push(piece);
    }
    candidates.sort((a, b) => b.body.translation().y - a.body.translation().y); // deepest (largest y) first
    for (let i = 0; i < count && i < candidates.length; i++) {
      this.destroy(candidates[i], 'culled');
    }
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

  /** Removes a piece from the world without fx (used by FreezeController when ice fully melts, or after a falling freeze piece converts into its compound ice body). */
  removePiece(piece: PieceRuntime, reason: RemovalReason = 'melt'): void {
    this.destroy(piece, reason);
  }

  private destroy(piece: PieceRuntime, reason: RemovalReason): void {
    const x = piece.container.x;
    const y = piece.container.y;
    // Must run before removeBody, and for every piece (not just frozen
    // ones): this piece may be the *glued* side of another piece's ice —
    // see FreezeController.purgeJointsTo's doc for why leaving this out is
    // the "everything disappears" crash.
    this.freezeController.purgeJointsTo(piece);
    if (piece.freeze) this.freezeController.releaseJoints(piece);
    this.rapierWorld.removeBody(piece.body);
    this.pieces.delete(piece.collider.handle);
    for (const handle of piece.extraColliderHandles) this.pieces.delete(handle);
    this.piecesById.delete(piece.id);
    piece.container.destroy();
    this.logRemoval(piece, reason);
    if (reason === 'shatter') fxGlassShatter(x, y, this.materials[piece.material].colors.stroke);
  }

  /** Records a removal for window.__materia.removals()/the "did my new piece survive" fuzz check, and warns on anything that looks like the "dropped piece vanishes" bug (see YOUNG_REMOVAL_WARN_MS). Public: FreezeController calls this directly for the one removal it does outside PieceManager.destroy() (a falling freeze piece converting into its ice body — see freezePiece()). */
  logRemoval(piece: PieceRuntime, reason: RemovalReason): void {
    const now = performance.now();
    const ageMs = now - piece.spawnedAtMs;
    this.removalLog.push({ id: piece.id, material: piece.material, reason, ageMs, at: now });
    if (this.removalLog.length > MAX_REMOVAL_LOG) this.removalLog.shift();
    if (reason !== 'reset' && reason !== 'froze' && reason !== 'culled' && ageMs < YOUNG_REMOVAL_WARN_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[materia] piece #${piece.id} (${piece.material}) removed ${ageMs.toFixed(0)}ms after spawn, reason=${reason}`,
      );
    }
  }

  /** Last MAX_REMOVAL_LOG removals, oldest first (test hook / debug). */
  removals(): RemovalRecord[] {
    return this.removalLog.slice();
  }

  clear(reason: RemovalReason = 'reset'): void {
    const seenIds = new Set<number>();
    for (const piece of Array.from(this.pieces.values())) {
      if (seenIds.has(piece.id)) continue;
      seenIds.add(piece.id);
      this.rapierWorld.removeBody(piece.body);
      piece.container.destroy();
      this.logRemoval(piece, reason);
    }
    this.pieces.clear();
    this.piecesById.clear();
    this.freezeController.reset();
  }
}
