# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RogueSwipe is a mobile-first roguelike built with TypeScript and Phaser 3. It's a swipe-controlled turn-based game with three modes (Quest, Daily, Endless), featuring deterministic RNG, cloud sync via Supabase, and synthesized Web Audio API sound.

## Commands

```bash
npm install          # install dependencies
npm run dev          # start local dev server (opens at http://localhost:5173)
npm run build        # compile TypeScript and build production bundle
npm run preview      # preview production build locally
```

There are no lint or test scripts. Validate code by running `npm run build` — TypeScript strict mode is the only enforcer.

## Architecture

The codebase maintains a strict separation between pure game logic and rendering:

```
src/
├── main.ts              — Phaser.Game bootstrap, registers MenuScene + GameScene
├── scenes/
│   ├── MenuScene.ts     — Mode selection, leaderboard, cloud sync UI
│   ├── GameScene.ts     — Board rendering, input handling, pause, end-state overlay
│   └── ui.ts            — Shared Phaser widgets: createButton, attachButtonFeedback, cascadeIn
└── game/
    ├── engine.ts        — Pure game logic (no Phaser dependency)
    ├── types.ts         — All shared TypeScript interfaces
    ├── theme.ts         — Design tokens: COLORS, INK, BUTTON, ALPHA, SPACING, TYPOGRAPHY, ANIMATION
    ├── audio.ts         — Web Audio API SoundEngine (synthesized tones, no files)
    ├── persistence.ts   — localStorage save/migrate/leaderboard
    ├── cloud.ts         — Optional Supabase meta-progress sync
    └── random.ts        — Deterministic RNG (mulberry32 + hashString)
```

**Critical rule**: `src/game/` must remain Phaser-free. All game rules and state mutations live here and are fully testable without a browser. Never import Phaser inside `src/game/`.

`theme.ts` obeys that rule because it is pure data — plain numbers and strings, plus one type-only import for the `TileKind` key check. Anything that needs a Phaser type or constructor is a *widget*, not a token, so it belongs in `src/scenes/ui.ts`.

## Key Implementation Patterns

### Deterministic RNG
All randomness uses `mulberry32(hashString(seed))`. Seed strings follow the pattern:
```typescript
`${board.seed}:subsystem-name:${board.turn}`
```

### State Mutation
- Board state is **mutated in place** by `engine.ts` functions
- `GameScene` uses `structuredClone(board)` before persisting to avoid reference bugs
- This avoids constant deep copies during gameplay while preserving immutability at persistence boundaries

### Scene Data Passing
Read the payload from the `create(data)` **argument**. Phaser routes `scene.start` data to
`init(data)`, `create(data)`, and `Scene.settings.data` — it does *not* populate the scene's
`DataManager`, so `this.data.get('runConfig')` is always `undefined`.
```typescript
this.scene.start('GameScene', { runConfig, metaProgress });  // start new run
this.scene.start('GameScene', { resumeRun });                // resume saved run

// In GameScene:
create(data: GameSceneData = {}): void {
  const { resumeRun, runConfig, metaProgress } = data;
}
```

### Save Schema Versioning
- Current version: `4` (tracked via `STORAGE_KEY = 'rogueSwipe.save.v4'`)
- When adding new `BoardState` fields, add migration defaults in `migrateRunSnapshot()`
- Never bump the version without adding the old key to `LEGACY_STORAGE_KEYS`
- Schema migrations run automatically on load

### Game Mode Mechanics
- **Quest**: Progress fills over ~17 turns → triggers boss at 120 progress
- **Daily**: Same seed for all players per day → victory when progress fills (no boss)
- **Endless**: No progress tracking → ends only on hero death → spawns increase every 30 turns (capped at 4/turn)

### Web Tiles & Snared Status
Swiping into a web **costs the hero the turn**: the web is destroyed, the hero does *not* move, and `processTurnLifecycle()` still runs so enemies spawn and the boss still advances its countdown. `board.heroIsSlowed` is display-only — it records whether the turn that just resolved was spent on a web, and `moveHeroOneTile` rewrites it on every turn the hero actually spends (a wall bump leaves it alone).

