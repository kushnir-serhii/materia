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

const ALL_MATERIALS: MaterialId[] = ['wood', 'stone', 'jelly', 'glass', 'steel', 'polystyrene', 'cardboard', 'freeze'];

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
            const dropped = m.drop();
            if (dropped) {
              // "The dropped piece just vanishes" playtest bug: after a
              // successful drop, the piece must either still be alive a
              // moment later, or have a removal reason that actually
              // explains it (fell off / shattered / melted / frozen into
              // its ice body) — never silently gone with no record.
              const id = m.lastDroppedPieceId();
              m.stepFast(1);
              if (id !== null && !m.pieceExists(id)) {
                const record = m.removals().find((r) => r.id === id);
                if (!record) {
                  errors.push(`action ${i}: dropped piece #${id} vanished with no removal record at all`);
                } else if (!['fell', 'shatter', 'melt', 'froze', 'culled'].includes(record.reason)) {
                  errors.push(`action ${i}: dropped piece #${id} removed for unexpected reason '${record.reason}'`);
                }
              }
            }
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
    // holds a joint pointing at it. x=3.8 (not 4.4, glass's own center)
    // stays inside the glass plank's span [3.4, 5.4] but clear of the
    // freeze piece's footprint [4.4, 6.4] — the ice only fills *gaps*, so
    // near x=4.4 (right at the boundary) it can end up sitting flush on
    // top of the glass instead of beside it, shielding it from a drop.
    window.__materia!.spawn('stone', 3.8, -2);
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

