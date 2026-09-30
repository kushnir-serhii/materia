// Playtest batch (platform width, 5 hearts, hold, wind, polystyrene bounce) — see docs/GDD.md.
import { test, expect } from '@playwright/test';
import type { MaterialId } from '../../src/game/materials';

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
      spawn: (material: MaterialId, xMeters: number, yMeters: number) => number | null;
      jointCount: () => number;
      freezeTopFlatness: () => number;
      freezeAngleDeg: () => number;
      clearPieces: () => void;
      platformScreenY: () => number;
      towerTopScreenY: () => number | null;
      fxImpactCount: () => number;
      resetFxImpactCount: () => void;
      allSleeping: () => boolean;
      hudWrenchCenter: () => { x: number; y: number };
      hudDevPanelOpen: () => boolean;
      hudDevPropsLine: () => string;
      removals: () => { id: number; material: MaterialId; reason: 'fell' | 'shatter' | 'melt' | 'froze' | 'reset' | 'error' | 'culled' | 'eaten'; ageMs: number; at: number }[];
      lastDroppedPieceId: () => number | null;
      pieceExists: (id: number) => boolean;
      dynamicPieceCount: () => number;
      settledPieceCount: () => number;
      displayedHeight: () => number;
      squashLevel: (id: number) => number | null;
      hookDirection: () => number;
      spawnWormy: (xMeters: number, yMeters: number) => number | null;
      pieceRotationDeg: (id: number) => number | null;
      jellyTopBottomRatio: () => number;
      pieceIsAirborne: (id: number) => boolean | null;
      platformWidthM: () => number;
      heartsCount: () => number;
      holdState: () => { hook: MaterialId; next: MaterialId; held: MaterialId | null; used: boolean };
      tapHold: () => boolean;
      forceGust: (dir: number, strength: number, seconds: number) => void;
      piecePosM: (id: number) => { x: number; y: number } | null;
    };
  }
}

function collectErrors(page: import('@playwright/test').Page) {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });
}

test('platform is exactly 3 standard blocks wide (6.0 m)', async ({ page }) => {
  const { pageErrors } = collectErrors(page);
  await boot(page);
  expect(await page.evaluate(() => window.__materia!.platformWidthM())).toBeCloseTo(6.0);
  expect(pageErrors).toEqual([]);
});

test('starts with 5 hearts and loses one when a piece falls off', async ({ page }) => {
  const { pageErrors } = collectErrors(page);
  await boot(page);
  expect(await page.evaluate(() => window.__materia!.heartsCount())).toBe(5);
  await page.evaluate(() => {
    window.__materia!.spawn('wood', 0.5, 14);
    window.__materia!.stepFast(3);
  });
  expect(await page.evaluate(() => window.__materia!.heartsCount())).toBe(4);
  expect(pageErrors).toEqual([]);
});