### Combat & Difficulty Scaling
Damage floors at 1 on **both** sides, so a high-block hero is never invincible. Tiles with `attack: 0` (rocks, boss-woven stone) are exempt and deal nothing.

- **Hero base**: 8 HP, 2 attack, 0 block (`HERO_BASE_HP` / `HERO_BASE_ATTACK`)
- **XP threshold**: `20 + (heroLevel - 1) × 12` — 20, 32, 44, 56, …
- **Per level**: +2 max HP, +1 attack, +5 heal, +1 spell charge; **+1 block only on even levels**. `LEVEL_UP_HEAL` is the most sensitive number in the file — ±1 swings the Quest win rate by ~10%
- **Boss**: 3 attack, 1 block, HP `max(bossMaxHp, 8 + heroLevel × 2)`
- **Spawn pools**: Shift from easy enemies to harder enemies at turns 20 and 40
- **Endless spawn ramp**: `+1 spawn per 30 turns`, capped at 4 spawns/turn

These numbers are a connected budget, tuned so a Quest run reaches ~level 3 by the boss at turn 18. Measured win rate with a greedy bot over 60 seeds: Quest 73% fresh / 93% with maxed meta bonuses, Daily 100%, Endless 0% by design. The engine has no tests — if you change one, re-verify a full Quest run ends in victory.

### Design Tokens
Neither scene hard-codes a colour, gap, font size, or tween duration. Everything comes from `src/game/theme.ts`:

| Export | Holds |
| --- | --- |
| `COLORS` | Numeric `0xrrggbb` for Phaser Graphics/Rectangle fills. `COLORS.tile` is `satisfies Record<TileKind, TileColors>`, so adding a tile kind fails the build until it has colours. |
| `INK` | CSS colour **strings** for `Text` styles — a separate export because Phaser wants two different types for the same idea. |
| `BUTTON` | Per-variant `{text, fill, fillHover}` (`success`/`danger`/`neutral`/`spell`), consumed by `createButton`. |
| `ALPHA`, `SPACING`, `TYPOGRAPHY`, `ANIMATION` | Opacities, gaps and button padding, font sizes and stroke widths, tween durations/scales/eases. |

Every object is `as const`. That means a parameter defaulting to a token infers the token's **literal** type, not `number` — `stagger = ANIMATION.stagger` becomes type `100` and rejects every other value. Annotate such parameters explicitly (`stagger: number = ANIMATION.stagger`), as `cascadeIn` does.

### Tile Rendering
Each tile is one `Phaser.GameObjects.Container` (rounded-rect `Graphics` body + name `Text` + HP `Text`), tracked in `GameScene`'s `tileViews: Map<tileId, TileView>`. `syncTiles()` diffs the map against `board.tiles`: it creates views for new ids, updates changed ones, and destroys views whose id has vanished. Destroying the Container destroys its children too, so there is no separate text cleanup.

- Deleting from `tileViews` while iterating its entries is safe, and `syncTiles` relies on it to detach a dead view before animating it.
- Phaser reuses a single Scene instance across `scene.start()`, so class field initialisers run **once**. `resetSceneState()` must re-create `tileViews` — a stale Map holds Containers destroyed with the previous run.
- This replaced a fixed pool of 50 pre-allocated `Text` objects. If you are looking for `acquireText` or `TILE_TEXT_BASE_STYLE`, they are gone, along with the `setStyle` merge hazard that came with reusing one slot for different kinds of label.

### Animation
Tweens are the reason the board reads as a game rather than a spreadsheet; the durations and eases all live in `ANIMATION`.

