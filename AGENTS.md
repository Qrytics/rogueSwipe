# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Stack

TypeScript + Phaser 3 browser game, bundled with Vite. No test framework, no linter config — TypeScript strict mode is the only enforcer.

## Commands

```bash
npm run dev      # local dev server
npm run build    # tsc -b && vite build
npm run preview  # preview production build
```

No lint or test scripts exist. Validate with `npm run build`.

## Architecture

```
src/main.ts          → Phaser.Game bootstrap, registers [MenuScene, GameScene]
src/scenes/          → Phaser scenes only — render, input, orchestration
src/game/engine.ts   → Pure game logic (no Phaser dependency) — board mutation
src/game/types.ts    → All shared types; single source of truth
src/game/audio.ts    → SoundEngine — Web Audio API synthesis, no audio files
src/game/persistence.ts → localStorage save/migrate, leaderboard
src/game/random.ts   → Deterministic RNG: hashString + mulberry32
src/game/cloud.ts    → Optional Supabase sync via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

**Critical separation**: `src/game/` is Phaser-free pure logic. Never import Phaser inside `src/game/`.

## Key Patterns

- **Deterministic RNG**: All randomness uses `mulberry32(hashString(seed))`. Seeding pattern: `` `${board.seed}:subsystem-name:${board.turn}` ``.
- **Board is mutated in place** by engine functions. `GameScene` deep-clones via `structuredClone()` before persisting.
- **Scene data passing**: Use `this.scene.start('GameScene', { runConfig, metaProgress })` or `{ resumeRun }`. `GameScene.create()` reads these via `this.data.get(...)`.
- **Save schema versioning**: Current version is `4` (`STORAGE_KEY = 'rogueSwipe.save.v4'`). When adding new `BoardState` fields, add migration defaults in `migrateRunSnapshot()`. Never bump the key without adding old key to `LEGACY_STORAGE_KEYS`.
- **Daily mode**: Reaches victory when progress fills (direct, no boss). Endless ends only on hero death. Quest triggers boss at 120 progress.
- **Web tile**: Hero stepping on a web sets `board.heroIsSlowed = true`; `processTurnLifecycle` skips spawning and clears the flag.
- **Difficulty scaling**: XP threshold = `100 + (heroLevel - 1) * 20`. Boss HP = `max(bossMaxHp, 8 + heroLevel * 2)`. Spawn pools shift at turns 20/40. Endless gains +1 spawn/30 turns capped at 4.
- **Text pool**: `GameScene` uses a pre-allocated pool of 50 `Text` objects (hide/show instead of destroy/create) to avoid GC pressure.
- **Sound cues**: `SoundEngine.playFromTurnResult(result, status)` reads the action message to pick the right tone. `playVictory()` / `playDefeat()` are called separately from `showEndState`.
- **Cloud sync**: 8-second `AbortController` timeout. Anonymous identity. `rogueswipe_profiles` table, snake_case columns.
- **Pause**: Escape key or swipe-guard when `this.paused === true`. `pauseOverlayObjects` array holds all overlay GameObjects for easy cleanup.

## Code Style

- `'Georgia, serif'` font everywhere in Phaser text — keep consistent.
- Canvas: `768 × 1365`. Board: `BOARD_LEFT=84`, `BOARD_TOP=420`, `CELL_SIZE=116`, `CELL_GAP=6`.
- Loop counter variable: `index` (not `i`).
- Private class members use `!` non-null assertion for Phaser objects initialized in `create()`.
- `satisfies` keyword for typed literals (see `MenuScene` options array).
- Import order: Phaser → engine → cloud → random → persistence → audio → types (type imports last with `import type`).

## Build Notes

- `base: '/games/rogueSwipe/'` in `vite.config.ts` — asset paths assume this prefix in production.
- `allowImportingTsExtensions: false` — no `.ts` in import paths.
- `moduleResolution: "Bundler"` — Vite handles resolution.
