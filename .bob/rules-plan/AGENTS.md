# Plan Mode Architecture Notes (Non-Obvious Only)

- **Two-layer architecture**: `src/game/` is pure logic (no Phaser), `src/scenes/` is rendering/input. New features follow this split — logic in `engine.ts`, rendering in `GameScene.ts`.
- **`BoardState` is the entire run state** — serialised to localStorage every turn. Any new run state must live on `BoardState`. Scene class fields are lost on resume.
- **`RunConfig` is stored in `RunSnapshot`** — changes to `RunConfig` fields must propagate through the snapshot persistence path.
- **Three distinct win conditions by mode**: quest → boss phase → defeat boss; daily → direct victory when progress fills; endless → no victory, ends on hero death only.
- **Boss phase is a state transition on the same board** — `board.phase` switches `'run'` → `'boss'`; boss tile is added to `board.tiles`. No new scene.
- **Difficulty is seeded and deterministic** — spawn pool shifts at turns 20/40 (`difficultyTier`), endless spawn count at turns 30/60/90. Any difficulty change must preserve this determinism (use `board.seed` + `board.turn`).
- **Permanent meta-progression bonuses** (`permanentMaxHpBonus`, `permanentAttackBonus`) apply only at board creation. They do not dynamically affect an in-progress run.
- **Text pool (50 objects)** is pre-allocated in `GameScene.create()`. Pool size = `BOARD_SIZE² × 2 = 50`. If board size grows or tiles need more labels, `TILE_TEXT_POOL_SIZE` must increase.
- **Canvas is fixed 768 × 1365** — all UI uses hardcoded pixel coordinates. New UI elements need manually computed positions. There is no layout engine.
- **Leaderboard is local-only** — stored in `localStorage['rogueSwipe.leaderboard.v1']`, capped at 10. A cloud leaderboard would require a new Supabase table and new functions.
- **`SoundEngine` lazily creates `AudioContext`** on first non-muted play to comply with browser autoplay policies. Never instantiate `AudioContext` at module load time.
