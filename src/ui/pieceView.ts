// Drawing helpers for a piece's visuals. Graphics are drawn once at creation
// (and once more if the piece cracks); GameScene only repositions/rotates
// the container per frame, it never redraws every frame.

import Phaser from 'phaser';
import type { Material, MaterialColors } from '../game/materials';
import type { FreezeStrip } from '../game/freeze';
import { PX_PER_M } from '../physics/physics';

/** Cheap deterministic pseudo-random in [0,1), seeded by an integer. No Math.random. */
function hashRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function drawPieceBase(
  g: Phaser.GameObjects.Graphics,
  material: Material,
  wPx: number,
  hPx: number,
  seed: number,
  phase = 0,
): void {
  const hw = wPx / 2;
  const hh = hPx / 2;
  const { fill, stroke } = material.colors;
  g.clear();

  switch (material.id) {
    case 'wood': {
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(2, stroke, 1);
      g.strokeRect(-hw, -hh, wPx, hPx);
      g.lineStyle(1, stroke, 0.5);
      for (let i = 1; i <= 3; i++) {
        const y = -hh + (hPx * i) / 4;
        g.beginPath();
        g.moveTo(-hw + 4, y);
        g.lineTo(hw - 4, y);
        g.strokePath();
      }
      break;
    }
    case 'stone': {
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(2, stroke, 1);
      g.strokeRect(-hw, -hh, wPx, hPx);
      g.fillStyle(stroke, 0.5);
      for (let i = 0; i < 8; i++) {
        const rx = (hashRandom(seed + i) - 0.5) * (wPx - 10);
        const ry = (hashRandom(seed + i + 100) - 0.5) * (hPx - 8);
        const r = 1.5 + hashRandom(seed + i + 200) * 1.5;
        g.fillCircle(rx, ry, r);
      }
      break;
    }
    case 'jelly': {
      // Green (GDD §2.0), with a few bubbles and 1-3 tiny bugs floating
      // inside — see drawJellyLiving for the low-frequency animation of both.
      g.fillStyle(fill, 0.75);
      g.fillRoundedRect(-hw, -hh, wPx, hPx, Math.min(10, hh));
      g.lineStyle(2, stroke, 0.9);
      g.strokeRoundedRect(-hw, -hh, wPx, hPx, Math.min(10, hh));
      drawJellyLiving(g, wPx, hPx, seed, phase);
      break;
    }
    case 'glass': {
      g.fillStyle(fill, 0.35);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(2, stroke, 0.8);
      g.strokeRect(-hw, -hh, wPx, hPx);
      g.lineStyle(2, 0xffffff, 0.5);
      g.beginPath();
      g.moveTo(-hw * 0.6, -hh * 0.55);
      g.lineTo(-hw * 0.1, -hh * 0.55);
      g.strokePath();
      break;
    }
    case 'freeze': {
      // Falling water blob: a wobbly rounded blue shape, translucent.
      drawWaterBlob(g, wPx, hPx, fill, stroke, seed);
      break;
    }
    case 'steel': {
      // Brushed grey-blue with a bright highlight line and a row of rivets.
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      // Brushed streaks.
      g.lineStyle(1, stroke, 0.35);
      for (let i = 0; i < 6; i++) {
        const y = -hh + (hPx * (i + 0.5)) / 6;
        g.beginPath();
        g.moveTo(-hw + 3, y);
        g.lineTo(hw - 3, y);
        g.strokePath();
      }
      g.lineStyle(2, stroke, 1);
      g.strokeRect(-hw, -hh, wPx, hPx);
      // Bright highlight line near the top.
      g.lineStyle(2.5, 0xd8e4ee, 0.85);
      g.beginPath();
      g.moveTo(-hw + 4, -hh * 0.5);
      g.lineTo(hw - 4, -hh * 0.5);
      g.strokePath();
      // Rivets.
      g.fillStyle(0x3a4552, 0.9);
      const rivetR = Math.max(1.5, hh * 0.12);
      const rivetInsetX = hw * 0.85;
      for (const rx of [-rivetInsetX, rivetInsetX]) {
        for (const ry of [-hh * 0.55, hh * 0.55]) {
          g.fillCircle(rx, ry, rivetR);
        }
      }
      break;
    }
    case 'polystyrene': {
      // Bright white block with a bubbly dot texture (foam look).
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(1.5, stroke, 0.8);
      g.strokeRect(-hw, -hh, wPx, hPx);
      g.fillStyle(stroke, 0.45);
      const cols = Math.max(3, Math.round(wPx / 10));
      const rows = Math.max(2, Math.round(hPx / 10));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const jx = (hashRandom(seed + cx * 13 + cy * 7) - 0.5) * (wPx / cols) * 0.6;
          const jy = (hashRandom(seed + cx * 7 + cy * 13 + 50) - 0.5) * (hPx / rows) * 0.6;
          const x = -hw + ((cx + 0.5) / cols) * wPx + jx;
          const y = -hh + ((cy + 0.5) / rows) * hPx + jy;
          const r = 0.8 + hashRandom(seed + cx * 3 + cy * 5 + 90) * 1.1;
          g.fillCircle(x, y, r);
        }
      }
      break;
    }
    case 'paper': {
      // Thin off-white sheet with a couple of faint horizontal lines.
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(1, stroke, 0.9);
      g.strokeRect(-hw, -hh, wPx, hPx);
      g.lineStyle(1, stroke, 0.4);
      for (let i = 1; i <= 2; i++) {
        const y = -hh + (hPx * i) / 3;
        g.beginPath();
        g.moveTo(-hw + 3, y);
        g.lineTo(hw - 3, y);
        g.strokePath();
      }
      break;
    }
  }
}

