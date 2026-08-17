# RogueSwipe Complete Bug Fix & Visual Polish Plan

## Context

RogueSwipe is functionally complete but has critical bugs affecting gameplay and visual issues that make it look unpolished ("AI slop"). The codebase has:

- **25 identified bugs** ranging from game-breaking (progress loss, gold not dropping) to balance issues (damage calculations, spawn overflow)
- **80+ hard-coded color values** scattered across scenes with no design system
- **No animation system** - all transitions are instant, making the game feel unresponsive
- **Heavy text strokes** (8px) giving a dated, amateurish appearance
- **Missing sound cues and visual feedback** for critical game events

The goal is to make RogueSwipe both functionally correct and visually polished - a professional game that feels responsive and cohesive, not generated slop.

---

## Phase 1: Critical Bug Fixes

Fix game-breaking bugs before adding polish. These prevent the game from working correctly.

### 1.1 Quit from Pause Loses Progress ⚠️ BLOCKER
**File:** `src/scenes/GameScene.ts:279-281`

**Problem:** Clicking "Quit to Menu" in pause overlay doesn't call `persistRun()`, losing active run state.

**Fix:** In quit button handler, call `this.persistRun()` before `this.scene.start('MenuScene')`. Only persist if `this.board.status === 'playing'`.

### 1.2 Leaderboard Doesn't Refresh ⚠️ BLOCKER
**File:** `src/scenes/MenuScene.ts:15-18`

**Problem:** `loadLeaderboard()` only runs in `create()`, so completed runs don't appear until page refresh.

**Fix:** MenuScene is recreated on `scene.start()`, so this should work. Verify scene is properly restarted in GameScene.ts:591. If not, add explicit scene restart or move leaderboard load to resume lifecycle.

### 1.3 Gold Doesn't Drop from Enemies ⚠️ CRITICAL
**File:** `src/game/engine.ts:413`

**Problem:** `goldForTarget()` only returns gold for `kind === 'gold'` tiles. Enemies return 0 even though line 137 calls it expecting gold drops.

**Fix:** Update `goldForTarget()`:
```typescript
case 'goblin': return 2;
case 'spider': return 3;
case 'boss': return 10;
```

### 1.4 Daily Seed Stale
**File:** `src/scenes/MenuScene.ts:140`

**Problem:** `seed: dailySeed()` computed at menu creation, not button click. If menu opens before midnight and clicks after, uses wrong seed.

**Fix:** Compute seed in button click handler, not in options array initialization.

### 1.5 Boss Death + Hero Death Race Condition
**File:** `src/game/engine.ts:246-248`

**Problem:** Both victory and defeat can fire same turn if boss attack kills hero while hero kills boss.

**Fix:** Add `if (board.status !== 'playing') return` guard at start of `processTurnLifecycle` and before setting victory at line 247. Check status before setting defeat in `bossWeaveAttack:488`.

### 1.6 Web Tile `blocksMovement` Ignored
**File:** `src/game/engine.ts:310, 116-124`

**Problem:** Web tiles set `blocksMovement: true` but are handled specially, allowing passage. Property has no effect.

**Fix:** Set `blocksMovement: false` for clarity - webs intentionally don't block, they slow.

### 1.7 Boss HP Duplication Risk
**File:** `src/game/engine.ts:131, 144, 182`

**Problem:** Boss HP tracked in both `board.bossHp` and boss tile's `hp`, requiring manual sync. Risk of desync.

**Fix:** Keep both for UI reasons, but ensure sync immediately after ANY change. Add comment documenting the requirement.

### 1.8 XP Multiple Level-Ups Spell Charge
**File:** `src/game/engine.ts:574`

**Problem:** Code looks correct (charge added inside while loop), but verify multiple level-ups grant multiple charges, not just one per `applyLevelUps()` call.

**Fix:** Test and verify behavior is correct.

### 1.9 Endless Spawn Overflow
**File:** `src/game/engine.ts:429-431`

**Problem:** Endless mode spawns 4 enemies/turn after turn 90. With 5×5 board, can fill quickly.

**Fix:** Already handles with `if (!position) return` at line 437. Consider adding early break if pickEmptyCell fails 3+ times consecutively.

### 1.10 Combat Damage Floor Asymmetry
**File:** `src/game/engine.ts:381, 383`

**Problem:** Hero always deals ≥1 damage (`Math.max(1, ...)`), enemies can deal 0. Intentional player advantage, but makes high-block hero invincible.

**Fix:** Document as intentional design choice. Optionally make configurable per difficulty.

### 1.11 Cloud Sync Button Hangs
**File:** `src/scenes/MenuScene.ts:63-71`

**Problem:** No timeout on `syncMetaProgressToCloud()`. If it hangs, button stays disabled forever.

