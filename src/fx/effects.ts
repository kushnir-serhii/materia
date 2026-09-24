// Phaser-side impact effects: dust, camera shake, hit-stop, glass shards +
// flash, jelly droplets. Everything is pooled at construction time — no
// per-frame allocations, only reused Graphics/Shape game objects and their
// tween/velocity state (GDD §6 perf budget).

import Phaser from 'phaser';

const DUST_POOL_SIZE = 18;
const SHARD_POOL_SIZE = 24; // one shatter uses 10-16; a little headroom for overlap
const DROPLET_POOL_SIZE = 12;

const GRAVITY_PX_S2 = 320;

interface PooledDust {
  obj: Phaser.GameObjects.Arc;
  busy: boolean;
}

interface PooledShard {
  obj: Phaser.GameObjects.Triangle;
  busy: boolean;
  vx: number;
  vy: number;
  vr: number;
  life: number;
  maxLife: number;
}

interface PooledDroplet {
  obj: Phaser.GameObjects.Arc;
  busy: boolean;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class Effects {
  private scene: Phaser.Scene;
  private dustPool: PooledDust[] = [];
  private shardPool: PooledShard[] = [];
  private dropletPool: PooledDroplet[] = [];
  private flash: Phaser.GameObjects.Rectangle;
  private hitStopRemainingMs = 0;

  constructor(scene: Phaser.Scene, screenW: number, screenH: number) {
    this.scene = scene;

    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const obj = scene.add.circle(0, 0, 4, 0xbbbbbb, 0.6).setVisible(false).setDepth(40);
      this.dustPool.push({ obj, busy: false });
    }
    for (let i = 0; i < SHARD_POOL_SIZE; i++) {
      const obj = scene.add.triangle(0, 0, 0, 6, 6, -6, -6, -6, 0xffffff, 0.95).setVisible(false).setDepth(60);
      this.shardPool.push({ obj, busy: false, vx: 0, vy: 0, vr: 0, life: 0, maxLife: 1 });
    }
    for (let i = 0; i < DROPLET_POOL_SIZE; i++) {
      const obj = scene.add.circle(0, 0, 3, 0xff8fc7, 0.9).setVisible(false).setDepth(55);
      this.dropletPool.push({ obj, busy: false, vx: 0, vy: 0, life: 0, maxLife: 1 });
    }

    this.flash = scene.add
      .rectangle(screenW / 2, screenH / 2, screenW, screenH, 0xffffff, 0)
      .setScrollFactor(0)
      .setDepth(150);
  }

  /** A few gray puff circles, e.g. on a stone/wood landing. */
  dust(xPx: number, yPx: number, count: number, color: number): void {
    for (let i = 0; i < count; i++) {
      const slot = this.dustPool.find((d) => !d.busy);
      if (!slot) break;
      slot.busy = true;
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 18;
      slot.obj.setPosition(xPx, yPx).setVisible(true).setAlpha(0.6).setScale(1).setFillStyle(color, 0.55);
      this.scene.tweens.add({
        targets: slot.obj,
        x: xPx + Math.cos(angle) * dist,
        y: yPx + Math.sin(angle) * dist - 6,
        alpha: 0,
        scale: 1.8,
        duration: 300 + Math.random() * 200,
        ease: 'Cubic.Out',
        onComplete: () => {
          slot.busy = false;
          slot.obj.setVisible(false);
        },
      });
    }
  }

  /** Camera shake scaled by material shakeStrength * force (caller pre-multiplies). */
  shake(strength: number): void {
    if (strength <= 0) return;
    this.scene.cameras.main.shake(140, Math.min(0.02, 0.004 * strength));
  }

  /** Pauses physics accumulation for `ms` on a big impact. Multiple calls extend, not stack. */
  hitStop(ms: number): void {
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, ms);
  }

  /** Returns the slice of dtSeconds physics should actually advance by this frame (0 while hit-stopped). */
  consumeDt(dtSeconds: number): number {
    if (this.hitStopRemainingMs <= 0) return dtSeconds;
    this.hitStopRemainingMs -= dtSeconds * 1000;
    return 0;
  }

  /** 10-16 shard triangles with velocity/gravity/rotation/fade, plus a quick white flash. Visual only — no physics bodies. */
  shatter(xPx: number, yPx: number, color: number): void {
    const count = 10 + Math.floor(Math.random() * 7); // 10-16
    for (let i = 0; i < count; i++) {
      const slot = this.shardPool.find((s) => !s.busy);
      if (!slot) break;
      slot.busy = true;
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 140;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = Math.sin(angle) * speed - 60;
      slot.vr = (Math.random() - 0.5) * 10;
      slot.life = 0;
      slot.maxLife = 0.5 + Math.random() * 0.3;
      const size = 4 + Math.random() * 6;
      slot.obj.setTo(0, size, size, -size, -size, -size);
      slot.obj.setFillStyle(color, 0.95);
      slot.obj.rotation = Math.random() * Math.PI * 2;
      slot.obj.setPosition(xPx, yPx).setVisible(true).setAlpha(1);
    }

    this.flash.setAlpha(0.5);
    this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 180, ease: 'Cubic.Out' });
  }

  /** A few pink droplets on a big jelly impact. */
  droplets(xPx: number, yPx: number): void {
    const count = 4 + Math.floor(Math.random() * 3); // 4-6
    for (let i = 0; i < count; i++) {
      const slot = this.dropletPool.find((d) => !d.busy);
      if (!slot) break;
      slot.busy = true;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
      const speed = 60 + Math.random() * 90;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = Math.sin(angle) * speed;
      slot.life = 0;
      slot.maxLife = 0.4 + Math.random() * 0.25;
      slot.obj.setPosition(xPx, yPx).setVisible(true).setAlpha(0.9).setScale(1);
    }
  }

  /** Advances pooled shard/droplet motion. Call once per real frame (not physics dt). */
  update(dtSeconds: number): void {
    for (const s of this.shardPool) {
      if (!s.busy) continue;
      s.life += dtSeconds;
      s.vy += GRAVITY_PX_S2 * dtSeconds;
      s.obj.x += s.vx * dtSeconds;
      s.obj.y += s.vy * dtSeconds;
      s.obj.rotation += s.vr * dtSeconds;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        s.busy = false;
        s.obj.setVisible(false);
        continue;
      }
      s.obj.setAlpha(Math.max(0, 1 - t));
    }
    for (const d of this.dropletPool) {
      if (!d.busy) continue;
      d.life += dtSeconds;
      d.vy += GRAVITY_PX_S2 * dtSeconds;
      d.obj.x += d.vx * dtSeconds;
      d.obj.y += d.vy * dtSeconds;
      const t = d.life / d.maxLife;
      if (t >= 1) {
        d.busy = false;
        d.obj.setVisible(false);
        continue;
      }
      d.obj.setAlpha(Math.max(0, 0.9 * (1 - t)));
    }
  }
}
