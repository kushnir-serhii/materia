// Drawing helpers for a piece's visuals. Graphics are drawn once at creation
// (and once more if the piece cracks); GameScene only repositions/rotates
// the container per frame, it never redraws every frame.

import Phaser from 'phaser';
import { JELLY_TOP_WIDTH_RATIO, JELLY_CORNER_RADIUS_M, type Material, type MaterialColors } from '../game/materials';
import type { FreezeStrip } from '../game/freeze';
import { PX_PER_M } from '../physics/physics';

/** Cheap deterministic pseudo-random in [0,1), seeded by an integer. No Math.random. */
function hashRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Pt {
  x: number;
  y: number;
}

/**
 * A trapezoid (top edge `topRatio` of the bottom edge's width, y-down so
 * "top" is -hh) with its 4 corners chamfered by `cornerPx` — a cheap
 * (no trig-heavy arcs) approximation of rounded corners, good enough at the
 * ~100x30px a piece actually renders at. Used as the base shape jelly's
 * animated wave ripple (jellyWavePoints) displaces.
 */
function chamferedTrapezoidPoints(wPx: number, hPx: number, topRatio: number, cornerPx: number): Pt[] {
  const hw = wPx / 2;
  const hh = hPx / 2;
  const topHw = hw * topRatio;
  const corners: Pt[] = [
    { x: -topHw, y: -hh },
    { x: topHw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  const n = corners.length;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n];
    const cur = corners[i];
    const next = corners[(i + 1) % n];
    const toPrevLen = Math.hypot(prev.x - cur.x, prev.y - cur.y) || 1;
    const toNextLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.max(0, Math.min(cornerPx, toPrevLen * 0.4, toNextLen * 0.4));
    pts.push({ x: cur.x + ((prev.x - cur.x) / toPrevLen) * r, y: cur.y + ((prev.y - cur.y) / toPrevLen) * r });
    pts.push({ x: cur.x + ((next.x - cur.x) / toNextLen) * r, y: cur.y + ((next.y - cur.y) / toNextLen) * r });
  }
  return pts;
}

/**
 * Displaces a closed polygon's perimeter (subdivided `subdiv` times per
 * edge) outward/inward along a sine wave running around it — jelly's
 * "soft animated waves along its outline" (GDD §2.0 designer feedback).
 * Displacement direction approximates the outward normal via the vector
 * from the shape's centroid, which is accurate enough for a small, roughly
 * convex shape like jelly's trapezoid.
 */
function jellyWavePoints(base: Pt[], ampPx: number, waveCount: number, phase: number, subdiv: number): Pt[] {
  const n = base.length;
  let cx = 0;
  let cy = 0;
  for (const p of base) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = base[i];
    const b = base[(i + 1) % n];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      let nx = x - cx;
      let ny = y - cy;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const globalT = (i + t) / n;
      const disp = ampPx * Math.sin(2 * Math.PI * waveCount * globalT + phase);
      out.push({ x: x + nx * disp, y: y + ny * disp });
    }
  }
  return out;
}