**Fix:** Wrap with `Promise.race` and 8-second timeout. Show "Sync timed out" and re-enable button on timeout.

### 1.12 Leaderboard Duplicate Too Strict
**File:** `src/game/persistence.ts:97-99`

**Problem:** Rejects entries with same score+mode+turns, even if legitimate separate runs.

**Fix:** Add timestamp check - only dedupe if `existing.createdAt` within 1 second of new entry (prevents double-submit on refresh, allows actual duplicates).

### 1.13 Level-Up Sound Never Plays
**File:** `src/game/audio.ts:134`, `src/game/engine.ts`

**Problem:** `playFromTurnResult` checks for "Level up" in message, but `applyLevelUps` doesn't add this message.

**Fix:** In `applyLevelUps`, add "Level up!" to messages array when level increases, OR add `leveledUp: boolean` flag to TurnResult.

---

## Phase 2: Visual Design System

Eliminate hard-coded colors and create cohesive theme. This is the most visible "AI slop" indicator.

### 2.1 Create Theme Constants
**New File:** `src/game/theme.ts`

**Purpose:** Centralize all colors, spacing, typography constants.

**Structure:**
```typescript
export const COLORS = {
  background: { primary: 0x08131c, overlay: 0x000000, panel: 0xd7def0 },
  text: { primary: '#f2f6ff', secondary: '#b4c4d9', tertiary: '#8aa0b9', ... },
  tile: {
    hero: { fill: 0xb6d6ff, stroke: 0xffffff, icon: 0x1f4d8d },
    goblin: { fill: 0xb55f5f, stroke: 0xffb3b3, icon: 0x4d0f0f },
    // ... all tile colors
  },
  progress: { border: 0x4f667d, fillRun: 0x7ec8ff, fillBoss: 0xff8080 },
  button: { success: {}, danger: {}, neutral: {}, spell: {} },
  mode: { quest: '#8aa0b9', daily: '#9fe7b4', endless: '#e7c79f' }
};

export const SPACING = {
  xs: 8, sm: 12, md: 18, lg: 24, xl: 32,
  button: { sm: {x: 16, y: 8}, md: {x: 18, y: 12}, lg: {x: 28, y: 14} }
};

export const TYPOGRAPHY = {
  size: { xs: '14px', sm: '16px', base: '18px', ... huge: '56px' },
  stroke: { none: 0, light: 2, normal: 4, bold: 6 },
  family: 'Georgia, serif'
};

export const ANIMATION = {
  fast: 80, normal: 150, slow: 300,
  easeOut: 'Cubic.easeOut', ...
};
```

### 2.2 Replace Hard-Coded Colors in GameScene.ts
**File:** `src/scenes/GameScene.ts`

**Changes:**
- Import theme: `import { COLORS, SPACING, TYPOGRAPHY, ANIMATION } from '../game/theme';`
- Replace 40+ hard-coded colors at lines: 81, 87-89, 95, 103, 110, 129, 141, 250-251, 256, 262-263, 270-271, 300-301, 331, 399, 401, 403, 428, 444, 454, 460, 465, 474, 482, 487-503, 538-539, 544, 550, 569, 578, 585-586
- Replace `strokeThickness: 8` with `TYPOGRAPHY.stroke.bold` (value 4-5 for modern look)
- Use `SPACING` constants instead of magic numbers (18, 22, 28, 14, etc.)

### 2.3 Replace Hard-Coded Colors in MenuScene.ts
**File:** `src/scenes/MenuScene.ts`

**Changes:**
- Import theme
- Replace 40+ hard-coded colors at lines: 21, 26-27, 34, 42, 50, 58-59, 77-78, 90-92, 99, 112, 120, 162, 166, 171, 178, 190-199, 207, 213
- Reduce title stroke from 8px to 4px (line 29)
- Use `SPACING` constants for padding and positioning
- Use `TYPOGRAPHY.size` for font sizes

### 2.4 Update Typography - Reduce Heavy Strokes
**Goal:** Modern, clean look instead of dated heavy outlines

**Changes:**
- Title text: 4px stroke (not 8px)
- Heading text: 3px stroke or none
- Body text: no stroke
- Use subtle shadows if depth needed

---

## Phase 3: Animation & Polish ("Juice")

Add responsive animations and visual feedback. Makes game feel professional and responsive.

### 3.1 Refactor Tile Rendering to Support Animation
**File:** `src/scenes/GameScene.ts`

**Problem:** Tiles drawn with Graphics primitives, can't animate individual tiles.

**Solution:**
- Create `tileContainers: Map<string, Phaser.GameObjects.Container>` to store Container per tile
- Each Container has Graphics for background + Text for icon
- Allows tweening individual tile alpha, scale, position
- Render loop updates existing containers or creates new ones

