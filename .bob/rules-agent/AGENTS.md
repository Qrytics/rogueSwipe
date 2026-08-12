# Agent Coding Rules (Non-Obvious Only)

- **Never import Phaser in `src/game/`** — engine, persistence, random, cloud, audio must remain Phaser-free pure modules.
- **Board mutation is intentional** — engine functions mutate `BoardState` directly. `GameScene` clones via `structuredClone()` before persisting. Do not add immutability to engine functions.
- **Tile `id` is the identity key** — `hero` always has `id: 'hero'`. Enemy/obstacle ids are `kind-index` strings. Do not use position for identity.
- **RNG seeding must be namespaced**: `` `${board.seed}:subsystem:${board.turn}` `` to avoid collisions between sub-systems in the same turn.
- **Adding a `BoardState` field**: also add a default in `migrateRunSnapshot()` in `persistence.ts`, then bump `CURRENT_SCHEMA_VERSION` and move the old key to `LEGACY_STORAGE_KEYS`.
- **Web tile is handled before the `blocksMovement` combat branch** — new tile kinds that should have custom movement behavior must be added as explicit `occupant.kind === 'x'` branches before the `occupant.blocksMovement` catch-all.
- **`heroIsSlowed` is set and consumed within the same `processTurnLifecycle` call** — it skips spawning on the current turn only. This is correct and intentional.
- **`useBackpackSpell` does NOT call `processTurnLifecycle`** — spell is a free action: no turn advance, no progress, no spawns.
- **Text pool**: `GameScene` uses `acquireText()` / `releaseAllTexts()` instead of creating/destroying Text objects. Never call `this.tileTexts.push(this.add.text(...))` — that pattern was removed.
- **`SoundEngine.playFromTurnResult`** reads the message string to choose a sound. If you add new message strings in engine.ts, also add a corresponding keyword match in `audio.ts`.
- **Score formula constants**: `turns×10 + gold×20 + level×60 + hp×15 + victory(800) + modeBonus`. Victory bonus is intentionally higher than ~80 turns of survival.
- **No lint tooling** — `npm run build` (TypeScript strict) is the only gate. Run it before committing.
- Loop counter must be `index`, not `i`.
