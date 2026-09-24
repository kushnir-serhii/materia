// Dark gradient background + a faint scrolling grid for depth. Drawn once;
// nothing here needs per-frame updates.

import Phaser from 'phaser';
import { PX_PER_M } from '../physics/physics';

export function drawBackground(scene: Phaser.Scene, screenW: number, screenH: number): void {
  const bg = scene.add.graphics().setScrollFactor(0).setDepth(-20);
  bg.fillGradientStyle(0x1b1d24, 0x1b1d24, 0x2a2d3a, 0x2a2d3a, 1, 1, 1, 1);
  bg.fillRect(0, 0, screenW, screenH);

  const grid = scene.add.graphics().setDepth(-10);
  grid.lineStyle(1, 0xffffff, 0.04);
  const topM = -60;
  const bottomM = 20;
  for (let m = topM; m <= bottomM; m++) {
    const y = m * PX_PER_M;
    grid.beginPath();
    grid.moveTo(0, y);
    grid.lineTo(screenW, y);
    grid.strokePath();
  }
  for (let x = 0; x <= screenW; x += PX_PER_M) {
    grid.beginPath();
    grid.moveTo(x, topM * PX_PER_M);
    grid.lineTo(x, bottomM * PX_PER_M);
    grid.strokePath();
  }
}
