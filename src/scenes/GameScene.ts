import Phaser from 'phaser';
import { PX_PER_M } from '../physics/physics';
import { MATERIALS, MATERIAL_IDS, ALL_MATERIAL_IDS, cloneMaterialsForRuntime, type Material, type MaterialId } from '../game/materials';
import { drawPieceBase, drawWormHoles } from '../ui/pieceView';
import { drawBackground } from '../ui/background';
import { Hud } from '../ui/hud';
import { DebugPanel } from '../ui/debugPanel';
import { getSafeAreaBottomPx } from '../ui/safeArea';
import {
  loadBestHeight,
  saveBestHeight,
  loadMuted,
  saveMuted,
  loadVibrationEnabled,
  saveVibrationEnabled,
} from '../ui/storage';
import {
  fx,
  bindEffects,
  initFxGesture,
  consumeHitStopDt,
  updateEffects,
  setMuted,
  isMuted,
  setVibrationEnabled,
  isVibrationEnabled,
  getImpactFxCount,
  resetImpactFxCount,
} from '../fx';
import { Effects } from '../fx/effects';
import { PieceManager, type RemovalRecord } from './PieceManager';

function isDebugBuild(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/** GDD §2.1: freeze is never a plain rotation slot, it's a ~1-in-10 special roll. */
const FREEZE_SPAWN_CHANCE = 0.1;
/** GDD §2.0: ~1 in 6 wood pieces spawn as a "wormy" variant — matches PieceManager's own WORMY_WOOD_CHANCE fallback (spawn() is always told explicitly here, but keeping the hook preview's own roll in sync avoids ever needing to reconcile two different chances). */
const WORMY_WOOD_HOOK_CHANCE = 1 / 6;

function randomMaterial(): MaterialId {
  if (Math.random() < FREEZE_SPAWN_CHANCE) return 'freeze';
  return MATERIAL_IDS[Math.floor(Math.random() * MATERIAL_IDS.length)];
}

const SCREEN_W = 540;
const SCREEN_H = 960;

const PLATFORM_HALF_WIDTH_M = 2.5;
const PLATFORM_HALF_HEIGHT_M = 0.3;
const GROUND_CENTER_Y_M = 15;
const FAIL_MARGIN_M = 2;

const HOOK_SCREEN_Y_PX = 110;
const HOOK_AMPLITUDE_M = 1.7;
const HOOK_BASE_SPEED = 1.1;
const HOOK_SPEED_HEIGHT_FACTOR = 0.03;
const HOOK_SPEED_MAX = 2.5;

const DROP_COOLDOWN_S = 0.6;
const HEARTS_MAX = 3;
const CAMERA_LERP = 0.08;
/** Slower lerp when the camera is coming back down (tower got shorter), so a
 *  collapse settles smoothly instead of snapping/bouncing the view. */
const CAMERA_LERP_DOWN = 0.04;
/** The tower must have been shorter than the camera's current target for
 *  this long before the camera actually starts following it back down —
 *  otherwise a mid-collapse wobble (a piece bouncing before it resettles)
 *  would bounce the camera too. */
const CAMERA_DOWN_DELAY_S = 0.5;
const VIEW_TOP_FRACTION = 0.4;
/** With the bottom material-button row gone, the platform can sit much
 *  closer to the true bottom edge than before — this is the designer's
 *  requested margin (plus the device's safe-area inset, e.g. a gesture
 *  bar) between the platform's bottom edge and the screen's bottom edge
 *  whenever there's no tall tower pushing the view up. */
const PLATFORM_BOTTOM_MARGIN_PX = 60;
/** Height HUD stability (playtest: "numbers very often changing"). The
 *  displayed height only moves once the raw measured height has held
 *  HEIGHT_DISPLAY_STABLE_S seconds within HEIGHT_DISPLAY_NOISE_M of a new
 *  value, and only then if that new value is at least
 *  HEIGHT_DISPLAY_MIN_DELTA_M away from what's currently shown — see
 *  updateDisplayedHeight(). */
const HEIGHT_DISPLAY_MIN_DELTA_M = 0.1;
const HEIGHT_DISPLAY_STABLE_S = 0.3;
/** Raw-height wobble smaller than this doesn't reset the "how long has it
 *  been stable" timer — otherwise frame-to-frame floating point/physics
 *  noise (a piece's resting classification flickering) would never let the
 *  timer accumulate at all. */
const HEIGHT_DISPLAY_NOISE_M = 0.03;

declare global {
  interface Window {
    __materia?: {
      drop: () => boolean;
      setMaterial: (id: MaterialId) => void;
      pieceCount: () => number;
      countByMaterial: (id: MaterialId) => number;
      height: () => number;
      reset: () => void;
      stepFast: (seconds: number) => void;
      spawn: (material: MaterialId, xMeters: number, yMeters: number) => number | null;
      jointCount: () => number;
      freezeTopFlatness: () => number;
      freezeAngleDeg: () => number;
      /** Removes every piece without touching hearts/game-over state — for camera-recovery tests. */
      clearPieces: () => void;
      /** The platform top's current screen-space y in px (0 = top of screen, 960 = bottom). */
      platformScreenY: () => number;
      /** The current tower top's screen-space y in px, or null if nothing is resting. */
      towerTopScreenY: () => number | null;
      /** Cumulative count of impact fx (sound/haptic/effects) actually fired since load/last reset. */
      fxImpactCount: () => number;
      /** Zeroes fxImpactCount()'s counter, for measuring a fresh time window. */
      resetFxImpactCount: () => void;
      /** True once every current piece has gone to sleep. */
      allSleeping: () => boolean;
      /** The dev-panel wrench button's actual on-screen center (px), for
       *  e2e tests to click without guessing text-metrics pixel widths. */
      hudWrenchCenter: () => { x: number; y: number };
      /** Whether the dev material-picker panel is currently open. */
      hudDevPanelOpen: () => boolean;
      /** The dev panel's props text line for the currently selected material, e.g. "Steel · W10 H10 G3 B1 D0". */
      hudDevPropsLine: () => string;
      /** Last MAX_REMOVAL_LOG piece removals (id/material/reason/ageMs/at), oldest first — see PieceManager.removals(). */
      removals: () => RemovalRecord[];
      /** id of the most recently successfully dropped piece, or null if none yet — pair with pieceExists()/removals() to check a drop actually survives. */
      lastDroppedPieceId: () => number | null;
      /** True if a piece with this id is currently alive (in PieceManager.piecesById). */
      pieceExists: (id: number) => boolean;
      /** Number of pieces whose Rapier body is still dynamic (i.e. counts toward the piece-budget settle policy's DYNAMIC_PIECE_BUDGET). */
      dynamicPieceCount: () => number;
      /** Number of pieces the piece-budget settle policy has converted to fixed bodies (kept for visuals, no longer simulated). */
      settledPieceCount: () => number;
      /** The height HUD's actual displayed value (post-hysteresis — see updateDisplayedHeight), distinct from height() which is the raw measured value. */
      displayedHeight: () => number;
      squashLevel: (id: number) => number | null;
      hookDirection: () => number;
      spawnWormy: (xMeters: number, yMeters: number) => number | null;
    };
  }
}

export class GameScene extends Phaser.Scene {
  private pieceManager!: PieceManager;
  private platformTopY = 0;
  private hud!: Hud;
  private effects!: Effects;
  private debugPanel: DebugPanel | null = null;
  private debug = false;
  private materials: Record<MaterialId, Material> = MATERIALS;

  private hookContainer!: Phaser.GameObjects.Container;
  private hookGraphics!: Phaser.GameObjects.Graphics;
  private hookMaterial: MaterialId = 'wood';
  private nextMaterial: MaterialId = 'wood';
  private hookPhase = 0;
  private hookSwingSpeed = HOOK_BASE_SPEED;
  private hookX = 0;
  private hookCenterXM = 0;
  /** +1 = swinging right first, -1 = left first — flipped every spawnHookPreview() so each new piece starts opposite the previous one (GDD "Hook movement"). Starts at -1 so the very first piece flips to +1 (right), matching the old always-right behaviour. */
  private hookDirection = -1;
  private pendingOverride: MaterialId | null = null;
  /** True while the hook is carrying a wormy wood variant (GDD §2.0 — see forceWormyWood/spawnHookPreview). Only meaningful when hookMaterial === 'wood'. */
  private hookWormy = false;
  /** Set by forceWormyWood() when tapped mid-cooldown; consumed (and cleared) by the next spawnHookPreview(). */
  private pendingWormyOverride: boolean | null = null;

  private cooldownRemaining = 0;
  /** id of the most recently successfully dropped piece — test hook only (fuzz's "did my drop survive" check). */
  private lastDroppedId: number | null = null;
  private hearts = HEARTS_MAX;
  private gameOver = false;
  private currentHeightM = 0;
  private bestHeightM = 0;
  /** What the HUD actually shows — see updateDisplayedHeight(). Deliberately
   *  decoupled from currentHeightM (the real, raw measured height, used for
   *  bestHeightM/scoring) so the number doesn't visibly jitter every time a
   *  piece's "is it resting" classification flickers for a frame or two
   *  (e.g. a jelly settling/wobbling near SLOW_VELOCITY_THRESHOLD). */
  private displayedHeightM = 0;
  /** The raw height value updateDisplayedHeight is currently "watching" — reset every time currentHeightM moves more than HEIGHT_DISPLAY_NOISE_M away from it. */
  private pendingHeightM = 0;
  /** How long pendingHeightM has held steady (within HEIGHT_DISPLAY_NOISE_M). */
  private pendingHeightSinceS = 0;

  private initialScrollY = 0;
  private camScrollY = 0;
  private camTargetY = 0;
  /** Resting scrollY (platform's bottom margin from the screen's bottom
   *  edge) — see its computation in create() and use in updateCamera. */
  private restScrollY = 0;
  /** how long the tower has continuously been shorter than the camera's
   *  current target, for the CAMERA_DOWN_DELAY_S debounce (see updateCamera). */
  private towerLowerSinceS = 0;
  /** true once at least one piece has rested on the board — distinguishes a
   *  genuine "tower got shorter" (collapse) from the one-off reveal when the
   *  very first piece lands (see updateCamera). */
  private hadTower = false;
  /** true while the camera should use the slower "coming back down" lerp;
   *  set explicitly by updateCamera rather than inferred from comparing
   *  camScrollY/camTargetY, which would also (wrongly) catch the very first
   *  reveal — see hadTower. */
  private cameraGoingDown = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.hearts = HEARTS_MAX;
    this.bestHeightM = loadBestHeight();
    this.debug = isDebugBuild();
    this.materials = this.debug ? cloneMaterialsForRuntime() : MATERIALS;

    setMuted(loadMuted());
    setVibrationEnabled(loadVibrationEnabled());

    this.effects = new Effects(this, SCREEN_W, SCREEN_H);
    bindEffects(this.effects);

    this.pieceManager = new PieceManager(
      this,
      (m, o, f, x, y) => this.onImpact(m, o, f, x, y),
      () => this.loseHeart(),
      this.materials,
    );

    drawBackground(this, SCREEN_W, SCREEN_H);

    // World x=0 maps directly to screen pixel 0 (no horizontal camera scroll,
    // see updateCamera), so the platform/hook are centered in *world* meters
    // at SCREEN_W/2 px worth of meters, not at world x=0.
    this.hookCenterXM = SCREEN_W / 2 / PX_PER_M;
    const platformCenterYPx = GROUND_CENTER_Y_M * PX_PER_M;
    this.platformTopY = GROUND_CENTER_Y_M - PLATFORM_HALF_HEIGHT_M;
    this.pieceManager.rapierWorld.createStaticBox(
      this.hookCenterXM,
      GROUND_CENTER_Y_M,
      PLATFORM_HALF_WIDTH_M,
      PLATFORM_HALF_HEIGHT_M,
    );
    this.add
      .rectangle(
        SCREEN_W / 2,
        platformCenterYPx,
        PLATFORM_HALF_WIDTH_M * 2 * PX_PER_M,
        PLATFORM_HALF_HEIGHT_M * 2 * PX_PER_M,
        0x30343f,
      )
      .setStrokeStyle(2, 0x4a4f5c);

    // The camera's "resting" position: the platform's bottom edge sits
    // PLATFORM_BOTTOM_MARGIN_PX (plus the device safe-area inset) above the
    // screen's bottom edge. This is both the starting view (before any
    // piece lands) and the floor updateCamera clamps to, so an empty or
    // short tower always uses the space freed by removing the old bottom
    // button row instead of the view staying pinned tight on the platform.
    const platformBottomM = GROUND_CENTER_Y_M + PLATFORM_HALF_HEIGHT_M;
    const safeAreaBottomPx = getSafeAreaBottomPx();
    this.restScrollY =
      platformBottomM * PX_PER_M - (SCREEN_H - PLATFORM_BOTTOM_MARGIN_PX - safeAreaBottomPx);
    this.initialScrollY = this.restScrollY;
    this.camScrollY = this.initialScrollY;
    this.camTargetY = this.initialScrollY;
    this.cameras.main.scrollY = this.camScrollY;

    this.hookContainer = this.add.container(0, 0).setDepth(50);
    this.hookGraphics = this.add.graphics();
    this.hookContainer.add(this.hookGraphics);

    this.hud = new Hud(
      this,
      (id) => this.forceMaterial(id),
      () => this.toggleMute(),
      () => this.toggleVibration(),
      this.debug,
      () => this.forceWormyWood(),
    );
    this.hud.setBest(this.bestHeightM);
    this.hud.setMuted(isMuted());
    this.hud.setVibrationEnabled(isVibrationEnabled());

    if (this.debug) this.debugPanel = new DebugPanel(this.materials);

    this.nextMaterial = randomMaterial();
    this.spawnHookPreview();
    this.setupInput();
    this.exposeTestHooks();
  }

  private setupInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      initFxGesture();
      if (this.gameOver) {
        this.doReset();
        return;
      }
      if (this.hud.isPointerOverUI(pointer.x, pointer.y)) return;
      this.drop();
    });

    this.input.keyboard?.on('keydown-SPACE', () => {
      initFxGesture();
      if (this.gameOver) this.doReset();
      else this.drop();
    });
    // Dev-picker keys 1-8, in the same order as its 8 swatches
    // (ALL_MATERIAL_IDS: wood/stone/jelly/glass/steel/polystyrene/paper,
    // freeze last — see hud.ts).
    const KEY_NAMES = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
    ALL_MATERIAL_IDS.forEach((id, i) => {
      this.input.keyboard?.on(`keydown-${KEY_NAMES[i]}`, () => this.forceMaterial(id));
    });
    this.input.keyboard?.on('keydown-R', () => this.doReset());
  }

  private toggleMute(): void {
    const next = !isMuted();
    setMuted(next);
    saveMuted(next);
    this.hud.setMuted(next);
  }

  private toggleVibration(): void {
    const next = !isVibrationEnabled();
    setVibrationEnabled(next);
    saveVibrationEnabled(next);
    this.hud.setVibrationEnabled(next);
  }

  private exposeTestHooks(): void {
    window.__materia = {
      drop: () => this.drop(),
      setMaterial: (id) => this.forceMaterial(id),
      pieceCount: () => this.pieceManager.pieces.size,
      countByMaterial: (id) => this.pieceManager.countByMaterial(id),
      height: () => this.currentHeightM,
      reset: () => this.doReset(),
      stepFast: (seconds) => {
        const steps = Math.round(seconds * 60);
        for (let i = 0; i < steps; i++) this.safeFrameTick(1 / 60);
      },
      spawn: (material, xMeters, yMeters) => {
        return this.pieceManager.spawn(material, xMeters, yMeters)?.id ?? null;
      },
      spawnWormy: (xMeters, yMeters) => {
        return this.pieceManager.spawn('wood', xMeters, yMeters, true)?.id ?? null;
      },
      jointCount: () => this.pieceManager.freezeController.jointCount(),
      freezeTopFlatness: () => this.pieceManager.freezeController.topFlatness(),
      freezeAngleDeg: () => this.pieceManager.freezeController.freezeAngleDeg(),
      clearPieces: () => this.pieceManager.clear(),
      platformScreenY: () => this.platformTopY * PX_PER_M - this.camScrollY,
      towerTopScreenY: () => {
        const topM = this.pieceManager.tallestRestingTopM();
        return topM === null ? null : topM * PX_PER_M - this.camScrollY;
      },
      fxImpactCount: () => getImpactFxCount(),
      resetFxImpactCount: () => resetImpactFxCount(),
      allSleeping: () => this.pieceManager.allSleeping(),
      hudWrenchCenter: () => this.hud.wrenchCenter(),
      hudDevPanelOpen: () => this.hud.isDevPanelOpen(),
      hudDevPropsLine: () => this.hud.devPropsLine(),
      removals: () => this.pieceManager.removals(),
      lastDroppedPieceId: () => this.lastDroppedId,
      pieceExists: (id) => this.pieceManager.piecesById.has(id),
      dynamicPieceCount: () => this.pieceManager.dynamicPieceCount(),
      settledPieceCount: () => this.pieceManager.settledPieceCount(),
      displayedHeight: () => this.displayedHeightM,
      squashLevel: (id) => this.pieceManager.piecesById.get(id)?.squash?.level ?? null,
      hookDirection: () => this.hookDirection,
    };
  }

  update(_time: number, delta: number): void {
    if (this.gameOver) return;
    const dt = Math.min(delta / 1000, 1 / 30);
    this.safeFrameTick(dt);
  }

  /**
   * Safety net (playtest crash: an uncaught exception mid-frame — a Rapier
   * WASM panic from a stale joint handle was the actual bug, now fixed at
   * the source in FreezeController/PieceManager — left the update loop
   * dead and the player stuck with every piece gone and no way to drop
   * another). Any *other* unforeseen error during a frame is now caught
   * here rather than silently killing future update() calls: it's logged
   * with its stack, the game state is reset the same way tapping "restart"
   * does, and the player sees a small toast instead of a frozen board.
   */
  private safeFrameTick(dt: number): void {
    try {
      this.frameTick(dt);
    } catch (err) {
      this.handleFatalError(err);
    }
  }

  private handleFatalError(err: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[materia] recovered from an error in the game loop:', err instanceof Error ? (err.stack ?? err.message) : err);
    try {
      this.doReset('error');
    } catch (resetErr) {
      // eslint-disable-next-line no-console
      console.error('[materia] recovery reset itself failed:', resetErr);
    }
    try {
      this.hud.showToast('Oops — restarted');
    } catch {
      // Nothing more we can do if even the toast fails — the reset above
      // already ran, so the player can keep playing either way.
    }
  }

  private frameTick(dt: number): void {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
      if (this.cooldownRemaining === 0) this.spawnHookPreview();
    } else {
      this.hookPhase += dt * this.hookSwingSpeed;
      this.hookX = this.hookCenterXM + Math.sin(this.hookPhase) * HOOK_AMPLITUDE_M * this.hookDirection;
    }

    const physicsDt = consumeHitStopDt(dt);
    this.pieceManager.step(physicsDt, this.platformTopY + FAIL_MARGIN_M);
    updateEffects(dt);
    this.updateCamera(dt);
    this.updateDisplayedHeight(dt);
    this.pieceManager.syncRender();
    this.syncHook();

    this.hud.setHeight(this.displayedHeightM);
    this.hud.setBest(this.bestHeightM);
    this.hud.setHearts(this.hearts, HEARTS_MAX);
    if (this.debug) this.hud.setDebugStats(this.game.loop.actualFps, this.pieceManager.pieces.size);
  }

  private onImpact(pieceMaterial: MaterialId, otherMaterial: MaterialId | null, force: number, x: number, y: number): void {
    fx(pieceMaterial, otherMaterial, force, x, y);
  }

  /**
   * Follows the current tower top in both directions: up as it grows, and
   * back down once it collapses/shrinks, so the platform never gets stranded
   * off-screen above the camera (the original bug — the target only ever
   * moved up). tallestRestingTopM already ignores falling/flying pieces, so
   * a piece still tumbling mid-collapse can't drag the target around.
   *
   * The reference point is clamped to the platform's own top at most: a
   * piece that has slid off the platform edge (resting, but below platform
   * level, still short of the fail line/FAIL_MARGIN_M) must never read as
   * "taller" than the platform itself, or it drags desiredScrollY past a
   * safe bound and shoves the platform down past the screen's bottom edge —
   * this is the camera "overshooting downward". With this clamp,
   * desiredScrollY's largest possible value keeps the platform's own top
   * framed at VIEW_TOP_FRACTION, so once any piece is resting the tower top
   * is always shown at about VIEW_TOP_FRACTION from the top and never lower
   * on screen than that (see maxScrollY below) — unchanged by the bottom
   * button row's removal.
   *
   * Only the *no-tower* view (nothing resting at all: game start, or right
   * after everything's cleared) uses the freed-up space instead: restScrollY
   * (see create()) sits the platform's own bottom edge just
   * PLATFORM_BOTTOM_MARGIN_PX above the screen's bottom edge — closer to it
   * than the old bottom button row ever allowed.
   *
   * Moving down is debounced (CAMERA_DOWN_DELAY_S) and lerped more slowly
   * (CAMERA_LERP_DOWN) than moving up, so a momentary dip while a tower
   * resettles doesn't bounce the view. Which lerp speed applies is decided
   * explicitly (cameraGoingDown) rather than by comparing camTargetY to
   * camScrollY: that raw comparison doesn't know a target value came from
   * the differently-scaled "empty board" framing (initialScrollY) rather
   * than an actual shrink, and would misclassify the very first piece
   * landing as "the tower got shorter" — leaving the top framed well below
   * VIEW_TOP_FRACTION for several seconds (see hadTower below).
   */
  private updateCamera(dt: number): void {
    const topM = this.pieceManager.tallestRestingTopM();
    if (topM !== null) {
      const referenceTopM = Math.min(topM, this.platformTopY);
      const desiredScrollY = referenceTopM * PX_PER_M - VIEW_TOP_FRACTION * SCREEN_H;
      this.currentHeightM = Math.max(0, this.platformTopY - topM);

      if (!this.hadTower) {
        // The board's very first resting piece(s): jump straight to framing
        // them, not a "coming back down from a collapse" motion.
        this.camTargetY = desiredScrollY;
        this.towerLowerSinceS = 0;
        this.cameraGoingDown = false;
        this.hadTower = true;
      } else if (desiredScrollY > this.camTargetY) {
        // Tower is shorter than what the camera is currently framing.
        this.towerLowerSinceS += dt;
        if (this.towerLowerSinceS >= CAMERA_DOWN_DELAY_S) {
          this.camTargetY = desiredScrollY;
          this.cameraGoingDown = true;
        }
      } else {
        this.towerLowerSinceS = 0;
        this.camTargetY = desiredScrollY;
        this.cameraGoingDown = false;
      }
    } else {
      // Nothing resting (empty board) — go straight back to the low,
      // freed-space "rest" view (see restScrollY / the class doc above).
      this.currentHeightM = 0;
      this.camTargetY = this.restScrollY;
      this.towerLowerSinceS = 0;
      this.cameraGoingDown = false;
      this.hadTower = false;
    }

    // Belt-and-suspenders on top of the referenceTopM clamp above: once any
    // piece is resting, the target can never ask to frame the platform's own
    // top any lower than VIEW_TOP_FRACTION, so it can never overshoot down
    // into (or past) the screen's bottom edge. The no-tower view already
    // uses restScrollY directly (see the topM === null branch above), and
    // restScrollY is always <= this bound (it sits lower on screen, using
    // the freed-up space), so this min() never pulls it back up.
    const maxScrollY = this.platformTopY * PX_PER_M - VIEW_TOP_FRACTION * SCREEN_H;
    this.camTargetY = Math.min(this.camTargetY, maxScrollY);

    const lerp = this.cameraGoingDown ? CAMERA_LERP_DOWN : CAMERA_LERP;
    this.camScrollY = Phaser.Math.Linear(this.camScrollY, this.camTargetY, lerp);
    this.cameras.main.scrollY = this.camScrollY;

    if (this.currentHeightM > this.bestHeightM) {
      this.bestHeightM = this.currentHeightM;
      saveBestHeight(this.bestHeightM);
    }
  }

  /**
   * Updates displayedHeightM from the raw currentHeightM with hysteresis
   * (see the HEIGHT_DISPLAY_* constants) so the HUD number reads as a
   * series of deliberate steps instead of jittering every frame a piece's
   * "resting" classification flickers.
   */
  private updateDisplayedHeight(dt: number): void {
    const raw = this.currentHeightM;
    if (Math.abs(raw - this.pendingHeightM) > HEIGHT_DISPLAY_NOISE_M) {
      this.pendingHeightM = raw;
      this.pendingHeightSinceS = 0;
    } else {
      this.pendingHeightSinceS += dt;
    }
    if (
      Math.abs(this.pendingHeightM - this.displayedHeightM) >= HEIGHT_DISPLAY_MIN_DELTA_M &&
      this.pendingHeightSinceS >= HEIGHT_DISPLAY_STABLE_S
    ) {
      this.displayedHeightM = this.pendingHeightM;
    }
  }

  private syncHook(): void {
    if (this.cooldownRemaining <= 0) {
      this.hookContainer.setVisible(true);
      this.hookContainer.x = this.hookX * PX_PER_M;
      this.hookContainer.y = this.camScrollY + HOOK_SCREEN_Y_PX;
    } else {
      this.hookContainer.setVisible(false);
    }
  }

  private spawnHookPreview(): void {
    const material = this.pendingOverride ?? this.nextMaterial;
    // A forced wormy override always wins; otherwise a plain wood pick
    // rolls its own ~1-in-6 chance here (so the hook's visual — worm holes
    // or not — always matches what spawn() will actually create) — every
    // other material is never wormy.
    const wormy =
      this.pendingWormyOverride ?? (material === 'wood' ? Math.random() < WORMY_WOOD_HOOK_CHANCE : false);
    this.pendingOverride = null;
    this.pendingWormyOverride = null;
    this.setHookMaterial(material, wormy);
    this.nextMaterial = randomMaterial();
    this.hud.setNextMaterial(this.nextMaterial);
    this.hookPhase = 0;
    this.hookX = this.hookCenterXM;
    this.hookDirection = -this.hookDirection; // alternate: opposite of the previous piece's starting direction
    this.hookSwingSpeed = Math.min(
      HOOK_SPEED_MAX,
      HOOK_BASE_SPEED + this.currentHeightM * HOOK_SPEED_HEIGHT_FACTOR,
    );
  }

  private setHookMaterial(id: MaterialId, wormy = false): void {
    this.hookMaterial = id;
    this.hookWormy = id === 'wood' && wormy;
    const size = this.materials[id].size;
    const wPx = size.width * PX_PER_M;
    const hPx = size.height * PX_PER_M;
    const seed = Date.now() % 1000;
    drawPieceBase(this.hookGraphics, this.materials[id], wPx, hPx, seed);
    if (this.hookWormy) drawWormHoles(this.hookGraphics, wPx, hPx, 0, seed, 0);
    this.hud.setSelectedMaterial(id);
    this.hud.setWormySelected(this.hookWormy);
  }

  private forceMaterial(id: MaterialId): void {
    if (this.cooldownRemaining <= 0) this.setHookMaterial(id);
    else {
      this.pendingOverride = id;
      this.pendingWormyOverride = false;
    }
  }

  /** Dev-picker "Wormy" swatch: forces the next piece to be wood, and wormy. */
  private forceWormyWood(): void {
    if (this.cooldownRemaining <= 0) this.setHookMaterial('wood', true);
    else {
      this.pendingOverride = 'wood';
      this.pendingWormyOverride = true;
    }
  }

  drop(): boolean {
    if (this.gameOver || this.cooldownRemaining > 0) return false;
    const yM = (this.camScrollY + HOOK_SCREEN_Y_PX) / PX_PER_M;
    // spawn() always succeeds now (piece-budget policy settles/culls old
    // pieces instead of ever refusing a new one — see PieceManager's
    // maintainPieceBudget), but this null-check/early-return is kept as a
    // defensive guard: if spawn() ever legitimately returns null again in
    // the future, a tap must never silently start a cooldown for a piece
    // that doesn't exist.
    // hookWormy is passed through explicitly (never left for spawn() to
    // re-roll) so the piece that's actually created always matches what the
    // hook's preview graphics just showed the player.
    const piece = this.pieceManager.spawn(
      this.hookMaterial,
      this.hookX,
      yM,
      this.hookMaterial === 'wood' ? this.hookWormy : undefined,
    );
    if (!piece) return false;
    this.lastDroppedId = piece.id;
    this.cooldownRemaining = DROP_COOLDOWN_S;
    return true;
  }

  private loseHeart(): void {
    this.hearts = Math.max(0, this.hearts - 1);
    if (this.hearts <= 0) {
      this.gameOver = true;
      this.hud.setGameOver(true, this.currentHeightM, this.bestHeightM);
    }
  }

  private doReset(reason: 'reset' | 'error' = 'reset'): void {
    this.pieceManager.clear(reason);
    this.hearts = HEARTS_MAX;
    this.gameOver = false;
    this.hud.setGameOver(false);
    this.cooldownRemaining = 0;
    this.camScrollY = this.initialScrollY;
    this.camTargetY = this.initialScrollY;
    this.towerLowerSinceS = 0;
    this.cameraGoingDown = false;
    this.hadTower = false;
    this.currentHeightM = 0;
    this.displayedHeightM = 0;
    this.pendingHeightM = 0;
    this.pendingHeightSinceS = 0;
    this.pendingOverride = null;
    this.pendingWormyOverride = null;
    this.lastDroppedId = null;
    this.nextMaterial = randomMaterial();
    this.spawnHookPreview();
  }
}
