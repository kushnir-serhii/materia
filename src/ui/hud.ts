// Fixed-on-screen HUD: hearts, height, best height, next-piece preview,
// mute/vibration toggles, material picker buttons, game-over overlay, and
// (debug builds only) an FPS/body-count readout. Everything here uses
// scrollFactor(0) so it never moves with the camera.

import Phaser from 'phaser';
import { MATERIALS, ALL_MATERIAL_IDS, type MaterialId } from '../game/materials';

const SCREEN_W = 540;
const SCREEN_H = 960;

/** Screen-space y above which the material-picker buttons live; GameScene
 *  ignores drop taps there so they don't double-fire with a button pick. */
export const HUD_BUTTON_ZONE_TOP = SCREEN_H - 70;

const MATERIAL_NAMES: Record<MaterialId, string> = {
  wood: 'Wood',
  stone: 'Stone',
  jelly: 'Jelly',
  glass: 'Glass',
  freeze: 'Freeze',
};

export class Hud {
  private heightText: Phaser.GameObjects.Text;
  private bestText: Phaser.GameObjects.Text;
  private heartsText: Phaser.GameObjects.Text;
  private nextText: Phaser.GameObjects.Text;
  private muteButton: Phaser.GameObjects.Text;
  private vibrateButton: Phaser.GameObjects.Text;
  private materialButtons = {} as Record<MaterialId, Phaser.GameObjects.Rectangle>;
  private overlay: Phaser.GameObjects.Container;
  private overlayText: Phaser.GameObjects.Text;
  private debugText: Phaser.GameObjects.Text | null = null;

  constructor(
    scene: Phaser.Scene,
    onPickMaterial: (id: MaterialId) => void,
    onToggleMute: () => void,
    onToggleVibration: () => void,
    debug: boolean,
  ) {
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

    this.nextText = scene.add
      .text(SCREEN_W / 2, 20, '', { fontSize: '14px', color: '#c7cbd6', fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);

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

    // 5 equal-width buttons (Wood, Stone, Jelly, Glass, Freeze), keys 1-5 —
    // freeze gets no special treatment here even though GDD §2.1 keeps it out
    // of the *random* rotation; as a manual pick it's just a 5th material.
    const buttonY = SCREEN_H - 40;
    const buttonW = SCREEN_W / ALL_MATERIAL_IDS.length;
    ALL_MATERIAL_IDS.forEach((id, i) => {
      const cx = buttonW * i + buttonW / 2;
      const material = MATERIALS[id];
      const bg = scene.add
        .rectangle(cx, buttonY, buttonW - 6, 56, material.colors.fill, 0.9)
        .setStrokeStyle(2, material.colors.stroke)
        .setScrollFactor(0)
        .setDepth(100)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => onPickMaterial(id));
      this.materialButtons[id] = bg;

      scene.add
        .text(cx, buttonY - 11, `${i + 1}`, { fontSize: '12px', color: '#101010', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(101);
      scene.add
        .text(cx, buttonY + 9, MATERIAL_NAMES[id], { fontSize: '11px', color: '#101010', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(101);
    });

    this.overlay = scene.add.container(SCREEN_W / 2, SCREEN_H / 2).setScrollFactor(0).setDepth(200);
    const overlayBg = scene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6);
    this.overlayText = scene.add
      .text(0, 0, 'Tower fell!\nTap to restart', { fontSize: '28px', color: '#ffffff', align: 'center' })
      .setOrigin(0.5);
    this.overlay.add([overlayBg, this.overlayText]);
    this.overlay.setVisible(false);

    if (debug) {
      this.debugText = scene.add
        .text(16, SCREEN_H - 90, '', { fontSize: '12px', color: '#7CFC00' })
        .setScrollFactor(0)
        .setDepth(300);
    }
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

  setNextMaterial(id: MaterialId): void {
    this.nextText.setText(`NEXT: ${MATERIAL_NAMES[id]}`);
  }

  setMuted(muted: boolean): void {
    this.muteButton.setText(muted ? '🔇' : '🔊');
  }

  setVibrationEnabled(on: boolean): void {
    this.vibrateButton.setText(on ? '📳' : '🚫');
  }

  /** Highlights the currently forced/hook material's button; clear/normal border on the rest. */
  setSelectedMaterial(id: MaterialId): void {
    ALL_MATERIAL_IDS.forEach((mid) => {
      const btn = this.materialButtons[mid];
      if (mid === id) btn.setStrokeStyle(4, 0xffffff, 1);
      else btn.setStrokeStyle(2, MATERIALS[mid].colors.stroke, 1);
    });
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
