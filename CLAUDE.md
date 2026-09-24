# Materia — project rules

**Android-only** casual physics game (portrait). The browser build is only a dev/test harness — never a release target. Game: stack pieces of different materials (wood, stone, jelly, glass…) into a tower. The *feel* (sound, haptics, effects) is the product. Read `docs/GDD.md` and `docs/BUILD_PLAN.md` before any task.

## Stack
- Vite + TypeScript (strict) + **Phaser 4** (render, input, scenes, tweens)
- **Rapier 2D** `@dimforge/rapier2d-compat` (physics, WASM) — NOT Phaser's Matter plugin
- Vitest (logic tests), Playwright (browser smoke/screenshots)
- Android wrapper decided at M2 (Capacitor or Expo+WebView). No server, no accounts; storage is local only.

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | dev server on http://localhost:5173 (`?debug=1` shows tuning/FPS) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run e2e` | Playwright smoke (builds + previews first) |
| `npm run check` | typecheck + test + build — must pass before a task is "done" |

## Folder structure
```
src/
  main.ts              Phaser game config, boots Rapier then scenes
  game/                pure logic — NO Phaser imports here (unit-testable)
    materials.ts       all material values (tune ONLY here)
    glass.ts           crack/shatter state machine
    rng.ts             seeded RNG (later)
  physics/physics.ts   Rapier world wrapper, fixed step, units
  scenes/GameScene.ts  gameplay scene
  fx/                  audio.ts (WebAudio synth), haptics.ts, effects.ts
  ui/                  HUD
tests/unit/            *.test.ts (Vitest)
tests/e2e/             *.spec.ts (Playwright)
docs/                  GDD, build plan
```

## Rules
1. Units: physics in meters, `PX_PER_M = 50`. Convert only in `physics.ts`.
2. Fixed physics step 1/60 s with accumulator; render interpolates nothing fancy.
3. Pure game rules go in `src/game/` with tests. Scenes stay thin.
4. No per-frame allocations in hot paths (reuse vectors/objects). ≤ 40 dynamic bodies.
5. No asset files unless required — sounds are synthesized, shapes drawn with Graphics.
6. Platform APIs (vibrate, storage, ads, IAP) only behind adapters in `src/fx` / `src/platform`, with browser no-op fallbacks.
7. Expose test hooks on `window.__materia` (body counts, drop(), setMaterial()) — only read by Playwright.
8. Keep files < 300 lines. No new dependencies without the main model's approval.
9. Commit messages: `type(scope): summary` (feat, fix, chore, test, docs).

## Agents (see `.claude/agents/`)
- Main model: plans, splits tasks, reviews diffs, runs `npm run check`, talks to Serhii.
- `builder` (Sonnet): writes game code for one task at a time.
- `helper` (Haiku): config, tests, small fixes, running checks and reporting.

## Playwright note
In cloud sandboxes use Chromium at `/opt/pw-browsers` (env `PLAYWRIGHT_BROWSERS_PATH`); do not run `playwright install` there. Locally run `npx playwright install chromium` once.