/** A wobbly, translucent water-blob outline for the falling freeze piece. */
function drawWaterBlob(g: Phaser.GameObjects.Graphics, wPx: number, hPx: number, fill: number, stroke: number, seed: number): void {
  const hw = wPx / 2;
  const hh = hPx / 2;
  const points = 14;
  g.fillStyle(fill, 0.55);
  g.lineStyle(2, stroke, 0.8);
  g.beginPath();
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const angle = t * Math.PI * 2;
    const wobble = 1 + (hashRandom(seed + i) - 0.5) * 0.18;
    const x = Math.cos(angle) * hw * wobble;
    const y = Math.sin(angle) * hh * wobble;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillPath();
  g.strokePath();
}

/**
 * Draws the frozen ice block: all fill strips as one icy shape (in local
 * coordinates around the compound body's origin), plus a bright flat line
 * along the top so the flat fill line reads clearly.
 */
export function drawFreezeIce(
  g: Phaser.GameObjects.Graphics,
  strips: FreezeStrip[],
  originXM: number,
  originYM: number,
  colors: MaterialColors,
): void {
  g.clear();
  if (strips.length === 0) return;
  g.fillStyle(colors.fill, 0.85);
  g.lineStyle(1.5, colors.stroke, 0.9);
  let minLocalX = Infinity;
  let maxLocalX = -Infinity;
  const topLocalY = (strips[0].top - originYM) * PX_PER_M;
  for (const s of strips) {
    const localX = (s.xCenter - originXM) * PX_PER_M;
    const localTop = (s.top - originYM) * PX_PER_M;
    const localBottom = (s.bottom - originYM) * PX_PER_M;
    const wPx = s.width * PX_PER_M;
    g.fillRect(localX - wPx / 2, localTop, wPx, localBottom - localTop);
    g.strokeRect(localX - wPx / 2, localTop, wPx, localBottom - localTop);
    minLocalX = Math.min(minLocalX, localX - wPx / 2);
    maxLocalX = Math.max(maxLocalX, localX + wPx / 2);
  }
  // Bright flat top line — the visible "fill level".
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.beginPath();
  g.moveTo(minLocalX, topLocalY);
  g.lineTo(maxLocalX, topLocalY);
  g.strokePath();
}

/**
 * Draws jelly's living details on top of its base fill (does not clear):
 * a few bubbles drifting up (wrapping back to the bottom) and 1-3 tiny bugs
 * wandering slowly — GDD §2.0 "Looks & living details". Purely cosmetic
 * (Graphics only, cheap); `phase` advances slowly and only when the piece is
 * actually redrawn (see PieceManager's updateLivingLook — never every
 * frame), giving the "slowly moving" look without an animation loop.
 */
