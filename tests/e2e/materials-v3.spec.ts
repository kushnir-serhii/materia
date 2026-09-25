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
    };
  }
}

// Round 9 (designer feedback on Steel and Jelly) — see docs/GDD.md §2.0.

function collectErrors(page: import('@playwright/test').Page) {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes('Failed to load resource')) return;
    consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

test('steel lands faster than stone from the same height, no errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  async function stepsToLand(material: MaterialId): Promise<number> {
    const id = await page.evaluate((m) => {
      window.__materia!.reset();
      return window.__materia!.spawn(m, 5.4, 8);
    }, material);
    expect(id).not.toBeNull();
    const STEP = 0.02;
    const MAX_STEPS = 300; // 6s cap
    for (let i = 0; i < MAX_STEPS; i++) {
      const airborne = await page.evaluate(
        ({ s, pid }) => {
          window.__materia!.stepFast(s);
          return window.__materia!.pieceIsAirborne(pid!);
        },
        { s: STEP, pid: id },
      );
      if (airborne === false) return i + 1; // first contact
    }
    return MAX_STEPS;
  }

  const steelSteps = await stepsToLand('steel');
  const stoneSteps = await stepsToLand('stone');

  expect(steelSteps).toBeLessThan(stoneSteps);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('jelly collider is a trapezoid (top ~85% of bottom width)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const ratio = await page.evaluate(() => window.__materia!.jellyTopBottomRatio());
  expect(ratio).toBeGreaterThan(0.8);
  expect(ratio).toBeLessThan(0.9);
  expect(ratio).toBeCloseTo(0.85, 2);
});

test('several stacked jellies (trapezoid collider) still settle without errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    let y = 14.4;
    for (let i = 0; i < 4; i++) {
      window.__materia!.spawn('jelly', 5.4, y - 1.2);
      window.__materia!.stepFast(1.5);
      y -= 0.6;
    }
    window.__materia!.stepFast(3);
  });

  const asleep = await page.evaluate(() => window.__materia!.allSleeping());
  expect(asleep).toBe(true);
  const jellyCount = await page.evaluate(() => window.__materia!.countByMaterial('jelly'));
  expect(jellyCount).toBe(4);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
