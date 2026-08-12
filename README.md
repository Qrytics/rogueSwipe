# rogueSwipe

RogueSwipe is a mobile-first roguelike built with TypeScript and Phaser 3. Swipe or use keyboard to move your hero one tile at a time, fight enemies, collect gold, level up, and reach the end of the run.

## Features

### Game Modes
- **Quest Mode** — fill the progress track over ~17 turns, then face the Stone-Weaver boss. Boss HP scales with your hero's level.
- **Daily Run** — every player shares the same seed for the day. Fill the track to win. Come back tomorrow for a new challenge.
- **Endless Arena** — survive as long as you can. Spawns increase every 30 turns (capped at 4/turn). Ends only on hero death.

### Gameplay Systems
- 5×5 grid board; hero moves one tile per action
- **Combat** — strike adjacent enemies; damage = attacker.attack − defender.block (minimum 1)
- **XP & Levelling** — defeat enemies to earn XP. Each level up raises the XP threshold by 20 (100, 120, 140, …), so progression slows as you grow stronger
- **Backpack Fireball** — fires along the four cardinal directions to the nearest enemy; one-shots regular enemies, deals 3 to the boss. Charges refill on level-up (max 3)
- **Webs** — stepping into a web destroys it but *slows* the hero: enemy spawns are skipped for that turn
- **Boss phase** (Quest) — the Stone-Weaver telegraphs row/column attacks with a countdown. Move out of the marked line before it fires
- **Difficulty scaling** — spawn pool shifts from easy enemies to harder enemies at turns 20 and 40

### UI & UX
- Portrait canvas (768×1365), scales to fit any screen via Phaser FIT mode
- Swipe detection with per-axis minimum (50 px on dominant axis) to eliminate accidental input
- Keyboard: Arrow keys or WASD to move; **Escape to pause**
- **Pause menu** — Resume or Quit to Menu
- **Mute button** (🔊/🔇) — persists across sessions
- Progress bar turns red during the boss phase

### Sound
Synthesised via the Web Audio API — no external audio files. Distinct tones for: movement, combat hit, enemy death, gold pickup, level up, fireball, boss attack, victory, and defeat. Mute preference stored in localStorage.

### Leaderboard & Score
- Local top-10 leaderboard persisted in localStorage
- Score formula: `turns × 10 + gold × 20 + level × 60 + HP × 15 + victoryBonus(800) + modeBonus`  
  Mode bonus: Daily 300, Quest 150, Endless 200  
  Victory bonus (800) always outweighs equivalent survival time
- End-game overlay shows a full score breakdown and your leaderboard rank
- Leaderboard shows up to 5 entries with mode badge `[Q]/[D]/[∞]`, score, level, turns, and a ✓/✗ victory mark
- Duplicate-submission guard prevents double entries on page refresh

### Persistence
- Save data versioned with schema migrations (current: v4); legacy keys v1–v3 are upgraded forward automatically
- Active run is saved every turn and restored on resume
- Permanent meta-progression (banked gold, HP/attack bonuses) survives across runs

### Cloud Sync (optional)
Set environment variables to sync meta-progress to Supabase:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Uses an anonymous local identity (UUID) and upserts into `rogueswipe_profiles`. Cloud sync has an 8-second timeout.

---

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production build is deployed at `/games/rogueSwipe/` (configured via `vite.config.ts`).

---

## Architecture

```
src/
├── main.ts              — Phaser.Game bootstrap
├── scenes/
│   ├── MenuScene.ts     — Mode selection, leaderboard, cloud sync UI
│   └── GameScene.ts     — Board rendering, input, pause, end-state overlay
└── game/
    ├── engine.ts        — Pure game logic (no Phaser dependency)
    ├── types.ts         — All shared TypeScript interfaces
    ├── audio.ts         — Web Audio API SoundEngine
    ├── persistence.ts   — localStorage save/migrate/leaderboard
    ├── cloud.ts         — Supabase meta-progress sync
    └── random.ts        — Deterministic RNG (mulberry32 + hashString)
```

`src/game/` is intentionally Phaser-free — all game rules live there and are fully testable in isolation.