function drawJellyLiving(g: Phaser.GameObjects.Graphics, wPx: number, hPx: number, seed: number, phase: number): void {
  const hw = wPx / 2;
  const hh = hPx / 2;

  // Bubbles: drift straight up, wrap to the bottom once they reach the top.
  const bubbleCount = 5;
  g.fillStyle(0xffffff, 0.35);
  for (let i = 0; i < bubbleCount; i++) {
    const bx = -hw + hh * 0.4 + hashRandom(seed + i * 3) * (wPx - hh * 0.8);
    const t = (phase * 0.06 + hashRandom(seed + i * 7 + 20)) % 1; // 0 (bottom) -> 1 (top), wraps
    const by = hh - 3 - t * (hPx - 6);
    const r = 1.3 + hashRandom(seed + i + 40) * 1.8;
    g.fillCircle(bx, by, r);
  }

  // 1-3 tiny bugs, each wandering in a slow lazy loop.
  const bugCount = 1 + Math.floor(hashRandom(seed + 900) * 3);
  g.fillStyle(0x2a2a2a, 0.85);
  for (let i = 0; i < bugCount; i++) {
    const wanderT = phase * 0.15 + hashRandom(seed + i * 11 + 3) * Math.PI * 2;
    const rx = hw * (0.35 + hashRandom(seed + i + 500) * 0.25);
    const ry = hh * (0.3 + hashRandom(seed + i + 600) * 0.25);
    const bx = Math.sin(wanderT) * rx;
    const by = Math.cos(wanderT * 1.3 + i) * ry;
    g.fillEllipse(bx, by, 4, 2.2);
  }
}

/**
 * Adds worm-hole marks on top of a wood piece's base fill (does not clear) —
 * more/darker holes as `level` rises (worm.ts). A worm occasionally peeks
 * out and wiggles: cheap, low-frequency (see drawJellyLiving's `phase` doc).
 */
export function drawWormHoles(
  g: Phaser.GameObjects.Graphics,
  wPx: number,
  hPx: number,
  level: number,
  seed: number,
  phase: number,
): void {
  const hw = wPx / 2;
  const hh = hPx / 2;
  const holeCount = 2 + level * 2;
  g.fillStyle(0x2a1a0c, 0.9);
  for (let i = 0; i < holeCount; i++) {
    const hx = -hw + 4 + hashRandom(seed + i * 5 + level * 50) * Math.max(1, wPx - 8);
    const hy = -hh + 3 + hashRandom(seed + i * 9 + level * 70) * Math.max(1, hPx - 6);
    const r = 1 + hashRandom(seed + i + 200) * 1.2 + level * 0.3;
    g.fillCircle(hx, hy, r);
  }
  // A worm peeking out of one hole, wiggling — visible roughly a third of
  // the time (cheap parity toggle, no per-frame animation needed).
  if (Math.floor(phase) % 3 === 0) {
    const px = -hw + hashRandom(seed + 321) * wPx * 0.7;
    const py = -hh + hashRandom(seed + 654) * hPx * 0.6;
    const wiggle = Math.sin(phase * 6) * 1.5;
    g.fillStyle(0xd98a6b, 0.95);
    g.fillEllipse(px + wiggle, py, 3.2, 1.6);
  }
}

/** Adds crack lines on top of whatever is already drawn (does not clear). */
export function drawCracks(g: Phaser.GameObjects.Graphics, wPx: number, hPx: number, seed: number): void {
  const hw = wPx / 2;
  const hh = hPx / 2;
  g.lineStyle(1.5, 0x2a2a2a, 0.85);
  const lineCount = 3 + Math.floor(hashRandom(seed + 300) * 2); // 3-4 lines
  for (let i = 0; i < lineCount; i++) {
    const angle = hashRandom(seed + 400 + i) * Math.PI * 2;
    const len = (0.3 + hashRandom(seed + 500 + i) * 0.5) * Math.min(hw, hh) * 1.6;
    const midX = (hashRandom(seed + 600 + i) - 0.5) * wPx * 0.6;
    const midY = (hashRandom(seed + 700 + i) - 0.5) * hPx * 0.6;
    const dx = Math.cos(angle) * len * 0.5;
    const dy = Math.sin(angle) * len * 0.5;
    g.beginPath();
    g.moveTo(midX - dx, midY - dy);
    g.lineTo(midX + dx, midY + dy);
    g.strokePath();
  }
}
