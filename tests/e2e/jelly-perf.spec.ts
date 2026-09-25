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

// Playtest bug: "the game breaks when a few jellies vibrate at the same
// time" — jelly's high restitution (0.55) meant a resting pile kept
// reporting contact-force events every physics step, each one retriggering
// sound/haptic/wobble (PieceManager.handleImpact had no real "was this an
// actual impact" check, just a raw force threshold + an 80ms per-piece
// debounce) — with several jellies stacked, that's a steady stream of
// fx() calls and navigator.vibrate spam, plus jitter that kept the bodies
// from ever sleeping. Fixed via: an approach-speed gate on what counts as
// an impact, a longer per-piece cooldown, a global fx rate budget, and
// enough jelly damping to actually settle/sleep. This test stacks 6 jellies
// (jelly landing on jelly) and checks the steady-state fx rate and that
// they do go to sleep, both under stepFast and under the page's real
// render loop.
test('several stacked jellies settle without spamming fx or stalling', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const simStartMs = Date.now();
  await page.evaluate(() => {
    // 6 jellies dropped straight onto each other (jelly-on-jelly every time
    // after the first), each with enough clearance to land with real
    // energy and wobble against its neighbour below.
    let restingYM = 14.4;
    for (let i = 0; i < 6; i++) {
      window.__materia!.spawn('jelly', 5.4, restingYM - 1.2);
      window.__materia!.stepFast(0.8);
      restingYM -= 0.6;
    }
  });
  const simMs = Date.now() - simStartMs;
  // Simulating ~4.8s of physics for a 6-jelly stack should be comfortably
  // fast; a runaway per-step fx feedback loop (the reported bug) burns far
  // more CPU than this per simulated second.
  expect(simMs).toBeLessThan(5000);

  const count = await page.evaluate(() => window.__materia!.countByMaterial('jelly'));
  expect(count).toBe(6);

  // Steady-state fx rate under stepFast, once the initial landing wobbles
  // have had a moment to die down.
  await page.evaluate(() => {
    window.__materia!.resetFxImpactCount();
    window.__materia!.stepFast(2);
  });
  const fxWhileSettling = await page.evaluate(() => window.__materia!.fxImpactCount());
  // Budget is 6/s (fx/index.ts); allow a little slack for the tail end of
  // legitimate settling wobbles across the 2s window.
  expect(fxWhileSettling).toBeLessThanOrEqual(16);

  // The pile must actually reach Rapier's sleep state within a few seconds
  // of being left alone, not jitter forever.
  await page.evaluate(() => window.__materia!.stepFast(1));
  const asleepAfterStepFast = await page.evaluate(() => window.__materia!.allSleeping());
  expect(asleepAfterStepFast).toBe(true);

  // Real-time run too (the page's own Phaser render loop, not stepFast) —
  // confirms the fix holds outside the accelerated test harness.
  await page.evaluate(() => window.__materia!.resetFxImpactCount());
  await page.waitForTimeout(1500);
  const fxRealTime = await page.evaluate(() => window.__materia!.fxImpactCount());
  expect(fxRealTime).toBeLessThanOrEqual(10);
  const asleepRealTime = await page.evaluate(() => window.__materia!.allSleeping());
  expect(asleepRealTime).toBe(true);

  expect(pageErrors).toEqual([]);
});
