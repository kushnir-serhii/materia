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
      hudWrenchCenter: () => { x: number; y: number };
      hudDevPanelOpen: () => boolean;
    };
  }
}

// Playtest crash: "at one moment when I tried to drop a block, it
// disappeared, ALL blocks disappeared and I can't drop any more." Root
// cause: Rapier's removeRigidBody() also silently drops every impulse joint
// attached to that body. FreezeController only forgot its OWN (ice-side)
// joint references when the ICE piece was removed (releaseJoints) — if the
// *other*, glued piece was removed first (fell off the platform, glass
// shattered under it, a hard reset), the ice kept a stale JS reference to
// an already-gone Rapier joint. The next removeImpulseJoint() on that
// handle (a force-break, or melt shifting through its joint list) is a
// Rapier WASM panic ("unreachable") that poisons the whole physics world —
// every future call into it throws, which is exactly "everything
// disappeared and nothing drops any more" (PieceManager.step() throwing
// every frame from inside Phaser's update loop).
//
// Fixed at the source: PieceManager.destroy() now purges any *other* ice
// piece's stale joint reference to the piece being removed
// (FreezeController.purgeJointsTo), for every removal, before the body
// actually goes — not just when the removed piece is itself frozen ice.
// physics.ts's removeBody/removeCollider/removeImpulseJoint also each
// check isValid() first as a defensive backstop, and GameScene wraps every
// frame in try/catch with an auto-reset + toast as a last-resort safety
// net for anything still unforeseen.
//
// This file: a seeded action fuzzer that hammers exactly the scenarios
// above (glue + remove the glued side, glue + remove the ice, reset mid
// freeze, melt after glued pieces are gone) across many random sequences,
// plus the four scenarios called out explicitly as their own deterministic
// tests.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_MATERIALS: MaterialId[] = ['wood', 'stone', 'jelly', 'glass', 'freeze'];

interface FuzzResult {
  actionsRun: number;
  errors: string[]; // caught inside the page (our own try/catch escaped, or an assertion inside the fuzz loop failed)
}

