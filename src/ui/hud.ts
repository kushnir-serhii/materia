// Fixed-on-screen HUD: hearts, height, best height, next-piece mini preview,
// mute/vibration toggles, a dev-only material-picker panel, game-over
// overlay, and (debug builds only) an FPS/body-count readout. Everything
// here uses scrollFactor(0) so it never moves with the camera.

import Phaser from 'phaser';
import { MATERIALS, ALL_MATERIAL_IDS, type MaterialId } from '../game/materials';
import { drawPieceBase, drawWormHoles } from './pieceView';
import { DEV_PICKER_LAYOUT, WORMY_SWATCH_INDEX } from './devPickerLayout';

export { DEV_PICKER_LAYOUT };

const SCREEN_W = 540;
const SCREEN_H = 960;

/** Mini preview box for the "next" piece — deliberately not the same aspect
 *  as PLANK_SIZE; it's a small icon, not a scaled-down real piece. */
const PREVIEW_W_PX = 54;
const PREVIEW_H_PX = 26;

const SWATCH_SIZE = DEV_PICKER_LAYOUT.swatchSize;
const SWATCH_GAP = DEV_PICKER_LAYOUT.swatchGap;
const PANEL_RIGHT_X = DEV_PICKER_LAYOUT.panelRightX;
const PANEL_TOP_Y = DEV_PICKER_LAYOUT.panelTopY;

const MATERIAL_NAMES: Record<MaterialId, string> = {
  wood: 'Wood',
  stone: 'Stone',
  jelly: 'Jelly',
  glass: 'Glass',
  steel: 'Steel',
  polystyrene: 'Polystyrene',
  cardboard: 'Cardboard',
  freeze: 'Freeze',
};

export class Hud {
  private heightText: Phaser.GameObjects.Text;
  private bestText: Phaser.GameObjects.Text;
  private heartsText: Phaser.GameObjects.Text;
  private nextContainer: Phaser.GameObjects.Container;
  private nextGraphics: Phaser.GameObjects.Graphics;
  private nextLabel: Phaser.GameObjects.Text;
  private muteButton: Phaser.GameObjects.Text;
  private vibrateButton: Phaser.GameObjects.Text;
  private wrenchButton: Phaser.GameObjects.Text;
  private devPanel: Phaser.GameObjects.Container;
  private devPanelBg: Phaser.GameObjects.Rectangle;
  private devPropsText: Phaser.GameObjects.Text;
  private devSwatches = {} as Record<MaterialId, Phaser.GameObjects.Rectangle>;
  private wormySwatch!: Phaser.GameObjects.Rectangle;
  private wormySelected = false;
  private devPanelOpen = false;
  private overlay: Phaser.GameObjects.Container;
  private overlayText: Phaser.GameObjects.Text;
  private debugText: Phaser.GameObjects.Text | null = null;
  private toastText: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private scene: Phaser.Scene;
  private currentNext: MaterialId | null = null;
  private currentSelected: MaterialId | null = null;

