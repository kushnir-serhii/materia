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
      freezeAngleDeg: () => number;
      clearPieces: () => void;
      platformScreenY: () => number;
      towerTopScreenY: () => number | null;
      fxImpactCount: () => number;
      resetFxImpactCount: () => void;
      allSleeping: () => boolean;
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

test('camera follows the tower back down after a tall tower collapses', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    // A tall stack of stone planks, straight up from the platform, so the
    // camera scrolls well up (best ~14m) before we knock it all away.
    let y = 14.4;
    for (let i = 0; i < 20; i++) {
      window.__materia!.spawn('stone', 5.4, y);
      window.__materia!.stepFast(0.3);
      y -= 0.6;
    }
    window.__materia!.stepFast(1);
  });

  const heightBefore = await page.evaluate(() => window.__materia!.height());
  expect(heightBefore).toBeGreaterThan(2);

  await page.evaluate(() => {
    // Topple the tower: remove every piece so the board goes back to bare
    // platform (current height -> ~0), like a collapse would.
    window.__materia!.clearPieces();
    window.__materia!.stepFast(3);
  });

  const platformY = await page.evaluate(() => window.__materia!.platformScreenY());
  expect(platformY).toBeGreaterThan(0);
  expect(platformY).toBeLessThan(960);
  expect(pageErrors).toEqual([]);
});

const HUD_BUTTON_ZONE_TOP = 960 - 70;
// VIEW_TOP_FRACTION in GameScene.ts.
const VIEW_TOP_FRACTION_PX = 0.4 * 960;

test('a short tower is framed with its top near 40% from the top, never lower, and clear of the button bar', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  // A modest 3-piece tower — short enough that a wrong "stay at the wide
  // initial view" clamp (the actual bug: it pinned the camera to the
  // near-empty-board framing for any short/medium tower) would show the top
  // noticeably lower than 40% from the top.
  await page.evaluate(() => {
    let restingYM = 14.4;
    for (let i = 0; i < 3; i++) {
      window.__materia!.spawn('wood', 5.4, restingYM - 1.5);
      window.__materia!.stepFast(1.2);
      restingYM -= 0.6;
    }
  });

  const topY = await page.evaluate(() => window.__materia!.towerTopScreenY());
  expect(topY).not.toBeNull();
  // Within a reasonable band of VIEW_TOP_FRACTION (40%), and never lower
  // (further down the screen) than that.
  expect(topY as number).toBeLessThanOrEqual(VIEW_TOP_FRACTION_PX + 40);
  expect(topY as number).toBeGreaterThan(0);

  const platformY = await page.evaluate(() => window.__materia!.platformScreenY());
  expect(platformY).toBeLessThan(HUD_BUTTON_ZONE_TOP);
  expect(pageErrors).toEqual([]);
});

test('the camera never overshoots the platform past the bottom button bar', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  // Build tall, then collapse to nothing, then build a short tower again —
  // exercises the up/down/up transitions where an overshoot would show up.
  await page.evaluate(() => {
    let y = 14.4;
    for (let i = 0; i < 15; i++) {
      window.__materia!.spawn('stone', 5.4, y);
      window.__materia!.stepFast(0.3);
      y -= 0.6;
    }
    window.__materia!.clearPieces();
    window.__materia!.stepFast(3);
    window.__materia!.spawn('wood', 5.4, 14.2);
    window.__materia!.stepFast(2);
  });

  const platformY = await page.evaluate(() => window.__materia!.platformScreenY());
  const topY = await page.evaluate(() => window.__materia!.towerTopScreenY());
  expect(platformY).toBeLessThan(HUD_BUTTON_ZONE_TOP);
  expect(topY as number).toBeLessThan(HUD_BUTTON_ZONE_TOP);
  expect(pageErrors).toEqual([]);
});
