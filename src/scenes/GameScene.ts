import Phaser from 'phaser';
import { PX_PER_M } from '../physics/physics';
import { MATERIALS, MATERIAL_IDS, PLANK_SIZE, cloneMaterialsForRuntime, type Material, type MaterialId } from '../game/materials';
import { drawPieceBase } from '../ui/pieceView';
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
import { PieceManager } from './PieceManager';

function isDebugBuild(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/** GDD §2.1: freeze is never a plain rotation slot, it's a ~1-in-10 special roll. */
const FREEZE_SPAWN_CHANCE = 0.1;

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
      spawn: (material: MaterialId, xMeters: number, yMeters: number) => void;
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
  private pendingOverride: MaterialId | null = null;

  private cooldownRemaining = 0;
  private hearts = HEARTS_MAX;
  private gameOver = false;
  private currentHeightM = 0;
  private bestHeightM = 0;

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
    this.input.keyboard?.on('keydown-ONE', () => this.forceMaterial('wood'));
    this.input.keyboard?.on('keydown-TWO', () => this.forceMaterial('stone'));
    this.input.keyboard?.on('keydown-THREE', () => this.forceMaterial('jelly'));
    this.input.keyboard?.on('keydown-FOUR', () => this.forceMaterial('glass'));
    this.input.keyboard?.on('keydown-FIVE', () => this.forceMaterial('freeze'));
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
        this.pieceManager.spawn(material, xMeters, yMeters);
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
      this.doReset();
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
      this.hookX = this.hookCenterXM + Math.sin(this.hookPhase) * HOOK_AMPLITUDE_M;
    }

    const physicsDt = consumeHitStopDt(dt);
    this.pieceManager.step(physicsDt, this.platformTopY + FAIL_MARGIN_M);
    updateEffects(dt);
    this.updateCamera(dt);
    this.pieceManager.syncRender();
    this.syncHook();

    this.hud.setHeight(this.currentHeightM);
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
    this.pendingOverride = null;
    this.setHookMaterial(material);
    this.nextMaterial = randomMaterial();
    this.hud.setNextMaterial(this.nextMaterial);
    this.hookPhase = 0;
    this.hookX = this.hookCenterXM;
    this.hookSwingSpeed = Math.min(
      HOOK_SPEED_MAX,
      HOOK_BASE_SPEED + this.currentHeightM * HOOK_SPEED_HEIGHT_FACTOR,
    );
  }

  private setHookMaterial(id: MaterialId): void {
    this.hookMaterial = id;
    const wPx = PLANK_SIZE.width * PX_PER_M;
    const hPx = PLANK_SIZE.height * PX_PER_M;
    drawPieceBase(this.hookGraphics, this.materials[id], wPx, hPx, Date.now() % 1000);
    this.hud.setSelectedMaterial(id);
  }

  private forceMaterial(id: MaterialId): void {
    if (this.cooldownRemaining <= 0) this.setHookMaterial(id);
    else this.pendingOverride = id;
  }

  drop(): boolean {
    if (this.gameOver || this.cooldownRemaining > 0) return false;
    const yM = (this.camScrollY + HOOK_SCREEN_Y_PX) / PX_PER_M;
    this.pieceManager.spawn(this.hookMaterial, this.hookX, yM);
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

  private doReset(): void {
    this.pieceManager.clear();
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
    this.pendingOverride = null;
    this.nextMaterial = randomMaterial();
    this.spawnHookPreview();
  }
}
