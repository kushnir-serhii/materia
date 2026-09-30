// The HOLD slot's on-screen box (left of the "next" preview): tap it to stash
// the hook piece / swap with the held one (GameScene decides the rules —
// see src/game/hold.ts). Shows the held piece in the same mini form as "next".

import Phaser from 'phaser';
import { MATERIALS, type MaterialId } from '../game/materials';
import { drawPieceBase } from './pieceView';

const BOX_W = 66;
const BOX_H = 40;
const PIECE_W = 50;
const PIECE_H = 24;
/** Centre, screen px — just left of the "next" preview (x=270). */
export const HOLD_BOX_X = 190;
export const HOLD_BOX_Y = 32;

export class HoldBox {
  private container: Phaser.GameObjects.Container;
  private frame: Phaser.GameObjects.Graphics;
  private piece: Phaser.GameObjects.Graphics;
  private hit: Phaser.GameObjects.Rectangle;
  private current: MaterialId | null = null;

  constructor(private scene: Phaser.Scene, onTap: () => void) {
    this.container = scene.add.container(HOLD_BOX_X, HOLD_BOX_Y).setScrollFactor(0).setDepth(100);
    this.frame = scene.add.graphics().setScrollFactor(0);
    this.piece = scene.add.graphics().setScrollFactor(0);
    const label = scene.add
      .text(0, BOX_H / 2 + 3, 'hold', { fontSize: '11px', color: '#9aa0ac' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.hit = scene.add
      .rectangle(HOLD_BOX_X, HOLD_BOX_Y, BOX_W, BOX_H, 0xffffff, 0.001)
      .setScrollFactor(0)
      .setDepth(101)
      .setInteractive({ useHandCursor: true });
    this.hit.on('pointerdown', onTap);
    this.container.add([this.frame, this.piece, label]);
    this.draw(true);
  }

  private draw(available: boolean): void {
    this.frame.clear();
    this.frame.fillStyle(0x14161c, 0.55);
    this.frame.fillRoundedRect(-BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H, 6);
    this.frame.lineStyle(2, available ? 0x7d8698 : 0x3a3f4a, 1);
    this.frame.strokeRoundedRect(-BOX_W / 2, -BOX_H / 2, BOX_W, BOX_H, 6);
  }

  /** Shows the held piece (or an empty slot) and greys the box out once this drop's hold is used up. */
  setHeld(id: MaterialId | null, used: boolean): void {
    this.draw(!used);
    this.container.setAlpha(used ? 0.55 : 1);
    if (id !== this.current) {
      this.current = id;
      this.piece.clear();
      if (id) drawPieceBase(this.piece, MATERIALS[id], PIECE_W, PIECE_H, Date.now() % 1000);
      this.scene.tweens.killTweensOf(this.container);
      this.container.setScale(0.7);
      this.scene.tweens.add({ targets: this.container, scale: 1, duration: 200, ease: 'Back.Out' });
    }
  }

  /** True if the screen-space point is over the box (GameScene: a hold tap must never also drop a piece). */
  contains(x: number, y: number): boolean {
    return Math.abs(x - HOLD_BOX_X) <= BOX_W / 2 && Math.abs(y - HOLD_BOX_Y) <= BOX_H / 2;
  }

  center(): { x: number; y: number } {
    return { x: HOLD_BOX_X, y: HOLD_BOX_Y };
  }
}
