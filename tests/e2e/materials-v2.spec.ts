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
    };
  }
}

// Round 7 ("Materials v2": Steel, Polystyrene, Paper, props model, stable
// height HUD) — see docs/GDD.md §2.0.

function collectErrors(page: import('@playwright/test').Page) {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Every spec's baseURL setup hits this same 404 for an unrelated
    // resource (see fuzz.spec.ts's collectErrors) — not a game error.
    if (msg.text().includes('Failed to load resource')) return;
    consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

test('dropping each new material (steel, polystyrene, paper) produces no errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const materials: MaterialId[] = ['steel', 'polystyrene', 'paper'];
  for (const material of materials) {
    await page.evaluate((m) => {
      window.__materia!.setMaterial(m);
      window.__materia!.drop();
      window.__materia!.stepFast(2); // let it land, react (sound/haptic/fx), and settle
    }, material);
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('steel dropped on glass shatters it', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('glass', 5.4, 14.2);
    window.__materia!.spawn('steel', 5.4, 10);
    window.__materia!.stepFast(3);
  });

  const glassCount = await page.evaluate(() => window.__materia!.countByMaterial('glass'));
  expect(glassCount).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('3 stones dropped on polystyrene compress it', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const polyId = await page.evaluate(() => {
    const id = window.__materia!.spawn('polystyrene', 5.4, 14.2);
    window.__materia!.stepFast(1);
    return id;
  });
  expect(polyId).not.toBeNull();

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      window.__materia!.spawn('stone', 5.4, 11);
      window.__materia!.stepFast(2);
    });
  }

  const level = await page.evaluate((id) => window.__materia!.squashLevel(id!), polyId);
  expect(level).not.toBeNull();
  expect(level as number).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('paper falls slower than wood', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  async function stepsToSleep(material: MaterialId): Promise<number> {
    await page.evaluate(() => window.__materia!.clearPieces());
    await page.evaluate((m) => window.__materia!.spawn(m, 5.4, 13), material);
    const STEP = 0.05;
    const MAX_STEPS = 200; // 10s cap
    for (let i = 0; i < MAX_STEPS; i++) {
      const asleep = await page.evaluate((s) => {
        window.__materia!.stepFast(s);
        return window.__materia!.allSleeping();
      }, STEP);
      if (asleep) return i + 1;
    }
    return MAX_STEPS;
  }

  const woodSteps = await stepsToSleep('wood');
  const paperSteps = await stepsToSleep('paper');

  expect(paperSteps).toBeGreaterThan(woodSteps);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('height display is stable during a jelly wobble (no more than 1 change per 0.3s)', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('jelly', 5.4, 14.2);
    window.__materia!.stepFast(0.5);
    // Bouncy jelly + a hard-ish drop on top wobbles displayed height around.
    window.__materia!.spawn('jelly', 5.4, 10);
  });

  const STEP = 0.05; // 50ms sub-steps to see every possible display change
  const WINDOW_S = 0.3;
  let lastValue = await page.evaluate(() => window.__materia!.displayedHeight());
  let lastChangeAt = -Infinity; // no real change yet — don't penalize the first one
  let t = 0;
  let violations = 0;
  for (let i = 0; i < 100; i++) {
    // 5s total
    const value = await page.evaluate((s) => {
      window.__materia!.stepFast(s);
      return window.__materia!.displayedHeight();
    }, STEP);
    t += STEP;
    if (value !== lastValue) {
      if (t - lastChangeAt < WINDOW_S) violations++;
      lastChangeAt = t;
      lastValue = value;
    }
  }

  expect(violations).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// GDD §2.0 "Looks & living details" (round 8): wormy wood, green jelly with
// bubbles/bugs, and the hook alternating its starting swing direction.

test('a wormy wood piece is fully eaten (removed, reason "eaten") after 125s, no errors', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const id = await page.evaluate(() => {
    const id = window.__materia!.spawnWormy(5.4, 14.2);
    window.__materia!.stepFast(1);
    return id;
  });
  expect(id).not.toBeNull();

  await page.evaluate(() => window.__materia!.stepFast(125));

  const stillExists = await page.evaluate((pid) => window.__materia!.pieceExists(pid!), id);
  expect(stillExists).toBe(false);

  const record = await page.evaluate((pid) => window.__materia!.removals().find((r) => r.id === pid), id);
  expect(record?.reason).toBe('eaten');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('hook direction alternates for 4 consecutive pieces', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const directions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const dir = await page.evaluate(() => window.__materia!.hookDirection());
    directions.push(dir);
    await page.evaluate(() => {
      window.__materia!.drop();
      window.__materia!.stepFast(1); // clears the drop cooldown, spawns the next hook preview
    });
  }

  for (let i = 1; i < directions.length; i++) {
    expect(Math.sign(directions[i])).toBe(-Math.sign(directions[i - 1]));
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