  constructor(
    scene: Phaser.Scene,
    onPickMaterial: (id: MaterialId) => void,
    onToggleMute: () => void,
    onToggleVibration: () => void,
    debug: boolean,
    onPickWormy: () => void = () => {},
  ) {
    this.scene = scene;
    this.heightText = scene.add
      .text(16, 16, '0.0 m', { fontSize: '28px', color: '#ffffff', fontStyle: 'bold' })
      .setScrollFactor(0)
      .setDepth(100);

    this.bestText = scene.add
      .text(16, 50, 'best 0.0 m', { fontSize: '16px', color: '#9aa0ac' })
      .setScrollFactor(0)
      .setDepth(100);

    this.heartsText = scene.add
      .text(SCREEN_W - 16, 16, '', { fontSize: '24px', color: '#ff5d73' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);

    // "Next" preview: a small drawn version of the upcoming piece, centred
    // top between the height readout (left) and hearts/toggles (right).
    // Positioned at y=32 so piece top is at 19px, fully visible, aligned with height text.
    this.nextContainer = scene.add.container(SCREEN_W / 2, 32).setScrollFactor(0).setDepth(100);
    this.nextGraphics = scene.add.graphics().setScrollFactor(0);
    this.nextLabel = scene.add
      .text(0, PREVIEW_H_PX / 2 + 6, 'next', { fontSize: '11px', color: '#9aa0ac' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.nextContainer.add([this.nextGraphics, this.nextLabel]);

    this.muteButton = scene.add
      .text(SCREEN_W - 16, 46, '🔊', { fontSize: '20px' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });
    this.muteButton.on('pointerdown', onToggleMute);

    this.vibrateButton = scene.add
      .text(SCREEN_W - 52, 46, '📳', { fontSize: '20px' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });
    this.vibrateButton.on('pointerdown', onToggleVibration);

    // Dev tool: a wrench toggles a compact picker that forces the next
    // piece. Hidden by default; state is never persisted (a fresh page load
    // always starts with it closed) — this replaces the old always-visible
    // bottom material-button row, which the designer wanted off the normal
    // play screen. Needed because the playtest build can't pass ?debug=1.
    this.wrenchButton = scene.add
      .text(DEV_PICKER_LAYOUT.wrenchX, DEV_PICKER_LAYOUT.wrenchY, '🔧', { fontSize: '18px' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });
    this.wrenchButton.on('pointerdown', () => this.toggleDevPanel());

    this.devPanel = scene.add.container(0, 0).setScrollFactor(0).setDepth(100).setVisible(false);
    const gridW = DEV_PICKER_LAYOUT.gridW;
    const gridH = DEV_PICKER_LAYOUT.gridH;
    const panelH = gridH + 10 + DEV_PICKER_LAYOUT.propsLineH;
    this.devPanelBg = scene.add
      .rectangle(PANEL_RIGHT_X - gridW / 2, PANEL_TOP_Y + panelH / 2 - 5, gridW + 12, panelH, 0x14161c, 0.85)
      .setStrokeStyle(1, 0x3a3f4a)
      .setScrollFactor(0);
    this.devPanel.add(this.devPanelBg);
    ALL_MATERIAL_IDS.forEach((id, i) => {
      const cx = DEV_PICKER_LAYOUT.swatchCenterX(i);
      const cy = DEV_PICKER_LAYOUT.swatchCenterY(i);
      const material = MATERIALS[id];
      // Interactive children of a scrollFactor(0) container must set their
      // *own* scrollFactor(0) too — Phaser's input hit-testing reads each
      // game object's own scrollFactorX/Y (default 1) when computing the
      // pointer's local position, independently of the container's; without
      // this the swatch's hit area silently drifts by the camera's current
      // scroll and taps stop landing on it once the camera has moved.
      const bg = scene.add
        .rectangle(cx, cy, SWATCH_SIZE, SWATCH_SIZE, material.colors.fill, 0.9)
        .setStrokeStyle(2, material.colors.stroke)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => onPickMaterial(id));
      this.devSwatches[id] = bg;
      const label = scene.add
        .text(cx, cy, `${i + 1}`, { fontSize: '10px', color: '#101010', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.devPanel.add([bg, label]);
    });

    // Extra "Wormy" swatch (forces the next piece to a wormy wood variant —
    // GDD §2.0) — wood-colored with a worm-hole overlay so it reads
    // distinctly from the plain wood swatch.
    {
      const cx = DEV_PICKER_LAYOUT.swatchCenterX(WORMY_SWATCH_INDEX);
      const cy = DEV_PICKER_LAYOUT.swatchCenterY(WORMY_SWATCH_INDEX);
      const wood = MATERIALS.wood;
      this.wormySwatch = scene.add
        .rectangle(cx, cy, SWATCH_SIZE, SWATCH_SIZE, wood.colors.fill, 0.9)
        .setStrokeStyle(2, wood.colors.stroke)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      this.wormySwatch.on('pointerdown', onPickWormy);
      const wormyIcon = scene.add.graphics().setScrollFactor(0).setPosition(cx, cy);
      drawWormHoles(wormyIcon, SWATCH_SIZE, SWATCH_SIZE, 2, 777, 0);
      const label = scene.add
        .text(cx, cy, 'W', { fontSize: '10px', color: '#101010', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.devPanel.add([this.wormySwatch, wormyIcon, label]);
    }

    // Small text line under the grid showing the selected swatch's props
    // (GDD §2.0 designer scale), e.g. "Steel · W10 H10 G3 B1 D0" — updated
    // by setSelectedMaterial().
    const propsLineY = PANEL_TOP_Y + gridH + 8;
    this.devPropsText = scene.add
      .text(PANEL_RIGHT_X - gridW / 2, propsLineY, '', { fontSize: '10px', color: '#c6cad4' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.devPanel.add(this.devPropsText);

    this.overlay = scene.add.container(SCREEN_W / 2, SCREEN_H / 2).setScrollFactor(0).setDepth(200);
    const overlayBg = scene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6).setScrollFactor(0);
    this.overlayText = scene.add
      .text(0, 0, 'Tower fell!\nTap to restart', { fontSize: '28px', color: '#ffffff', align: 'center' })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.overlay.add([overlayBg, this.overlayText]);
    this.overlay.setVisible(false);

    if (debug) {
      this.debugText = scene.add
        .text(16, SCREEN_H - 90, '', { fontSize: '12px', color: '#7CFC00' })
        .setScrollFactor(0)
        .setDepth(300);
    }

    // Safety-net toast (GameScene.handleFatalError): a brief, dismissible
    // "we recovered" notice, never blocking input.
    this.toastText = scene.add
      .text(SCREEN_W / 2, 90, '', { fontSize: '15px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 10, y: 6 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(400)
      .setVisible(false);
  }

  private toggleDevPanel(): void {
    this.devPanelOpen = !this.devPanelOpen;
    this.devPanel.setVisible(this.devPanelOpen);
  }

  /** The wrench button's actual on-screen center — e2e tests use this
   *  instead of guessing text-metrics-dependent pixel coordinates. */
  wrenchCenter(): { x: number; y: number } {
    const b = this.wrenchButton.getBounds();
    return { x: b.centerX, y: b.centerY };
  }

  isDevPanelOpen(): boolean {
    return this.devPanelOpen;
  }

  /**
   * True if (x, y) — in the same screen-pixel space as a pointer event —
   * lands on any interactive HUD control (mute/vibrate/wrench, or an open
   * dev panel's swatches). GameScene checks this before treating a tap as a
   * "drop a piece" tap, so tapping a HUD control never also spawns a piece.
   */
  isPointerOverUI(x: number, y: number): boolean {
    const hits = [this.muteButton, this.vibrateButton, this.wrenchButton];
    for (const obj of hits) {
      if (Phaser.Geom.Rectangle.Contains(obj.getBounds(), x, y)) return true;
    }
    if (this.devPanelOpen && Phaser.Geom.Rectangle.Contains(this.devPanelBg.getBounds(), x, y)) return true;
    return false;
  }

  /** Briefly shows `message` near the top of the screen, then fades it out. Used by GameScene's per-frame error recovery so the player sees *something* changed instead of the game just silently resetting. */
  showToast(message: string, durationMs = 2000): void {
    this.toastTimer?.remove();
    this.toastText.setText(message).setAlpha(1).setVisible(true);
    this.toastTimer = this.scene.time.delayedCall(durationMs, () => {
      this.scene.tweens.add({
        targets: this.toastText,
        alpha: 0,
        duration: 300,
        onComplete: () => this.toastText.setVisible(false),
      });
    });
  }

  setHeight(m: number): void {
    this.heightText.setText(`${m.toFixed(1)} m`);
  }

  setBest(m: number): void {
    this.bestText.setText(`best ${m.toFixed(1)} m`);
  }

  setHearts(hearts: number, max: number): void {
    this.heartsText.setText('♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(Math.max(0, max - hearts)));
  }

  /** Redraws the next-piece mini preview and, if the material actually
   *  changed, plays a quick pop/slide so the change reads as an event. */
  setNextMaterial(id: MaterialId): void {
    const changed = this.currentNext !== id;
    this.currentNext = id;
    drawPieceBase(this.nextGraphics, MATERIALS[id], PREVIEW_W_PX, PREVIEW_H_PX, Date.now() % 1000);
    if (changed) {
      this.scene.tweens.killTweensOf(this.nextContainer);
      this.nextContainer.setScale(0.55);
      this.nextContainer.y = 26;
      this.scene.tweens.add({
        targets: this.nextContainer,
        scale: 1,
        y: 32,
        duration: 220,
        ease: 'Back.Out',
      });
    }
  }

  setMuted(muted: boolean): void {
    this.muteButton.setText(muted ? '🔇' : '🔊');
  }

  setVibrationEnabled(on: boolean): void {
    this.vibrateButton.setText(on ? '📳' : '🚫');
  }

  /** Highlights the currently forced/hook material's swatch in the dev
   *  panel and updates the props text line below it (a no-op visually
   *  while the panel is closed, but kept in sync regardless). */
  setSelectedMaterial(id: MaterialId): void {
    this.currentSelected = id;
    ALL_MATERIAL_IDS.forEach((mid) => {
      const btn = this.devSwatches[mid];
      if (mid === this.currentSelected) btn.setStrokeStyle(3, 0xffffff, 1);
      else btn.setStrokeStyle(2, MATERIALS[mid].colors.stroke, 1);
    });
    const p = MATERIALS[id].props;
    this.devPropsText.setText(
      `${MATERIAL_NAMES[id]} · W${p.weight} H${p.hardness} G${p.grip} B${p.bounce} D${p.airDrag}`,
    );
  }

  /** The currently selected material's props text line, e.g. "Steel · W10 H10 G3 B1 D0" (test hook). */
  devPropsLine(): string {
    return this.devPropsText.text;
  }

  /** Highlights (or unhighlights) the extra "Wormy" swatch — GameScene calls this whenever the hook's wormy flag changes, alongside setSelectedMaterial. */
  setWormySelected(active: boolean): void {
    this.wormySelected = active;
    this.wormySwatch.setStrokeStyle(this.wormySelected ? 3 : 2, this.wormySelected ? 0xffffff : MATERIALS.wood.colors.stroke, 1);
  }

  setGameOver(over: boolean, heightM = 0, bestM = 0): void {
    this.overlay.setVisible(over);
    if (over) {
      this.overlayText.setText(`Tower fell!\n${heightM.toFixed(1)} m  ·  best ${bestM.toFixed(1)} m\nTap to restart`);
    }
  }

  setDebugStats(fps: number, bodyCount: number): void {
    this.debugText?.setText(`FPS: ${fps.toFixed(0)}   bodies: ${bodyCount}`);
  }
}
