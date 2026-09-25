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

test('smoke: page loads without errors', async ({ page }) => {
  const pageErrors: Error[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });

  await page.goto('/');
  await page.waitForSelector('canvas', { timeout: 5000 });
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  expect(pageErrors).toEqual([]);
});

test('dropping wood pieces creates physics bodies', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.setMaterial('wood');
  });

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      window.__materia!.drop();
      window.__materia!.stepFast(1); // clears the 0.6s drop cooldown, lets it fall/settle
    });
  }

  const count = await page.evaluate(() => window.__materia!.pieceCount());
  expect(count).toBeGreaterThanOrEqual(4);
  expect(pageErrors).toEqual([]);
});

test('dropping each of the 4 materials produces no page errors', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const materials: MaterialId[] = ['wood', 'stone', 'jelly', 'glass'];
  for (const material of materials) {
    await page.evaluate((m) => {
      window.__materia!.setMaterial(m);
      window.__materia!.drop();
      window.__materia!.stepFast(1.5); // let it land, react (sound/haptic/fx), and settle
    }, material);
  }

  expect(pageErrors).toEqual([]);
});

test('a stone plank dropped on glass shatters it', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    // Deterministic placement via the spawn() test hook rather than relying
    // on the swinging hook's x position, so this isn't flaky. x=5.4m is the
    // platform's world-space center (screen center at PX_PER_M=50).
    window.__materia!.spawn('glass', 5.4, 14.2);
    window.__materia!.spawn('stone', 5.4, 10);
    window.__materia!.stepFast(3);
  });

  const glassCount = await page.evaluate(() => window.__materia!.countByMaterial('glass'));
  expect(glassCount).toBe(0);
  expect(pageErrors).toEqual([]);
});
