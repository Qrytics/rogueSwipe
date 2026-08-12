# RogueSwipe Improvement Plan

## Overview

Full audit and improvement pass covering: critical bug fixes, game-loop correctness (all three modes), mobile/desktop UX, performance, code correctness, save/persistence integrity, game balance, sound effects, pause menu, animated tile transitions, difficulty scaling, and improved leaderboard UX. All changes stay within the existing Phaser 3 + TypeScript + Vite stack.

---

## Sub-Task 1 — Critical Bug Fixes

**Status:** [ ] pending

**Intent:**  
Fix the bugs that break the game for real players: daily run can never be won, boss spawns on top of other tiles, daily/endless mode share a broken "bossHp: 0" config, and there is a silent `||` default that treats bossHp=0 as "not set".

**Expected Outcomes:**
- Daily run ends with Victory when progress reaches 100 (direct victory, no boss — by design for a quick daily format)
- Endless run ends only on hero death (correct by design), and the defeat overlay fires correctly
- Quest mode still triggers boss encounter at 120 progress
- `findFallbackBossPosition` returns an empty adjacent cell or the hero's cell, never a tile occupied by another entity
- `bossHp: 0` in MenuScene config for daily/endless no longer accidentally defaults to 12 inside `startBossEncounter`
- The duplicate victory check in `processTurnLifecycle` (lines 209–212 and 230–232) is collapsed into one

