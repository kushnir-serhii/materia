# Build Plan

Rules: one task = one PR-sized change. Agent column: **S** = `builder` (Sonnet), **H** = `helper` (Haiku), **M** = main model (review/decisions). A task is done only when its "Done check" passes.

## M0 — Browser prototype (feel the physics)

| # | Task | Agent | Done check |
|---|---|---|---|
| 0.1 | Scaffold Vite + TS + Phaser 4 + Rapier, scripts, tsconfig strict | H | `npm run build` and `npm run typecheck` pass |
| 0.2 | `materials.ts` — 4 materials with physics + feel values | S | Vitest: every material has all fields, values in sane ranges |
| 0.3 | `physics.ts` — Rapier world wrapper, fixed 60 Hz step, px↔m, body↔sprite sync | S | Vitest: box dropped on ground comes to sleep within 3 s |
| 0.4 | GameScene: platform, hook swinging piece, tap/click/Space to drop, camera follows height | S | Playwright: 5 drops → 5 bodies exist, no console errors |
| 0.5 | Glass rules (crack / shatter by impact and load) as pure logic + scene wiring | S | Vitest on `glass.ts` state machine; Playwright: stone on glass → glass count decreases |
| 0.6 | Jelly squash/wobble spring | S | visual review screenshot (M) |
| 0.7 | Audio synth per material (WebAudio, no files) + `navigator.vibrate` patterns | S | no errors; M listens |
| 0.8 | Effects: dust, shards, camera shake, hit-stop | S | screenshot review (M) |
| 0.9 | HUD: hearts, height, best, material picker (1–4 keys), reset (R), debug tuning panel | S | Playwright smoke passes |
| 0.11 | **Freeze spike** (GDD §2.1): fill-to-flat-line shape, freeze, glue joints, melt; debug key 5 | S | Vitest on fill-shape math (volume conserved, flat top); Playwright: freeze on uneven tower → joints > 0, top flat ±0.05 m; screenshot review (M) |
| 0.10 | **Playtest** by Serhii, tune values in `materials.ts` | M | Serhii says "feels good" |

## M1 — Game structure

| # | Task | Agent | Done check |
|---|---|---|---|
| 1.1 | Seeded RNG (`mulberry32`) + sequence generator | S | Vitest: same seed → same list |
| 1.2 | Scenes: Boot, Menu, Game, Result | S | Playwright navigates Menu→Game→Result |
| 1.3 | Endless mode + best score saved (storage adapter: localStorage now, Capacitor Preferences later) | S | Vitest on storage adapter; reload keeps best |
| 1.4 | 4 shapes | S | Playwright spawns each |
| 1.5 | Level format (JSON) + 20 levels + stars | S | Vitest validates all level files |
| 1.6 | Daily challenge (date seed, one attempt, streak, share text) | S | Vitest: fixed date → fixed sequence/share text |
| 1.7 | Settings: sound, vibration, reduced motion | H | toggles persist |
| 1.8 | Collapse slow-mo + "near miss" feedback | S | M review |

## M2 — Android

| # | Task | Agent | Done check |
|---|---|---|---|
| 2.0 | **Decide wrapper**: Capacitor vs Expo+WebView vs TWA (game code unchanged either way) | M + Serhii | decision logged in GDD §8 |
| 2.1 | Add chosen wrapper, Android project, `npm run android` | H | debug APK installs on phone |
| 2.2 | Haptics via `@capacitor/haptics` behind `haptics.ts` adapter | H | vibration on device |
| 2.3 | Perf pass on cheap phone (target 60 fps, ≤ 40 bodies, audio pool) | S | FPS overlay ≥ 55 on test device |
| 2.4 | Back button, pause on background, screen orientation lock | H | manual check list |
| 2.5 | Icons, splash, app id `com.calmisu.materia` (confirm) | H | builds signed AAB |

## M3 — Money & release

| # | Task | Agent | Done check |
|---|---|---|---|
| 3.1 | `ads.ts` adapter (AdMob test IDs; no-op in browser) with frequency rules from GDD | S | Vitest on frequency rules |
| 3.2 | Remove-ads IAP + restore | S | test purchase on internal track |
| 3.3 | Privacy policy, Data safety form, UMP consent (EU) | M | Play Console accepts |
| 3.4 | Store listing + 3 short videos captured from the game | M | internal → closed test live |