- **Spawn**: scale/alpha `0.5/0` → `1/1` with `Back.easeOut`. On a fresh board the whole grid cascades in at `index * ANIMATION.boardCascade`.
- **Hero move**: an 80 ms `Cubic.easeOut` position tween. Input is deliberately **not** blocked during it — a second swipe mid-slide calls `view.moveTween?.remove()` and retargets, which stays responsive instead of dropping the input.
- **Tile death**: an expanding hollow white ring (`playTileDeath`). It must be drawn **above** the hero: killing a tile advances the hero onto that same cell in the same turn (`moveHeroOneTile`), so anything drawn underneath is never seen. It gets away with being on top only because it is a stroke, not a fill — it frames the hero's arrival. Hence `DEPTH.dyingTile > DEPTH.hero`; do not "fix" that ordering back.
- **Progress bar**: `tweens.addCounter` drives `displayedProgress`, which `drawProgressBar` repaints. `create()` seeds `displayedProgress` and `displayedHeroLevel` from the loaded board so resuming a run mid-way does not replay the bar from zero or fire a phantom level-up flash.
- **Boss telegraph**: a single looping yoyo alpha tween between `ALPHA.telegraphPulseMin` and 1, started only when `bossAttackCountdown <= 1` and stopped via `stopTelegraphPulse`.

### Sound System
`SoundEngine.playFromTurnResult(result, status, hpLost)` picks tones from the turn's messages in two layers: one *primary* cue from the action the player took (`messages[0]`), then any *secondary* cue for what the board did back (boss awakening, stone weave, or damage), delayed ~120–180 ms so the two read as call-and-response instead of one muddy chord.

`hpLost` is passed by `GameScene`, which compares hero HP either side of the turn — no message reliably reports damage, since a counter-attack, a weave and a boss strike all phrase it differently. `playVictory()`/`playDefeat()` are called separately from `showEndState`. All sounds are synthesized; there are no audio files.

### Cloud Sync
- Optional Supabase sync via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables
- Uses anonymous local identity (UUID stored in localStorage)
- Upserts to `rogueswipe_profiles` table (snake_case columns)
- 8-second timeout via `AbortController`

### Pause System
- Triggered by Escape key or swipe-guard when `this.paused === true`
- All pause overlay GameObjects are stored in the `pauseOverlayObjects` array for easy cleanup
- "Quit to Menu" opens a confirmation step whose objects live in `quitConfirmObjects`. Escape backs out of that confirmation *before* it toggles pause, so the key never both cancels the dialog and resumes the run
- Overlays are layered by `DEPTH`: `endOverlay` 10 < `pauseOverlay` 20 < `confirmOverlay` 30. The confirm panel is deliberately larger than the pause panel it covers so the panel underneath does not peek out around its edges

## Code Style

- **Font**: `TYPOGRAPHY.family` (`'Georgia, serif'`) everywhere in Phaser text — never inline the string
- **Canvas**: `768 × 1365` (portrait orientation)
- **Board constants**: `BOARD_LEFT = 84`, `BOARD_TOP = 420`, `CELL_SIZE = 116`, `CELL_GAP = 6`
- **Colours, gaps, durations**: always a `theme.ts` token, never a literal
- **Loop counter**: Use `index` (not `i`)
- **Phaser objects in create()**: Use `!` non-null assertion for private class members initialized in `create()`
- **Typed literals**: Use `satisfies` keyword (see `MenuScene` options array)
- **Import order**: Phaser → engine → cloud → random → persistence → audio → theme → ui → types (type imports last with `import type`)

## Build Configuration

- **Base path**: `base: '/games/rogueSwipe/'` in `vite.config.ts` — production asset paths assume this prefix
- **TypeScript**: `allowImportingTsExtensions: false` — never use `.ts` in import paths
- **Module resolution**: `moduleResolution: "Bundler"` — Vite handles all resolution

## Deployment

The production build deploys to `/games/rogueSwipe/` via GitHub Actions. Pushing to `main` triggers a workflow (`notify-portfolio-sync.yml`) that dispatches to the portfolio repository for deployment.