### 3.2 Tile Spawn Animation
**Implementation:** New tiles start at alpha 0, scale 0.5, tween to alpha 1, scale 1 over 150ms with 'Back.easeOut' easing.

### 3.3 Tile Death Animation
**Implementation:** Flash white (tint 0xffffff) for 50ms, then fade alpha to 0 over 150ms. Remove after animation completes.

### 3.4 Hero Movement Animation
**Implementation:** 
- Store previous hero position before move
- Tween container from old coords to new over 80ms
- Block input during animation: `if (this.animatingHero) return;`
- Use 'Cubic.easeOut' easing

### 3.5 Button Press Animation
**Files:** `src/scenes/GameScene.ts`, `src/scenes/MenuScene.ts`

**Implementation:** On all buttons, scale to 0.95 on pointerdown, yoyo back over 50ms. Add hover state with lighter background.

### 3.6 Progress Bar Animation
**File:** `src/scenes/GameScene.ts`

**Implementation:** Store `prevProgress`, tween from old to new value over 200ms using `tweens.addCounter`.

### 3.7 Boss Attack Telegraph Pulse
**File:** `src/scenes/GameScene.ts:429`

**Implementation:** When countdown ≤ 1, add looping tween on telegraph alpha between 0.5 and 1.0 every 300ms. Makes danger obvious.

### 3.8 End State Fade-In
**File:** `src/scenes/GameScene.ts`

**Implementation:** Start overlay/panel at alpha 0, tween to 1 over 300ms. Cascade text: title → description → score with 100ms stagger.

### 3.9 Level-Up Flash
**File:** `src/scenes/GameScene.ts`

**Implementation:** When level increases, tween hero scale 1 → 1.15 → 1 over 200ms. Play sound.

---

## Phase 4: Sound & Feedback

Complete sound system - adds missing audio cues for game events.

### 4.1 Add Missing Sound Methods
**File:** `src/game/audio.ts`

**New methods:**
- `playWallBump()` - frequency 120, square wave, 80ms
- `playWeb()` - frequency 180, triangle, 150ms  
- `playBossSpawn()` - deep rumble, frequency 80 sawtooth, 600ms
- `playPause()` - frequency 440, sine, 100ms
- `playDamageTaken()` - frequency 240, sawtooth, 150ms

### 4.2 Hook Up Sound Events
**File:** `src/scenes/GameScene.ts`

**Changes:**
- Wall bump: In `takeTurn`, check if `!result.acted && !result.moved`, play `playWallBump()`
- Web: Check messages for "web", play `playWeb()`
- Boss spawn: Add message "A boss appears!" when phase changes, play `playBossSpawn()`
- Pause: In `togglePause`, play `playPause()`
- Damage taken: Compare hero HP before/after turn, play `playDamageTaken()` if decreased

### 4.3 Fix Level-Up Sound
**File:** `src/game/engine.ts`

**Change:** In `applyLevelUps`, add "Level up!" message to TurnResult.messages when level increases.

---

## Phase 5: UX Improvements

Fix remaining UX issues and polish quality-of-life features.

### 5.1 Remove ASCII Art Score Display
**File:** `src/scenes/GameScene.ts:556-572`

**Change:** Replace ASCII dividers with clean, aligned score breakdown using proper spacing.

### 5.2 Fix Mute Button Emoji
**File:** `src/scenes/GameScene.ts:326-332`

**Change:** Replace emoji 🔊/🔇 with text labels "Sound On"/"Sound Off" or draw speaker icon with Graphics. Emoji rendering varies by platform.

### 5.3 Improve Spacing Consistency
**Files:** `src/scenes/GameScene.ts`, `src/scenes/MenuScene.ts`

**Change:** Replace all magic spacing numbers (18, 22, 28, 14, etc.) with `SPACING` constants from theme.

### 5.4 Optimize Text Pool
**File:** `src/scenes/GameScene.ts:15`

**Change:** Reduce `TILE_TEXT_POOL_SIZE` from 50 to 30. Add warning if pool exhausts.

### 5.5 Improve Boss Telegraph Visibility
**File:** `src/scenes/GameScene.ts:429`

**Change:** Increase alpha from 0.45 to 0.7-0.8. Use pulse animation (Phase 3.7) to draw attention.

### 5.6 Add Quit Confirmation
**File:** `src/scenes/GameScene.ts`

**Change:** When clicking "Quit to Menu" in pause, show confirmation: "Save and quit? Your progress will be saved." Buttons: "Save & Quit" / "Cancel". Prevents accidental quits.

---

## Implementation Order

1. **Phase 1** (Bug fixes) - MUST be first, broken game can't be polished
2. **Phase 2** (Theme system) - Create theme.ts, then update scenes
3. **Phase 3** (Animations) - Tile refactor (3.1) first unlocks all other animations
4. **Phase 4** (Sound) - Add methods (4.1) first, then hook up events
5. **Phase 5** (UX) - Independent changes, can be done in any order