export function drawPieceBase(
  g: Phaser.GameObjects.Graphics,
  material: Material,
  wPx: number,
  hPx: number,
  seed: number,
  phase = 0,
  /** Jelly only: the current squash/wobble envelope magnitude (0..~0.35 — see spring.ts's jellySpringEnvelope) — makes the edge ripple bigger right after an impact, fading as the wobble decays. */
  wobbleMag = 0,
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
      // Trapezoid (top JELLY_TOP_WIDTH_RATIO of the bottom, rounded
      // corners — matches the Rapier collider, createDynamicTrapezoid),
      // translucent green, a gently rippling animated outline (bigger right
      // after an impact via `wobbleMag`, fading with the wobble), a glossy
      // highlight near the top, and the bubbles/bugs from drawJellyLiving.
      const basePts = chamferedTrapezoidPoints(wPx, hPx, JELLY_TOP_WIDTH_RATIO, JELLY_CORNER_RADIUS_M * PX_PER_M);
      const rippleAmpPx = 0.6 + wobbleMag * 12;
      const wavePts = jellyWavePoints(basePts, rippleAmpPx, 5, phase * 2.2, 3).map(
        (p) => new Phaser.Math.Vector2(p.x, p.y),
      );
      g.fillStyle(fill, 0.5);
      g.fillPoints(wavePts, true);
      g.lineStyle(2, stroke, 0.85);
      g.strokePoints(wavePts, true, true);
      // Glossy highlight near the top.
      g.fillStyle(0xffffff, 0.22);
      g.fillEllipse(-hw * 0.12, -hh * 0.45, wPx * 0.42, hh * 0.7);
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
      // Brushed grey-blue body, rivets evenly around the whole perimeter —
      // no highlight line (designer feedback round: "remove the white
      // highlight line").
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
      drawSteelRivets(g, wPx, hPx);
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
    case 'cardboard': {
      // Kraft-brown box: a lighter seam line where the top flaps meet, a
      // semi-transparent packing-tape strip down the middle, crease lines
      // near the top/bottom (flap folds), and a small "this side up" arrow
      // in darker ink (designer feedback round).
      g.fillStyle(fill, 1);
      g.fillRect(-hw, -hh, wPx, hPx);
      g.lineStyle(2, stroke, 1);
      g.strokeRect(-hw, -hh, wPx, hPx);

      // Flap seam near the top, slightly lighter than the body.
      g.lineStyle(1.5, 0xdcb98a, 0.8);
      g.beginPath();
      g.moveTo(-hw + 3, -hh + hPx * 0.18);
      g.lineTo(hw - 3, -hh + hPx * 0.18);
      g.strokePath();

      // Flap-fold crease lines near the top and bottom edges.
      g.lineStyle(1, stroke, 0.5);
      for (const y of [-hh + hPx * 0.05, hh - hPx * 0.05]) {
        g.beginPath();
        g.moveTo(-hw + 2, y);
        g.lineTo(hw - 2, y);
        g.strokePath();
      }

      // Packing tape strip down the middle.
      const tapeW = Math.max(6, wPx * 0.09);
      g.fillStyle(0xf2e6c9, 0.55);
      g.fillRect(-tapeW / 2, -hh, tapeW, hPx);
      g.lineStyle(1, 0xd8cba0, 0.6);
      g.strokeRect(-tapeW / 2, -hh, tapeW, hPx);

      // Small "this side up" arrow, darker ink, off to one side.
      const ax = hw * 0.6;
      const inkColor = 0x6b4a26;
      g.lineStyle(1.3, inkColor, 0.75);
      g.beginPath();
      g.moveTo(ax, hh * 0.35);
      g.lineTo(ax, -hh * 0.35);
      g.strokePath();
      g.beginPath();
      g.moveTo(ax - 3, -hh * 0.35 + 4);
      g.lineTo(ax, -hh * 0.35);
      g.lineTo(ax + 3, -hh * 0.35 + 4);
      g.strokePath();
      break;
    }
  }
}

/** Spacing between steel's perimeter rivets (GDD §2.0 designer feedback: "every ~0.25m along all 4 edges"). */
const STEEL_RIVET_SPACING_M = 0.25;

/** Small round rivets, evenly spaced around a steel piece's whole perimeter, each with a tiny highlight dot. */
function drawSteelRivets(g: Phaser.GameObjects.Graphics, wPx: number, hPx: number): void {
  const hw = wPx / 2;
  const hh = hPx / 2;
  const spacing = STEEL_RIVET_SPACING_M * PX_PER_M;
  const inset = Math.min(hw, hh, Math.max(3, Math.min(hw, hh) * 0.18));
  const rivetR = Math.max(1.2, Math.min(hw, hh) * 0.09);

  const placeRivet = (x: number, y: number): void => {
    g.fillStyle(0x3a4552, 0.9);
    g.fillCircle(x, y, rivetR);
    g.fillStyle(0xd8e4ee, 0.8);
    g.fillCircle(x - rivetR * 0.3, y - rivetR * 0.3, rivetR * 0.35);
  };

  const topY = -hh + inset;
  const bottomY = hh - inset;
  const xStart = -hw + inset;
  const xEnd = hw - inset;
  const xCount = Math.max(2, Math.round((xEnd - xStart) / spacing) + 1);
  for (let i = 0; i < xCount; i++) {
    const x = xStart + ((xEnd - xStart) * i) / (xCount - 1);
    placeRivet(x, topY);
    placeRivet(x, bottomY);
  }

  // Left/right edges, between the corners already covered above.
  const leftX = -hw + inset;
  const rightX = hw - inset;
  const yStart = topY + spacing;
  const yEnd = bottomY - spacing;
  if (yEnd > yStart) {
    const yCount = Math.max(1, Math.round((yEnd - yStart) / spacing) + 1);
    for (let i = 0; i < yCount; i++) {
      const t = yCount > 1 ? i / (yCount - 1) : 0.5;
      const y = yStart + (yEnd - yStart) * t;
      placeRivet(leftX, y);
      placeRivet(rightX, y);
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
