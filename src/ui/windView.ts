// Wind feedback: faint animated streaks across the screen plus a small
// arrow indicator near the top (chevron count = strength). One Graphics,
// redrawn only while a gust is active.

import Phaser from 'phaser';

const SCREEN_W = 540;
const SCREEN_H = 960;
const STREAKS = 18;
const ARROW_X = SCREEN_W / 2;
const ARROW_Y = 84;

export class WindView {
  private g: Phaser.GameObjects.Graphics;
  private xs = new Float32Array(STREAKS);
  private ys = new Float32Array(STREAKS);
  private lens = new Float32Array(STREAKS);
  private speeds = new Float32Array(STREAKS);
  private drawn = false;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(90);
    for (let i = 0; i < STREAKS; i++) {
      // deterministic spread, no Math.random needed for a cosmetic layout
      this.xs[i] = ((i * 137) % SCREEN_W) + 0;
      this.ys[i] = 130 + ((i * 211) % (SCREEN_H - 200));
      this.lens[i] = 30 + ((i * 53) % 50);
      this.speeds[i] = 0.7 + ((i * 29) % 60) / 100;
    }
  }

  /** intensity: signed [-1, 1] (negative = blowing left). */
  update(intensity: number, dt: number): void {
    const mag = Math.abs(intensity);
    if (mag < 0.01) {
      if (this.drawn) {
        this.g.clear();
        this.drawn = false;
      }
      return;
    }
    this.drawn = true;
    const dir = intensity > 0 ? 1 : -1;
    const g = this.g;
    g.clear();
    g.lineStyle(1.5, 0xffffff, 0.22 * mag);
    for (let i = 0; i < STREAKS; i++) {
      let x = this.xs[i] + dir * (300 + 900 * mag) * this.speeds[i] * dt;
      if (x > SCREEN_W + 80) x -= SCREEN_W + 160;
      else if (x < -80) x += SCREEN_W + 160;
      this.xs[i] = x;
      g.beginPath();
      g.moveTo(x, this.ys[i]);
      g.lineTo(x - dir * this.lens[i] * (0.6 + mag), this.ys[i]);
      g.strokePath();
    }
    // Arrow: shaft + 1-3 chevrons by strength.
    const chevrons = 1 + Math.round(mag * 2);
    g.lineStyle(3, 0xcfe8ff, 0.35 + 0.65 * mag);
    g.beginPath();
    g.moveTo(ARROW_X - dir * 16, ARROW_Y);
    g.lineTo(ARROW_X + dir * 16, ARROW_Y);
    g.strokePath();
    for (let c = 0; c < chevrons; c++) {
      const cx = ARROW_X + dir * (16 - c * 8);
      g.beginPath();
      g.moveTo(cx - dir * 6, ARROW_Y - 6);
      g.lineTo(cx, ARROW_Y);
      g.lineTo(cx - dir * 6, ARROW_Y + 6);
      g.strokePath();
    }
  }
}