/** Runs one seeded ~150-action fuzz sequence entirely inside the page (fast: no per-action round trip), returning a summary. */
async function runFuzzSeed(
  page: import('@playwright/test').Page,
  seed: number,
  actionCount = 150,
): Promise<FuzzResult> {
  return page.evaluate(
    ({ seed, actionCount, materials }) => {
      const m = window.__materia!;
      const errors: string[] = [];
      let a = seed >>> 0;
      const rand = (): number => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

      let actionsRun = 0;
      for (let i = 0; i < actionCount; i++) {
        try {
          const roll = rand();
          if (roll < 0.35) {
            // Drop via the swinging hook (its actual x at whatever cooldown/phase it's in).
            m.setMaterial(pick(materials) as never);
            m.drop();
          } else if (roll < 0.65) {
            // Spawn at a random x across (and a bit past) the platform, random y above it.
            const x = 3 + rand() * 4.8;
            const y = 8 + rand() * 6;
            m.spawn(pick(materials) as never, x, y);
          } else if (roll < 0.93) {
            // Random short/medium step.
            m.stepFast(0.1 + rand() * 2.9);
          } else if (roll < 0.98) {
            // Occasional long step — well past meltStartS (30s), into active melting.
            m.stepFast(35);
          } else {
            m.reset();
          }
        } catch (err) {
          errors.push(`action ${i} threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }

        // "The game is alive": these must never throw, whatever the physics
        // world's current state is.
        try {
          m.pieceCount();
        } catch (err) {
          errors.push(`pieceCount() threw after action ${i}: ${err instanceof Error ? err.message : String(err)}`);
        }
        actionsRun++;
      }

      // A drop must still work at the end (clear any cooldown first).
      try {
        m.stepFast(1);
        const before = m.pieceCount();
        m.setMaterial('wood' as never);
        m.drop();
        m.stepFast(0.05);
        const after = m.pieceCount();
        if (after < before) errors.push(`final drop did not add a piece (before=${before}, after=${after})`);
      } catch (err) {
        errors.push(`final drop threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }

      return { actionsRun, errors };
    },
    { seed, actionCount, materials: ALL_MATERIALS },
  );
}

function collectErrors(page: import('@playwright/test').Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Browser-level resource logging (e.g. a missing favicon), not a game
    // error — every other spec file's baseURL setup hits the same 404 and
    // none of them treat it as a failure either.
    if (msg.text().includes('Failed to load resource')) return;
    consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

for (const seed of [1, 42, 1337]) {
  test(`fuzz seed ${seed}: ~150 random actions never crash the game`, async ({ page }) => {
    test.setTimeout(60000);
    const { pageErrors, consoleErrors } = collectErrors(page);

    await page.goto('/');
    await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

    const result = await runFuzzSeed(page, seed, 150);

    expect(result.errors).toEqual([]);
    expect(result.actionsRun).toBe(150);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('targeted: glue glass to ice, then shatter the glass with a stone drop', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('glass', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12); // fills/glues across the glass + bare platform
    window.__materia!.stepFast(2);
  });

  const jointsBefore = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBefore).toBeGreaterThan(0);

  await page.evaluate(() => {
    // A stone plank dropped straight onto the glass shatters it —
    // PieceManager.destroy() removes the glass body while the ice still
    // holds a joint pointing at it.
    window.__materia!.spawn('stone', 4.4, -2);
    window.__materia!.stepFast(3);
  });

  const glassCount = await page.evaluate(() => window.__materia!.countByMaterial('glass'));
  expect(glassCount).toBe(0);

  // The world must still be alive: melt the ice all the way through
  // (past its now-stale joint, if the bug were still present) without a crash.
  await page.evaluate(() => window.__materia!.stepFast(65));
  const jointsAfter = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsAfter).toBe(0);

  const pieceCount = await page.evaluate(() => window.__materia!.pieceCount());
  expect(pieceCount).toBeGreaterThanOrEqual(0); // must not throw to get here

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('targeted: glue a piece to ice, then knock it off the platform', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    // Glue a wood plank near the platform's edge so a sideways knock can
    // send it (and only it) off — the ice stays behind.
    window.__materia!.spawn('wood', 3.2, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 3.6, 12);
    window.__materia!.stepFast(2);
  });

  const jointsBefore = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBefore).toBeGreaterThan(0);

  await page.evaluate(() => {
    // A heavy stone dropped right at the platform edge, off to one side,
    // to shove the glued wood plank off — PieceManager's fail-off-platform
    // check then destroys it while still jointed to the ice.
    window.__materia!.spawn('stone', 1.0, 8);
    window.__materia!.stepFast(4);
  });

  // Whatever happened to the wood plank, the world must still respond.
  await page.evaluate(() => window.__materia!.stepFast(65)); // run past full melt too
  const jointsAfter = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsAfter).toBe(0);

  const before = await page.evaluate(() => window.__materia!.pieceCount());
  await page.evaluate(() => {
    window.__materia!.setMaterial('wood');
    window.__materia!.drop();
    window.__materia!.stepFast(0.1);
  });
  const after = await page.evaluate(() => window.__materia!.pieceCount());
  expect(after).toBeGreaterThan(before);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('targeted: reset() during an active freeze', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('wood', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(0.2); // mid-freeze — still within GLUE_GRACE_PERIOD_S, rotation still locked
    window.__materia!.reset();
  });

  const pieceCountAfterReset = await page.evaluate(() => window.__materia!.pieceCount());
  expect(pieceCountAfterReset).toBe(0);

  await page.evaluate(() => window.__materia!.stepFast(1));
  const before = await page.evaluate(() => window.__materia!.pieceCount());
  await page.evaluate(() => {
    window.__materia!.setMaterial('stone');
    window.__materia!.drop();
    window.__materia!.stepFast(0.1);
  });
  const after = await page.evaluate(() => window.__materia!.pieceCount());
  expect(after).toBeGreaterThan(before);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('targeted: melt runs through to completion after every glued piece was already removed', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    window.__materia!.spawn('glass', 4.4, 14.2);
    window.__materia!.stepFast(1.5);
    window.__materia!.spawn('freeze', 5.4, 12);
    window.__materia!.stepFast(2);
  });

  const jointsBefore = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBefore).toBeGreaterThan(0);

  await page.evaluate(() => {
    // Shatter the glass the ice is glued to well before melt would ever
    // start walking its joint list on its own.
    window.__materia!.spawn('stone', 4.4, -2);
    window.__materia!.stepFast(3);
  });
  expect(await page.evaluate(() => window.__materia!.countByMaterial('glass'))).toBe(0);

  // Run past meltStartS (30s) + meltDurationS (30s) — melt must walk
  // through (and discard) whatever joints are left, including any stale
  // reference to the now-gone glass, without touching Rapier again for it.
  await page.evaluate(() => window.__materia!.stepFast(65));
  const jointsAfter = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsAfter).toBe(0);

  const before = await page.evaluate(() => window.__materia!.pieceCount());
  await page.evaluate(() => {
    window.__materia!.setMaterial('jelly');
    window.__materia!.drop();
    window.__materia!.stepFast(0.1);
  });
  const after = await page.evaluate(() => window.__materia!.pieceCount());
  expect(after).toBeGreaterThan(before);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
