import { test, expect } from '@playwright/test';
import type { MaterialId } from '../../src/game/materials';
import { ALL_MATERIAL_IDS } from '../../src/game/materials';
import { DEV_PICKER_LAYOUT } from '../../src/ui/devPickerLayout';

const GLASS_SWATCH_X = DEV_PICKER_LAYOUT.swatchCenterX(ALL_MATERIAL_IDS.indexOf('glass'));
const DEV_PANEL_SWATCH_Y = DEV_PICKER_LAYOUT.swatchCenterY;

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
      hudWrenchCenter: () => { x: number; y: number };
      hudDevPanelOpen: () => boolean;
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

// PLATFORM_BOTTOM_MARGIN_PX in GameScene.ts: the platform's resting bottom
// edge sits this far above the screen's bottom edge (no bottom button row
// to clear any more — the material picker moved to a top-right dev panel).
const PLATFORM_BOTTOM_MARGIN_PX = 60;
const SCREEN_BOTTOM_LIMIT_PX = 960 - PLATFORM_BOTTOM_MARGIN_PX + 20; // small tolerance
// VIEW_TOP_FRACTION in GameScene.ts.
const VIEW_TOP_FRACTION_PX = 0.4 * 960;

test('a short tower is framed with its top near 40% from the top, never lower, and clear of the screen bottom', async ({
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
  expect(platformY).toBeLessThan(SCREEN_BOTTOM_LIMIT_PX);
  expect(pageErrors).toEqual([]);
});

test('the camera never overshoots the platform past the screen bottom', async ({ page }) => {
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
  expect(platformY).toBeLessThan(SCREEN_BOTTOM_LIMIT_PX);
  expect(topY as number).toBeLessThan(SCREEN_BOTTOM_LIMIT_PX);
  expect(pageErrors).toEqual([]);
});

test('an idle board (no pieces resting) shows the platform low, using the space freed by removing the bottom button row', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });
  // Let the camera settle to its resting position.
  await page.evaluate(() => window.__materia!.stepFast(1));

  const platformY = await page.evaluate(() => window.__materia!.platformScreenY());
  // Platform's top sits well below the old 40%-pinned framing (384px) — near
  // the bottom of the screen, respecting PLATFORM_BOTTOM_MARGIN_PX.
  expect(platformY).toBeGreaterThan(VIEW_TOP_FRACTION_PX);
  expect(platformY).toBeLessThan(SCREEN_BOTTOM_LIMIT_PX);
  expect(pageErrors).toEqual([]);
});

test('the dev material-picker panel is hidden by default and forces the next piece when a swatch is tapped', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  // Phaser's canvas is letterboxed/scaled (Scale.FIT) to the Playwright
  // viewport, so a 540x960 game-space coordinate isn't a page-space
  // coordinate — map it through the canvas's actual displayed box.
  const canvasBox = await page.locator('canvas').boundingBox();
  if (!canvasBox) throw new Error('canvas not found');
  const toPagePoint = (gx: number, gy: number): { x: number; y: number } => ({
    x: canvasBox.x + (gx / 540) * canvasBox.width,
    y: canvasBox.y + (gy / 960) * canvasBox.height,
  });

  const countBefore = await page.evaluate(() => window.__materia!.pieceCount());
  expect(await page.evaluate(() => window.__materia!.hudDevPanelOpen())).toBe(false);

  // Tapping the wrench (top-right) opens the panel and must never itself
  // drop a piece.
  const wrench = await page.evaluate(() => window.__materia!.hudWrenchCenter());
  const wrenchPage = toPagePoint(wrench.x, wrench.y);
  await page.mouse.click(wrenchPage.x, wrenchPage.y);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__materia!.hudDevPanelOpen())).toBe(true);
  expect(await page.evaluate(() => window.__materia!.pieceCount())).toBe(countBefore);

  // Tapping the glass swatch (index 3 of 5) forces glass as the next piece,
  // and must not itself drop a piece either.
  const swatchPage = toPagePoint(GLASS_SWATCH_X, DEV_PANEL_SWATCH_Y);
  await page.mouse.click(swatchPage.x, swatchPage.y);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__materia!.pieceCount())).toBe(countBefore);

  const dropped = await page.evaluate(() => window.__materia!.drop());
  expect(dropped).toBe(true);
  await page.evaluate(() => window.__materia!.stepFast(1));
  expect(await page.evaluate(() => window.__materia!.countByMaterial('glass'))).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
