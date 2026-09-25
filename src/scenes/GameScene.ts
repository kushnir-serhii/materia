import Phaser from 'phaser';
import { PX_PER_M } from '../physics/physics';
import { MATERIALS, MATERIAL_IDS, PLANK_SIZE, cloneMaterialsForRuntime, type Material, type MaterialId } from '../game/materials';
import { drawPieceBase } from '../ui/pieceView';
import { drawBackground } from '../ui/background';
import { Hud, HUD_BUTTON_ZONE_TOP } from '../ui/hud';
import { DebugPanel } from '../ui/debugPanel';
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
const VIEW_TOP_FRACTION = 0.4;

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

    this.initialScrollY = platformCenterYPx - SCREEN_H * 0.85;
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
      if (pointer.y >= HUD_BUTTON_ZONE_TOP) return;
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
        for (let i = 0; i < steps; i++) this.frameTick(1 / 60);
      },
      spawn: (material, xMeters, yMeters) => {
        this.pieceManager.spawn(material, xMeters, yMeters);
      },
      jointCount: () => this.pieceManager.freezeController.jointCount(),
      freezeTopFlatness: () => this.pieceManager.freezeController.topFlatness(),
    };
  }

  update(_time: number, delta: number): void {
    if (this.gameOver) return;
    const dt = Math.min(delta / 1000, 1 / 30);
    this.frameTick(dt);
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
    this.updateCamera();
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

  private updateCamera(): void {
    const topM = this.pieceManager.tallestRestingTopM();
    if (topM !== null) {
      const desiredScrollY = topM * PX_PER_M - VIEW_TOP_FRACTION * SCREEN_H;
      this.camTargetY = Math.min(this.camTargetY, desiredScrollY);
      this.currentHeightM = Math.max(0, this.platformTopY - topM);
    } else {
      this.currentHeightM = 0;
    }

    this.camScrollY = Phaser.Math.Linear(this.camScrollY, this.camTargetY, CAMERA_LERP);
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
    this.currentHeightM = 0;
    this.pendingOverride = null;
    this.nextMaterial = randomMaterial();
    this.spawnHookPreview();
  }
}