**Critical Path:** Phase 1 → Phase 2 → Phase 3.1 → rest can be parallelized

---

## Verification

### After Phase 1:
- Quit from pause → resume → run continues from correct state ✓
- Complete run → return to menu → leaderboard shows new entry ✓
- Kill enemies → verify gold awarded (goblin: 2, spider: 3) ✓
- Start daily run at different times → seed changes correctly ✓
- Boss fight simultaneous death → only one status set ✓
- Cloud sync → wait 10s → timeout handled ✓
- Two identical-score runs → both appear on leaderboard ✓

### After Phase 2:
- Visual inspection: all colors use theme constants ✓
- Search for remaining hard-coded values: `0x[0-9a-f]{6}`, `#[0-9a-f]{6}` ✓
- Typography consistent across all elements ✓
- No magic spacing numbers remain ✓

### After Phase 3:
- Run `npm run dev` and test game flow:
  - Tiles spawn with fade animation ✓
  - Tiles die with flash + fade ✓
  - Hero moves smoothly between cells ✓
  - Buttons scale on press ✓
  - Progress bar animates ✓
  - Boss telegraph pulses when danger imminent ✓
  - End state fades in ✓
  - Level-up shows flash ✓
- Verify input blocking feels responsive, not laggy ✓

### After Phase 4:
- All game actions produce appropriate sounds ✓
- Mute button works and persists ✓
- Level-up sound plays correctly ✓
- No sound overlap/clipping ✓

### After Phase 5:
- Score display readable and aligned ✓
- Mute button renders consistently ✓
- Boss telegraph clearly visible ✓
- Quit confirmation works ✓
- Test pool doesn't exhaust in long game ✓

### Final Integration Test:
- Play complete run in each mode (Quest, Daily, Endless)
- Verify save/load works
- Test on mobile viewport (responsive layout)
- Verify cloud sync (if configured)
- Check leaderboard with 10+ entries
- Verify boss fight mechanics
- Test pause/resume/quit flow

---

## Critical Files

- `src/game/engine.ts` - Core game logic, bug fixes
- `src/scenes/GameScene.ts` - Main gameplay scene, visual polish
- `src/scenes/MenuScene.ts` - Menu and leaderboard, visual polish
- `src/game/audio.ts` - Sound system additions
- `src/game/persistence.ts` - Save/load and leaderboard fixes
- `src/game/theme.ts` - NEW FILE - design system constants

---

## Outcome & Deviations

All five phases are implemented. Two items were not built as written, and one extra file was needed.

**Extra file: `src/scenes/ui.ts`.** The plan put everything in `theme.ts`, but shared *widgets* (`createButton`, `attachButtonFeedback`, `cascadeIn`) need Phaser, and `src/game/` must stay Phaser-free. Tokens live in `game/theme.ts`; widgets live in `scenes/ui.ts`.

**3.4 — input is not blocked during hero movement.** The plan called for `if (this.animatingHero) return;`. That fails the plan's own acceptance criterion, "verify input blocking feels responsive, not laggy": an 80 ms deaf window silently eats fast swipes. Instead a new swipe removes the in-flight move tween and retargets it, so every input registers and the hero keeps up. No dropped turns, no lag.

**3.3 — the death effect is an expanding ring above the hero, not a flash beneath it.** Built as specified (white fill, fade in place) it was *invisible in every case*, which cost the most time here to catch. `moveHeroOneTile` advances the hero onto any tile it kills in the same turn, and the hero draws above dying tiles, so the flash spent its whole 200 ms life hidden under the arriving hero. It is now a hollow stroked ring at `DEPTH.dyingTile > DEPTH.hero` that swells past the cell: always visible, and because the middle is hollow it frames the hero's arrival instead of covering it. Do not "correct" that depth ordering back.

**5.4 — moot.** The text pool it optimizes was deleted by 3.1; tiles are per-tile Containers now, so there is no pool to size or exhaust.

### Verified live in the browser

- **Quest** played to the boss and won — turn 22, score 2025 (220+480+240+135+150+800), rank #3. Defeat path also checked (score 4030).
- **Daily** won at turn 13 via progress fill with no boss — score 1655 (130+140+120+165+300+800).
- **Endless** survived to turn 64 / level 10 before dying, score 3960 — the spawn ramp works and the mode still ends only on death.
- Save/resume across all three modes; pause, quit-confirm, and Escape backing out of the confirm without resuming.
- Mute toggles both ways and persists to `rogueSwipe.muted`.
- Every animation confirmed on screen, including the death ring (caught by freezing `requestAnimationFrame` mid-tween).
- `npm run build` clean; no console errors from any new code.