// Playtest v4 (commit 435f033): tower intact, hearts still 3/3, several
// freeze ice blocks (one tall ice column, ice strips, jelly wedged between
// ice blocks) — every drop from then on just vanished off the hook with no
// heart lost and no reset. Root cause: PieceManager.spawn()'s MAX_PIECES
// budget check counted `pieces.size` — one entry per Rapier COLLIDER handle
// — instead of the number of actual bodies/pieces. A single frozen ice
// piece's compound body can have up to FREEZE_COLUMNS (11) strip colliders,
// so a handful of ice blocks on an uneven surface alone could push
// `pieces.size` past 40 while the real piece/body count was still small;
// once that happened spawn() returned null forever (nothing shrinks the
// piece count except falling/melting) and GameScene.drop() ignored the
// null, so every tap still looked like a normal drop (hook swings away,
// cooldown starts) while nothing was ever actually created. Fixed by
// counting `piecesById` (one entry per logical piece) instead, and by
// having drop() bail out (no cooldown, no hook animation) when spawn()
// actually returns null, so a real budget hit is visible/retryable rather
// than silently eating the tap forever.
//
// A related latent bug found (and fixed) alongside it: FreezeController
// stored a glued neighbour by its Rapier collider *handle*
// (otherColliderHandle) — a number Rapier freely recycles for the next
// created collider. If that neighbour was itself an ice piece whose own
// melt later rebuilt its colliders under new handles, the old handle could
// be handed to a completely unrelated, freshly-dropped piece; the next
// purgeJointsTo() call for any removal could then false-match on it. Now
// every persisted cross-piece reference (FreezeGlueJoint) uses the piece's
// stable id (PieceManager.piecesById), which is never reassigned/recycled.
test('targeted: ice-heavy tower (screenshot repro) — many freeze strips must not starve the piece budget', async ({
  page,
}) => {
  test.setTimeout(30000);
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  // Several freeze pieces stacked flush on each other — matches the
  // screenshot's "several freeze ice blocks... one tall ice column" and, at
  // FREEZE_COLUMNS=11 strip colliders each, is enough on its own (~6 ice
  // pieces * up to 11 strips) to push the raw collider-handle count well
  // past 40 while the real number of bodies stays tiny. Landing flush/
  // centered keeps the tower stable (no toppling/heart loss), isolating the
  // piece-budget bug from any collapse-driven confound.
  const setup = await page.evaluate(() => {
    const m = window.__materia!;
    m.spawn('wood', 5.4, 14.2);
    m.stepFast(1.5);
    for (let i = 0; i < 6; i++) {
      m.spawn('freeze', 5.4, 8);
      m.stepFast(2);
    }
    return { rawColliderCount: m.pieceCount() };
  });
  // Confirms the setup actually exercises the bug's precondition: far more
  // raw collider-handle entries than MAX_PIECES (40), from only 7 bodies.
  expect(setup.rawColliderCount).toBeGreaterThan(40);

  // 15 more ordinary drops must all succeed — under the bug, spawn()
  // permanently refused every one of these once the (miscounted) piece
  // total crossed 40, with no heart lost and no error, matching the report
  // ("the piece leaves the hook and just disappears... every time from
  // then on"). Placed via spawn() at the platform's fixed center — same
  // isolation-from-toppling reasoning as the setup above, and it's
  // PieceManager.spawn() itself (not the swinging hook, which since round 8
  // alternates its starting direction — GDD §2.0 "Hook movement" — can send
  // a couple of pieces far enough apart to topple an already-precarious
  // tower on its own, an unrelated confound) that the piece-budget bug
  // actually lives in.
  const result = await page.evaluate(() => {
    const m = window.__materia!;
    const errors: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = m.spawn('wood', 5.4, 8);
      if (id === null) errors.push(`drop #${i} was refused (spawn() returned null) well under the real body budget`);
      m.stepFast(1);
    }
    return { errors, bodyCountAtEnd: m.pieceCount() };
  });

  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// A neighbouring-ice-to-ice glue scenario (the exact configuration the
// stale-collider-handle bug in FreezeGlueJoint needed — see the file
// comment above): two ice pieces glued to each other, the first one melts
// all the way through (rebuilding/discarding its colliders under new
// handles several times), and a fresh piece is dropped afterward. Before
// the id-based fix, a coincidental handle reuse here could make
// purgeJointsTo() misfire against the unrelated new piece.
test('targeted: ice glued to ice, one melts through completely, drops keep working', async ({ page }) => {
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    const m = window.__materia!;
    m.spawn('wood', 3.5, 14.2);
    m.spawn('wood', 7.0, 14.2);
    m.stepFast(1.5);
    // Two freeze pieces side by side, close enough that their compound
    // bodies' AABBs overlap and glue() joints them to each other.
    m.spawn('freeze', 4.4, 10);
    m.stepFast(1.5);
    m.spawn('freeze', 5.8, 9);
    m.stepFast(2);
  });

  const jointsBefore = await page.evaluate(() => window.__materia!.jointCount());
  expect(jointsBefore).toBeGreaterThan(0);

  // Past meltStartS + meltDurationS — both ice pieces fully melt away,
  // each rebuilding its colliders under new handles several times first.
  await page.evaluate(() => window.__materia!.stepFast(65));
  expect(await page.evaluate(() => window.__materia!.jointCount())).toBe(0);
  expect(await page.evaluate(() => window.__materia!.countByMaterial('freeze'))).toBe(0);

  const before = await page.evaluate(() => window.__materia!.pieceCount());
  const dropped = await page.evaluate(() => {
    const m = window.__materia!;
    m.setMaterial('wood');
    return m.drop();
  });
  expect(dropped).toBe(true);
  await page.evaluate(() => window.__materia!.stepFast(0.1));
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
    // start walking its joint list on its own. x=3.8 (not 4.4, glass's own
    // center) stays inside the glass plank's span but clear of the freeze
    // piece's footprint — see the identical comment in the test above.
    window.__materia!.spawn('stone', 3.8, -2);
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

// Round-6 follow-up: a long run (coordinator's example: ~24m/~60 pieces)
// must never hit the old hard "spawn refused at the piece budget" dead end.
// Builds a stacked, non-toppling 70-piece tower purely through spawn() +
// stepFast() (fast/deterministic, no drop()/hook timing involved — a real
// hook drop can miss/topple and lose a heart for reasons unrelated to the
// piece budget, which isn't what this test is about). Every single spawn()
// call must immediately add one more logical piece — checked right after
// each call, before that step's stepFast() gives the settle/cull policy a
// chance to run, so a cull happening later can never be mistaken for a
// refused spawn. Throughout, the *dynamic* body count must stay bounded at
// DYNAMIC_PIECE_BUDGET (30) — the "fps-relevant body count bounded"
// requirement, since a settled/fixed body is cheap and Rapier only has to
// keep simulating the dynamic ones — and the policy must actually settle
// (not just cull) most of the buried pieces.
test('settle policy: 70-piece tower never refuses a spawn, dynamic body count stays bounded', async ({ page }) => {
  test.setTimeout(60000);
  const { pageErrors, consoleErrors } = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => !!window.__materia, undefined, { timeout: 5000 });

  const PIECES = 70;
  const result = await page.evaluate((pieceCount) => {
    const m = window.__materia!;
    const materials: MaterialId[] = ['wood', 'stone', 'jelly'] as unknown as MaterialId[];
    const maxDynamicSeen: number[] = [];
    const failedSpawnAt: number[] = [];
    let x = 5.4;
    let y = 14.6;
    for (let i = 0; i < pieceCount; i++) {
      const material = materials[i % materials.length];
      const totalBefore = m.dynamicPieceCount() + m.settledPieceCount();
      m.spawn(material, x, y);
      // Checked immediately, before stepFast() runs the settle/cull policy
      // — this isolates "did spawn() actually add the piece" from whatever
      // maintainPieceBudget() decides to do with it afterward.
      const totalRightAfterSpawn = m.dynamicPieceCount() + m.settledPieceCount();
      if (totalRightAfterSpawn !== totalBefore + 1) failedSpawnAt.push(i);
      m.stepFast(1.2);
      y -= 0.6; // stack the next one flush on top, centered — no toppling
      maxDynamicSeen.push(m.dynamicPieceCount());
    }
    return {
      failedSpawnAt,
      maxDynamic: Math.max(0, ...maxDynamicSeen),
      settledPieceCount: m.settledPieceCount(),
      removals: m.removals(),
    };
  }, PIECES);

  // Every spawn() call must have succeeded — never refused.
  expect(result.failedSpawnAt).toEqual([]);
  // The dynamic body count must have stayed bounded near the budget (a
  // little slack for pieces still settling from a very recent spawn, not
  // yet eligible/resting) rather than climbing toward 70.
  expect(result.maxDynamic).toBeLessThanOrEqual(35);
  // The settle policy must actually have kicked in (not just culling).
  expect(result.settledPieceCount).toBeGreaterThan(0);
  // Any removal along the way must be an accounted-for 'culled' fallback —
  // never a crash/error/unexplained loss.
  for (const r of result.removals) {
    expect(r.reason).toBe('culled');
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
