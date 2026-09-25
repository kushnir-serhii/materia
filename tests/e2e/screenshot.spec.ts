import { test } from '@playwright/test';
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

// Not part of the smoke suite's pass/fail contract — just captures reference
// screenshots of the M0 prototype for docs/screens/.
test('capture M0 screenshot: mixed tower incl. steel, polystyrene, paper, green jelly, wormy wood', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  // Placed via spawn()/spawnWormy() (not the swinging hook) so every piece
  // lands perfectly centered on the one below it — a reliable, non-flaky
  // stack for a reference screenshot. x=5.4m is the platform's world-space
  // center. Order: steel/stone/wormy-wood as a heavy, stable base; the
  // lighter, more fragile materials (polystyrene, jelly, paper) go on top
  // so nothing lands on them afterward and squashes/topples/breaks them.
  // heightM matches each material's actual MaterialSize (paper is thin,
  // 0.15m — see materials.ts).
  const sequence: { m: MaterialId | 'wormy-wood'; heightM: number }[] = [
    { m: 'steel', heightM: 0.6 },
    { m: 'stone', heightM: 0.6 },
    { m: 'wormy-wood', heightM: 0.6 },
    { m: 'polystyrene', heightM: 0.6 },
    { m: 'jelly', heightM: 0.6 },
    { m: 'paper', heightM: 0.15 },
  ];
  let restingYM = 14.7; // first piece's resting center-y (platform top - half piece height)
  for (const entry of sequence) {
    const dropYM = restingYM - 1.5; // small clearance so it visibly falls and settles
    await page.evaluate(
      ({ m, y }) => {
        if (m === 'wormy-wood') window.__materia!.spawnWormy(5.4, y);
        else window.__materia!.spawn(m as MaterialId, 5.4, y);
        window.__materia!.stepFast(1.5);
      },
      { m: entry.m, y: dropYM },
    );
    restingYM -= entry.heightM;
  }
  // let the camera lerp settle
  await page.evaluate(() => window.__materia!.stepFast(0.5));
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'docs/screens/m0.png' });
});

// Captures the shard/flash particles right after a glass piece shatters
// (a stone plank dropped straight onto a resting glass plank).
test('capture M0 screenshot: glass shatter effects', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('glass', 5.4, 14.2);
    window.__materia!.stepFast(1); // let the glass settle before it's hit
    window.__materia!.spawn('stone', 5.4, 10);
  });

  // step in small increments and stop the instant the glass shatters, so the
  // screenshot lands while the shard/flash particles are still fresh.
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) {
      window.__materia!.stepFast(0.05);
      if (window.__materia!.countByMaterial('glass') === 0) break;
    }
  });

  await page.screenshot({ path: 'docs/screens/m0-shatter.png' });
});

// Captures the flat top line right after a freeze piece lands and freezes
// solid on an uneven tower (a wood plank on only the left half of the
// platform), for docs/screens/ review of GDD §2.1.
test('capture M0 screenshot: freeze fills an uneven tower flat', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
  });

  // step in small increments and stop right after it freezes (jointCount
  // becomes > 0), so the screenshot lands while the frost/flash fx are fresh.
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) {
      window.__materia!.stepFast(0.05);
      if (window.__materia!.jointCount() > 0) break;
    }
  });

  await page.screenshot({ path: 'docs/screens/m0-freeze.png' });
});