test('hold: swaps next/current/held correctly, once per drop, never drops a piece', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);
  await boot(page);

  const s0 = await page.evaluate(() => window.__materia!.holdState());
  expect(s0.held).toBeNull();
  expect(s0.used).toBe(false);

  // Empty hold: hook piece -> hold, next -> hook.
  expect(await page.evaluate(() => window.__materia!.tapHold())).toBe(true);
  const s1 = await page.evaluate(() => window.__materia!.holdState());
  expect(s1.held).toBe(s0.hook);
  expect(s1.hook).toBe(s0.next);
  expect(s1.used).toBe(true);
  expect(await page.evaluate(() => window.__materia!.pieceCount())).toBe(0); // no piece dropped

  // Once per drop: a second tap does nothing.
  expect(await page.evaluate(() => window.__materia!.tapHold())).toBe(false);
  expect(await page.evaluate(() => window.__materia!.holdState())).toEqual(s1);

  // Drop -> hold available again; next piece comes onto the hook.
  expect(await page.evaluate(() => window.__materia!.drop())).toBe(true);
  await page.evaluate(() => window.__materia!.stepFast(0.8));
  const s2 = await page.evaluate(() => window.__materia!.holdState());
  expect(s2.used).toBe(false);
  expect(s2.held).toBe(s1.held);
  expect(s2.hook).toBe(s1.next);

  // Occupied hold: swap held <-> hook.
  expect(await page.evaluate(() => window.__materia!.tapHold())).toBe(true);
  const s3 = await page.evaluate(() => window.__materia!.holdState());
  expect(s3.hook).toBe(s2.held);
  expect(s3.held).toBe(s2.hook);
  expect(s3.next).toBe(s2.next);

  // A real pointer tap on the hold box must not drop a piece either.
  await page.evaluate(() => window.__materia!.stepFast(0.8)); // (used stays true until a drop; box is greyed)
  const before = await page.evaluate(() => window.__materia!.pieceCount());
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.left + (190 / 540) * box.w, box.top + (32 / 960) * box.h);
  expect(await page.evaluate(() => window.__materia!.pieceCount())).toBe(before);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a wind gust moves a cardboard box far more than a stone block', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);
  await boot(page);

  const ids = await page.evaluate(() => {
    // High up so both stay airborne for the whole 2 s gust.
    const card = window.__materia!.spawn('cardboard', 3, -40);
    const stone = window.__materia!.spawn('stone', 8, -40);
    window.__materia!.forceGust(1, 1, 2);
    window.__materia!.stepFast(2.1);
    return { card, stone };
  });
  const cardPos = await page.evaluate((id) => window.__materia!.piecePosM(id!), ids.card);
  const stonePos = await page.evaluate((id) => window.__materia!.piecePosM(id!), ids.stone);
  const cardDx = (cardPos as { x: number }).x - 3;
  const stoneDx = (stonePos as { x: number }).x - 8;
  expect(cardDx).toBeGreaterThan(0.5); // blown to the right (wind dir +1)
  expect(cardDx).toBeGreaterThan(Math.abs(stoneDx) * 5);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('wind blows toward the left too, and calms down after the gust', async ({ page }) => {
  await boot(page);
  const id = await page.evaluate(() => {
    const card = window.__materia!.spawn('cardboard', 6, -40);
    window.__materia!.forceGust(-1, 1, 1.5);
    window.__materia!.stepFast(1.6);
    return card;
  });
  const p1 = await page.evaluate((i) => window.__materia!.piecePosM(i!), id);
  expect((p1 as { x: number }).x).toBeLessThan(5.5);
  // After the gust the force is cleared: sideways drift stops (damped to ~0).
  await page.evaluate(() => window.__materia!.stepFast(3));
  const p2 = await page.evaluate((i) => window.__materia!.piecePosM(i!), id);
  await page.evaluate(() => window.__materia!.stepFast(1));
  const p3 = await page.evaluate((i) => window.__materia!.piecePosM(i!), id);
  expect(Math.abs((p3 as { x: number }).x - (p2 as { x: number }).x)).toBeLessThan(0.2);
});

test('a wood block dropped on polystyrene rebounds less than 0.1 m', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);
  await boot(page);

  const rebound = await page.evaluate(() => {
    const m = window.__materia!;
    m.spawn('polystyrene', 5.4, 14.4);
    m.stepFast(1.5);
    const wood = m.spawn('wood', 5.4, 11.8)!;
    let landed = false;
    let lowestY = -Infinity; // y is down: the deepest point reached after landing
    let rebound = 0; // biggest rise back up from that deepest point
    for (let i = 0; i < 180; i++) {
      m.stepFast(1 / 60);
      const y = m.piecePosM(wood)!.y;
      if (!landed && m.pieceIsAirborne(wood) === false) landed = true;
      if (landed) {
        lowestY = Math.max(lowestY, y);
        rebound = Math.max(rebound, lowestY - y);
      }
    }
    return { rebound, landed };
  });
  expect(rebound.landed).toBe(true);
  expect(rebound.rebound).toBeLessThan(0.1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
