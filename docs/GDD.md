# Materia — Game Design Doc (v0.1)

**Platform:** Android only (Google Play), portrait, one thumb. Browser build = dev/test harness only.
**One line:** stack pieces of different materials into a tower; every material looks, sounds, feels and breaks differently.
**Hook for videos:** wobbling jelly, cracking glass, heavy stone crushing a fragile tower.

## 1. Core loop

| Step | What happens |
|---|---|
| 1. Next piece | A piece (shape + material) swings on a hook above the tower. "Next" preview shows the one after. |
| 2. Drop | Tap anywhere → piece drops. |
| 3. React | Landing plays material sound + haptic + effect (squash, dust, crack, shatter). |
| 4. Settle | Tower sleeps → height is measured → camera rises. |
| 5. Fail | A piece falls off the platform → lose 1 of 3 hearts. 0 hearts = run over. |
| 6. Result | Score = max stable height (+ combo bonus). Share button records last 10 s (later). |

Session target: 60–120 s per run. One-thumb control.

## 2. Materials

Units: Rapier meters, 1 m = 50 px. Base piece 2.0 × 0.6 m.

| Material | Density | Friction | Restitution | Special rule | Sound / haptic | Visual |
|---|---|---|---|---|---|---|
| Wood | 0.8 | 0.6 | 0.10 | — baseline | warm "knock", 20 ms | grain lines |
| Stone | 2.6 | 0.8 | 0.02 | heavy impact shakes camera; crushes glass | low "thud", 45 ms | dust puff, shake |
| Jelly | 0.9 | 0.9 | 0.55 | bouncy; visual squash/wobble (spring on scaleX/Y), no soft-body | "boing" pitch-up, [15,30,15] | squash + wobble |
| Glass | 1.5 | 0.25 | 0.15 | crack at impact ≥ **crackForce**; shatter if cracked & hit again, impact ≥ **breakForce**, or carried load ≥ **loadLimit** for 0.5 s | "clink" / "crash", [10,20,60] | crack lines → shards |
| **Freeze (special)** | 0.9 | 0.5 | 0.0 | see §2.1 — fills gaps, flat top, glues neighbours, melts | "splash" → "crackle" freeze, [20,40,20] | water blob → frost → ice |
| *Metal (v1.1)* | 3.2 | 0.35 | 0.05 | dents glass-like but never breaks | "clang" | shine |
| *Rubber (v1.1)* | 1.1 | 1.2 | 0.7 | grippy, very bouncy | "squeak" | — |
| *Ice (v1.2)* | 0.9 | 0.02 | 0.05 | slippery; melts after 20 s (shrinks) | "tink" | frost |

### 2.1 Freeze (special block)

| Phase | Rule |
|---|---|
| Fall | water blob, fixed volume (≈ 2.0 × 0.6 m = 1.2 m²) |
| Land | probe surface below at ~10 columns across its width; fill gaps up to one **flat top line** (volume-conserving: bigger gaps → lower line) |
| Freeze | 0.3 s frost effect → becomes one solid body (strip boxes compound collider) |
| Glue | fixed joints to every body it touches; joint breaks if impact force > breakForce (≈ stone 3 m drop) |
| Melt | after 20 s glue weakens (joints removed one by one) and the ice slowly shrinks 30% |
| Spawn | never player-chosen: ~1 in 10 pieces, or reward for 3 perfect drops |

Other specials to consider later: balloon (lifts), TNT (3 s fuse unless covered), honey (sticky top), foam (grows 2×), magnet, sand bag.

All values live in `src/game/materials.ts` and are tuned only there (live tuning panel in debug build).

## 3. Shapes

v1: plank (2.0×0.6), block (1.0×1.0), long plank (3.0×0.4), small cube (0.7×0.7). Later: triangle, cylinder, L-shape.

## 4. Modes & progression

| Mode | Rules | v1? |
|---|---|---|
| **Endless** | random sequence, 3 hearts, best height saved | yes |
| **Levels** | 30 hand-tuned levels: reach height X with a fixed sequence ("5 glass under 2 stone"). 1–3 stars (height, pieces left, no hearts lost). New material unlocks every ~8 levels. | yes (20 levels) |
| **Daily** | seed = `YYYY-MM-DD` → same sequence, wind and platform for everyone. One scored attempt + unlimited practice. Streak counter. | yes |
| Sandbox | pick any material freely | debug only in v1 |

Daily without a server: `seed = hash("materia-" + date)` → `mulberry32(seed)` → piece list, wind strength, platform width. Rapier is deterministic on the same build, so identical inputs give identical results. Share card: "Materia #142 · 23.4 m · 🟫🟫🟪⬜🪨" (emoji of materials used).

Progression reward: cosmetic skins for pieces (earned by stars) — no pay-to-win.

## 5. Monetization

| Item | Where | Rule |
|---|---|---|
| Interstitial | after run over | max 1 per 3 runs, never in first 3 runs, never during daily attempt |
| Rewarded | "continue with +1 heart", "double daily stars" | optional, max 1 per run |
| Banner | none | hurts the feel / video captures |
| **Remove ads** | Google Play IAP, ~€2.99 non-consumable | removes interstitials, keeps optional rewarded |

Tech: AdMob via `@capacitor-community/admob`, IAP via RevenueCat Capacitor or `cordova-plugin-purchase`. Everything stored locally (Capacitor Preferences). Purchase restore via Play Billing.

## 6. Feel budget (the product)

- Every contact event: sound (pitch/volume by impact force), haptic (by material), small effect.
- Hit-stop 40 ms + camera shake on big impacts.
- Collapse = slow-motion 0.4× for 1 s (great for clips).
- 60 fps on a €100 Android phone: ≤ 40 dynamic bodies, sleeping enabled, pre-generated sounds, no per-frame allocations.

## 7. Scope

| v0 Prototype (browser) | v1 Release (Android) | Later |
|---|---|---|
| 4 materials + Freeze spike, 1 shape, hook + drop, hearts, height, sound, vibration, effects, material picker | Endless, 20 levels, Daily, 4 shapes, settings, AdMob, remove-ads IAP, local save, Play Store listing | Metal/rubber/ice, skins, clip recorder, leaderboard (optional server) |

## 8. Tech decision

| Proposed | Chosen | Why |
|---|---|---|
| Phaser + **matter.js** | Phaser 4 (render, input, scenes, tweens) + **Rapier 2D** (`@dimforge/rapier2d-compat`, WASM) | matter.js towers jitter, sink and slide when stacked — the core of this game. Rapier (Box2D-class solver) stacks stably, sleeps bodies, is deterministic (daily), fast on weak phones, and reports contact **forces** — exactly what glass cracking needs. Cost: ~40 lines of sync code instead of Phaser's built-in Matter plugin. |
| Capacitor | **Open — decide at M2** (Capacitor / Expo+WebView / TWA) | game is a plain web build; wrapper doesn't affect game code. Expo-native (Skia) rejected: no WASM in Hermes → no Rapier |
| Playwright | Playwright + Vitest | Vitest for pure logic (seeds, materials, glass rules), Playwright for smoke/screenshots |
