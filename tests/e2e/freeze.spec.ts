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

test('freeze fills an uneven tower flat and glues to it, no page errors', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    // Uneven tower: a wood plank on only the left half of the platform, so
    // the right half stays at the bare platform's height — a step profile
    // for the freeze piece to land on and fill flat.
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5); // let it settle before the freeze piece lands
  });

  const woodCount = await page.evaluate(() => window.__materia!.countByMaterial('wood'));
  expect(woodCount).toBe(1);

  await page.evaluate(() => {
    // Centered above the step (platform center x=5.4m), wide enough to span
    // both the wood plank and the bare platform beside it.
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(2);
  });

  const joints = await page.evaluate(() => window.__materia!.jointCount());
  const flatness = await page.evaluate(() => window.__materia!.freezeTopFlatness());

  expect(joints).toBeGreaterThan(0);
  expect(flatness).toBeLessThan(0.05);
  expect(pageErrors).toEqual([]);
});

test('height HUD counts a frozen block toward tower height right after it freezes', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
  });

  // Step in small increments and check height the instant it freezes (the
  // very frame jointCount first becomes > 0) — this used to read 0.0 m
  // because of the freeze pop-in settle spike (see GLUE_GRACE_PERIOD_S).
  const heightAtFreeze = await page.evaluate(() => {
    for (let i = 0; i < 60; i++) {
      window.__materia!.stepFast(0.05);
      if (window.__materia!.jointCount() > 0) return window.__materia!.height();
    }
    return -1;
  });

  expect(heightAtFreeze).toBeGreaterThan(0.3);
  expect(pageErrors).toEqual([]);
});

test('a frozen block on an uneven tower settles level', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(3); // well past ROTATION_LOCK_S so it's had time to settle unlocked
  });

  const angleDeg = await page.evaluate(() => window.__materia!.freezeAngleDeg());
  expect(angleDeg).toBeLessThan(2);
  expect(pageErrors).toEqual([]);
});

test('a glue joint breaks under a heavy impact', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(2);
  });

  const jointsBefore = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBefore).toBeGreaterThan(0);

  await page.evaluate(() => {
    // A stone plank dropped from height onto the wood plank glued to the
    // ice — a big enough impact to exceed freeze's glueBreakForce.
    window.__materia!.spawn('stone', 4.4, 8);
    window.__materia!.stepFast(2);
  });

  const jointsAfter = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsAfter).toBeLessThan(jointsBefore);
  expect(pageErrors).toEqual([]);
});

test('an undisturbed ice block fully unglues within 1 minute (meltStart 30s + meltDuration 30s)', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(2); // let it land and freeze solid
  });

  const jointsRightAfterFreeze = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsRightAfterFreeze).toBeGreaterThan(0);
  const iceCountRightAfterFreeze = await page.evaluate(() => window.__materia!.countByMaterial('freeze'));
  expect(iceCountRightAfterFreeze).toBe(1);

  // Just before meltStartS (30s) the glue must still be fully intact.
  await page.evaluate(() => window.__materia!.stepFast(27));
  const jointsBeforeMeltStart = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBeforeMeltStart).toBe(jointsRightAfterFreeze);

  // Well past meltStartS + meltDurationS (30s + 30s = 60s total) every glue
  // joint must be gone and the ice piece must have disappeared completely.
  await page.evaluate(() => window.__materia!.stepFast(36));
  const jointsAfterAMinute = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsAfterAMinute).toBe(0);
  const iceCountAfterAMinute = await page.evaluate(() => window.__materia!.countByMaterial('freeze'));
  expect(iceCountAfterAMinute).toBe(0);
  expect(pageErrors).toEqual([]);
});
