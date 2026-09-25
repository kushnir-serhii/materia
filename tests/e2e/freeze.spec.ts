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
      spawn: (material: MaterialId, xMeters: number, yMeters: number) => void;
      jointCount: () => number;
      freezeTopFlatness: () => number;
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
