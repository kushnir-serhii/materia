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

export function drawPieceBase(g: Phaser.GameObjects.Graphics, material: Material, wPx: number, hPx: number, seed: number): void {
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
      g.fillStyle(fill, 0.75);
      g.fillRoundedRect(-hw, -hh, wPx, hPx, Math.min(10, hh));
      g.lineStyle(2, stroke, 0.9);
      g.strokeRoundedRect(-hw, -hh, wPx, hPx, Math.min(10, hh));
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