**Todo List:**
1. In `src/game/engine.ts`, `processTurnLifecycle`: expand the mode-based condition at line 205 to also trigger direct victory for `daily` and `endless` when `progress >= maxProgress` (for daily at 100%, for endless never since maxProgress is 9999)
2. In `src/game/engine.ts`, `processTurnLifecycle`: add a check — if `mode !== 'quest'` and `progress >= maxProgress`, set `board.status = 'victory'` directly (skip boss encounter)
3. In `src/game/engine.ts`, `startBossEncounter`: replace `board.bossMaxHp || 12` with `board.bossMaxHp > 0 ? board.bossMaxHp : 12` to correctly distinguish a zero from a missing value
4. In `src/game/engine.ts`, `findFallbackBossPosition`: invert the logic — return a cell only when it is *empty* (no occupant at all), not when it has a non-hero occupant
5. In `src/game/engine.ts`, `processTurnLifecycle`: remove the duplicate victory check at lines 230–232 (keep only the one after `spawnTurnTiles`)
6. In `src/scenes/MenuScene.ts`: set `bossHp: 12` for daily mode (daily now ends via direct victory, not via boss, but bossHp should be non-zero in case modes are reused — actually set it to 0 is fine since daily won't enter boss phase; confirm no entry point)

**Relevant Context:**
- `src/game/engine.ts:198–233` — `processTurnLifecycle`
- `src/game/engine.ts:416–434` — `startBossEncounter`
- `src/game/engine.ts:487–499` — `findFallbackBossPosition`
- `src/scenes/MenuScene.ts:111–142` — mode config objects

---

## Sub-Task 2 — Mobile UX Fixes

**Status:** [ ] pending

**Intent:**  
Make the game fully playable on mobile: fix swipe detection sensitivity, prevent landscape rotation breaking layout, add proper mobile meta tags, and ensure the canvas fills the viewport cleanly on all mobile sizes.

**Expected Outcomes:**
- Swipe threshold raised to 50px so accidental micro-swipes don't trigger moves
- Diagonal swipe resolved correctly: each axis must independently exceed 30px before the dominant axis wins
- `index.html` has `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and `viewport-fit=cover` meta tags
- CSS prevents body scroll and forces portrait-safe rendering
- No content is clipped on iPhone SE (375×667) or similar small screens — Phaser FIT mode already handles scaling but confirm

**Todo List:**
1. In `src/scenes/GameScene.ts`, `setupInput`: change `threshold` from 24 to 50
2. In `src/scenes/GameScene.ts`, `setupInput` swipe handler: add a minimum per-axis check — only resolve direction if the dominant axis delta exceeds 50px (the 24px general threshold check can be kept as minimum total movement, but use 50px for direction resolution)
3. In `index.html`: add `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, and update viewport to `width=device-width, initial-scale=1.0, viewport-fit=cover`
4. In `src/styles.css`: add `user-select: none` and `-webkit-user-select: none` to body; add `touch-action: manipulation` to the `canvas` rule; add `position: fixed; top: 0; left: 0;` to `#app` to prevent scroll bounce on iOS

**Relevant Context:**
- `src/scenes/GameScene.ts:129–154` — swipe input handler
- `index.html:5` — viewport meta
- `src/styles.css` — canvas and body rules

---

## Sub-Task 3 — Desktop UX Fixes

**Status:** [ ] pending

**Intent:**  
Polish desktop experience: add a Pause key (Escape), show a pause overlay mid-game, ensure all interactive elements show pointer cursor, and add instructional text about keyboard controls on the menu.

**Expected Outcomes:**
- Pressing Escape during a game shows a pause overlay with "Resume" and "Quit to Menu" buttons
- Pause overlay correctly blocks further input while visible
- All interactive Phaser text objects that can be clicked have `useHandCursor: true`
- MenuScene includes a small "Keyboard: Arrow keys or WASD" hint

**Todo List:**
1. In `src/scenes/GameScene.ts`: add a `private paused = false` flag and an `Escape` keydown handler that toggles pause
2. In `src/scenes/GameScene.ts`: add `showPauseOverlay()` and `hidePauseOverlay()` private methods that draw/destroy a dark semi-transparent overlay with Resume and Quit buttons; set `paused = true/false` accordingly
3. In `src/scenes/GameScene.ts`, `takeTurn` and the spell button handler: guard both with `if (this.paused || this.board.status !== 'playing') return`
4. In `src/scenes/MenuScene.ts`: add a small text hint near the bottom: `"Desktop: Arrow keys or WASD to move"`
5. Audit all `this.add.text(...)` calls in both scenes that have interactive zones; ensure every one that is itself interactive has `useHandCursor: true`

**Relevant Context:**
- `src/scenes/GameScene.ts:109–127` — keyboard handler
- `src/scenes/GameScene.ts:157–166` — takeTurn
- `src/scenes/MenuScene.ts:190–194` — footer text area

---

## Sub-Task 4 — Sound Effects

**Status:** [ ] pending

**Intent:**  
Add synthesized sound effects using the Phaser Web Audio API (no external audio files needed). Use `Phaser.Sound.WebAudioSoundManager` tone generation or the Web Audio `AudioContext` directly to produce short beeps/tones for: move, combat hit, enemy death, gold pickup, level up, spell use, boss attack, victory, and defeat.

**Expected Outcomes:**
- Each game action plays a distinct short audio cue (<300ms)
- Audio is disabled if browser blocks autoplay; sounds start working after first user interaction (swipe/key)
- A mute toggle button appears in GameScene (top-right or bottom-left corner)
- Mute preference is persisted to localStorage

**Todo List:**
1. Create `src/game/audio.ts` — export a `SoundEngine` class wrapping the Web Audio API `AudioContext` with methods: `playMove()`, `playHit()`, `playEnemyDeath()`, `playGoldPickup()`, `playLevelUp()`, `playSpell()`, `playBossAttack()`, `playVictory()`, `playDefeat()`; each method creates and plays a short oscillator tone with appropriate frequency, waveform, and envelope; include `mute()`, `unmute()`, and `isMuted(): boolean` methods; persist mute state to `localStorage` key `rogueSwipe.muted`
2. In `src/scenes/GameScene.ts`: instantiate `SoundEngine` in `create()` and call the appropriate method after each action in `takeTurn`, spell handler, level-up (can be triggered via `TurnResult`), boss attack, victory, and defeat
3. In `src/scenes/GameScene.ts`: add a mute toggle button (🔊/🔇 text label) in the top-right corner; pressing it calls `soundEngine.mute()` / `soundEngine.unmute()` and updates the label
4. Extend `TurnResult` in `src/game/types.ts` with an optional `soundCue?: string` field (or a richer enum) so the engine can signal what sound to play without the scene having to infer it from messages

**Relevant Context:**
- `src/game/types.ts:93–97` — `TurnResult` interface
- `src/scenes/GameScene.ts:157–165` — `takeTurn` where sound calls will be placed
- No external audio assets — all synthesis via Web Audio API oscillators

---

## Sub-Task 5 — Animated Tile Transitions

**Status:** [ ] pending

**Intent:**  
Add smooth visual feedback for tile actions: tiles that die flash briefly before disappearing, the hero tile slides (tweens) toward its destination, gold tiles show a brief sparkle, and the boss telegraph highlights pulse. All animations run within Phaser's tween system and complete before the next input is accepted (or run non-blocking for cosmetic effects).

**Expected Outcomes:**
- Hero movement shows a brief position tween (80ms) sliding from old cell to new cell
- Dying enemy/obstacle tiles flash white then fade out over 150ms before being removed from `board.tiles`
- Gold pickup shows a short scale-up + fade animation on the gold text label
- Level-up shows a brief glow flash on the hero tile
- Boss telegraph highlight pulses (alpha oscillation) using a Phaser timeline/tween on the `tileGraphics` object
- Input is blocked during hero move tween (80ms); cosmetic death animations do not block input

**Todo List:**
1. Introduce an `animating = false` flag in `GameScene`; set it true at the start of `takeTurn` and false in the tween `onComplete` callback
2. In `GameScene.takeTurn`: guard with `if (this.animating || this.paused || ...) return`
3. Refactor `renderBoard()` to separate tile background drawing (Graphics) from tile text into two layers so tweens can target individual tile containers
4. For hero movement: store the hero tile's previous world position; after `moveHeroOneTile` updates board state, tween the hero graphic from old world coords to new world coords in 80ms before calling `renderBoard()`
5. For enemy death: before filtering a tile out of `board.tiles`, run a 150ms alpha-fade tween on that tile's text objects, then remove on complete
6. For gold pickup: run a 100ms scale tween on the gold tile label (scale 1→1.5→0)
7. For level-up: run a brief white flash tween on the hero tile fill color
8. For boss telegraph: add a looping tween on the `tileGraphics` alpha between 0.3 and 0.7 during boss phase (reset each turn)

**Relevant Context:**
- `src/scenes/GameScene.ts:236–244` — `renderBoard()`
- `src/scenes/GameScene.ts:274–308` — `drawTile()`
- `src/scenes/GameScene.ts:157–166` — `takeTurn` — animation lock goes here
- Phaser tween API: `this.tweens.add({ targets, props, duration, onComplete })`

---

## Sub-Task 6 — Difficulty Scaling

**Status:** [ ] pending

**Intent:**  
Make the game progressively harder: XP threshold scales with level so the hero doesn't become invincible, boss stats scale with hero level, enemy spawn weights shift toward harder enemies as turns increase, and endless mode gets harder over time.

**Expected Outcomes:**
- XP required for each level = `100 + (heroLevel - 1) * 20` (e.g. level 1→2: 100 XP, level 2→3: 120 XP, etc.)
- Boss HP at spawn = `max(board.bossMaxHp, 8 + board.heroLevel * 2)` so a high-level hero still faces a challenging boss
- Goblin/spider spawn probability increases every 20 turns in all modes (via seeded RNG, not random)
- Endless mode spawns increase by 1 every 30 turns (capped at 4 per turn)
- Web tiles remain useful — webs now slow the hero by costing an extra turn action to break (add a `slowed` status to `BoardState`)

**Todo List:**
1. In `src/game/engine.ts`, `applyLevelUps`: change XP drain from flat 100 to `100 + (board.heroLevel - 1) * 20`; update the `while` loop condition accordingly
2. In `src/game/engine.ts`, `startBossEncounter`: set boss tile HP to `Math.max(board.bossMaxHp, 8 + board.heroLevel * 2)` instead of flat bossMaxHp; also set boss attack to `1 + Math.floor(board.heroLevel / 2)` in the tile created by `createTile` override (or pass stats into `createTile`)
3. In `src/game/engine.ts`, `spawnTurnTiles`: make spawn weights dynamic — compute a `difficultyTier = Math.floor(board.turn / 20)` and shift the spawn pool toward heavier enemies: tier 0 = `[goblin, goblin, spider, rock, web, gold]`, tier 1 = `[goblin, goblin, goblin, spider, spider, rock]`, tier 2+ = `[goblin, goblin, spider, spider, spider, rock]`
4. In `src/game/engine.ts`, `spawnTurnTiles` for endless mode: compute `dynamicSpawns = board.spawnsPerTurn + Math.floor(board.turn / 30)` capped at 4, use that instead of `board.spawnsPerTurn` directly
5. Add a `heroIsSlowed` boolean to `BoardState` in `src/game/types.ts`; in `moveHeroOneTile` when hero steps on or attacks a web, set `board.heroIsSlowed = true`; in `processTurnLifecycle`, if `heroIsSlowed` is true, skip the regular `spawnTurnTiles` call and just clear the flag (net effect: hero loses a spawn-cycle worth of progress)
6. Update `migrateRunSnapshot` in `persistence.ts` to default `heroIsSlowed: false`

**Relevant Context:**
- `src/game/engine.ts:532–541` — `applyLevelUps`
- `src/game/engine.ts:400–414` — `spawnTurnTiles`
- `src/game/engine.ts:416–434` — `startBossEncounter`
- `src/game/types.ts:67–91` — `BoardState`

---

## Sub-Task 7 — Performance Optimizations

**Status:** [ ] pending

**Intent:**  
Reduce per-frame allocation and GC pressure, particularly tile text object churn and the full-board Graphics redraw.

**Expected Outcomes:**
- Tile text objects are reused across renders instead of destroyed and recreated
- Graphics `clear()` + redraw still used (acceptable for 5×5 grid) but `tileTexts` pool avoids allocation each turn
- `JSON.parse(JSON.stringify(...))` clone in `cloneBoardState` replaced with a structured clone using `structuredClone()` (available in modern browsers, supported by the ES2022 target in tsconfig)
- Cloud sync `fetch` has an `AbortController` timeout of 8 seconds

**Todo List:**
1. In `src/scenes/GameScene.ts`, replace `cloneBoardState` implementation: swap `JSON.parse(JSON.stringify(boardState))` for `structuredClone(boardState)` — same result, faster and more spec-compliant
2. In `src/scenes/GameScene.ts`: pre-allocate a pool of `Phaser.GameObjects.Text` objects at `create()` time (25 for hp + 25 for labels = 50 max), reuse them in `drawTile` by index, hide unused ones each render instead of destroying
3. In `src/game/cloud.ts`, `syncMetaProgressToCloud`: wrap the `fetch` call with `AbortController` and `setTimeout(controller.abort, 8000)`; catch the `AbortError` and return `{ synced: false, message: 'Cloud sync timed out.' }`

**Relevant Context:**
- `src/scenes/GameScene.ts:29` — `tileTexts` array declaration
- `src/scenes/GameScene.ts:311–316` — `clearTileTexts`
- `src/scenes/GameScene.ts:439–441` — `cloneBoardState`
- `src/game/cloud.ts:47–84` — `syncMetaProgressToCloud`

---

## Sub-Task 8 — Save & Persistence Fixes

**Status:** [ ] pending

**Intent:**  
Harden the save layer: prevent duplicate leaderboard entries on rapid refresh, validate loaded data shapes, and add the new `BoardState` fields from Sub-Tasks 5–6 to the migration path.

**Expected Outcomes:**
- Leaderboard deduplicates within a 500ms window (prevents double-submission on page refresh during finalize)
- `loadSaveData` logs (console.warn) when it falls back to empty data due to parse error
- All new `BoardState` fields added in Sub-Task 6 (`heroIsSlowed`) have migration defaults in `migrateRunSnapshot`
- `schemaVersion` bumped to 4 after all new fields are added; old v3 key added to `LEGACY_STORAGE_KEYS`

**Todo List:**
1. In `src/game/persistence.ts`, `recordLeaderboardEntry`: before pushing the new entry, filter out any existing entry where `score === entry.score && mode === entry.mode && turns === entry.turns` (exact duplicate guard)
2. In `src/game/persistence.ts`, `loadSaveData` catch block: add `console.warn('rogueSwipe: failed to load save data, starting fresh', e)` before returning empty
3. In `src/game/persistence.ts`, `migrateRunSnapshot`: add defaults for `heroIsSlowed` (false)
4. After all Sub-Task 6 fields are confirmed, bump `CURRENT_SCHEMA_VERSION` from 3 to 4, add `'rogueSwipe.save.v3'` to `LEGACY_STORAGE_KEYS`, and update `STORAGE_KEY` to `'rogueSwipe.save.v4'`

**Relevant Context:**
- `src/game/persistence.ts:3–7` — version constants
- `src/game/persistence.ts:92–107` — `recordLeaderboardEntry`
- `src/game/persistence.ts:164–181` — `migrateRunSnapshot`

---

## Sub-Task 9 — Improved Leaderboard UX

**Status:** [ ] pending

**Intent:**  
Replace the minimal 3-line score display in MenuScene with a proper full leaderboard panel showing all 10 entries, mode badges, a victory crown for winning runs, and a clear "no scores yet" state. Also improve the end-game overlay to show the player's final score and rank.

**Expected Outcomes:**
- MenuScene shows up to 10 leaderboard entries in a scrollable-styled panel (fixed height, overflow via Phaser mask or just show top 5 with a "+N more" line)
- Each entry shows: rank, mode badge, score, turns, level, and a ✓ or ✗ for victory
- Highlight: the most recent run is highlighted (by `id` passed through scene data)
- End-game overlay in GameScene shows final score, rank in leaderboard, and a breakdown (turns × 12, gold × 25, etc.)
- "No runs submitted yet" state styled consistently

**Todo List:**
1. In `src/scenes/MenuScene.ts`: replace the `leaderboard.slice(0, 3).forEach(...)` block with a full panel rendering up to 5 entries with rank, mode badge text, score, turns, level, and victory check/cross; add "+N more" if leaderboard has >5 entries
2. In `src/scenes/GameScene.ts`, `finalizeRun`: capture the returned leaderboard and compute player rank; store rank on the instance (`private lastRunRank = 0`)
3. In `src/scenes/GameScene.ts`, `showEndState`: extend the overlay to include a score breakdown panel showing final score, rank, and per-category contributions (turns, gold, level, hp, bonuses)
4. Pass `lastRunId` through `scene.start('MenuScene', { highlightId })` and in `MenuScene.create()` highlight that entry with a different background color

**Relevant Context:**
- `src/scenes/MenuScene.ts:87–108` — current leaderboard rendering block
- `src/scenes/GameScene.ts:409–430` — `finalizeRun`
- `src/scenes/GameScene.ts:349–394` — `showEndState`
- `src/game/persistence.ts:73–107` — leaderboard load/record

---

## Sub-Task 10 — Score Balance Fix & README Update

**Status:** [ ] pending

**Intent:**  
Fix the score formula so victory is always worth more than equivalent survival time, then update README.md to document all improvements, the new audio system, pause menu, difficulty scaling, and developer commands.

**Expected Outcomes:**
- Victory bonus raised so that winning in N turns always outscores losing in N+20 turns
- Score formula: `turn * 10 + gold * 20 + heroLevel * 60 + heroHp * 15 + victoryBonus(800) + modeBonus` (mode bonus: quest 150, daily 300, endless 200)
- README updated with all new features, updated "Current state" section, and correct commands

**Todo List:**
1. In `src/scenes/GameScene.ts`, `computeRunScore`: update formula constants to the new values above
2. Update `README.md`: replace "Current state" section with comprehensive feature list including pause menu, sound effects, animations, difficulty scaling, all three modes working correctly, and leaderboard improvements
3. Update "Next steps" section to reflect what remains (if anything)

**Relevant Context:**
- `src/scenes/GameScene.ts:443–455` — `computeRunScore`
- `README.md` — full file rewrite of current state section
