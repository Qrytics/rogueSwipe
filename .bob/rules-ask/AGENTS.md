# Ask Mode Documentation Notes (Non-Obvious Only)

- `src/game/engine.ts` is the **only** file containing game rules — enemies, boss, combat, XP, gold, spell, difficulty scaling, web slowing. No separate rule files.
- `src/game/types.ts` is the single source of truth for all interfaces — start here for any data shape question.
- **All three modes now have working win conditions**: daily wins at 100% progress (direct, no boss); quest triggers the Stone-Weaver boss at 120 progress; endless only ends on hero death.
- `SoundEngine` in `src/game/audio.ts` uses pure Web Audio API oscillators — no audio files are loaded. Mute state lives in `localStorage['rogueSwipe.muted']`.
- The save format has been through 4 schema versions; v1–v3 keys are auto-migrated. Active runs from old saves are migrated with field defaults, not discarded.
- Leaderboard is local only (localStorage). Cloud Supabase sync covers meta-progress only — not runs or leaderboard.
- `heroIsSlowed` on `BoardState` is a single-turn flag: set by web tile interaction, consumed by `processTurnLifecycle` in the same call to skip that turn's enemy spawns.
- No test suite. No linter. Build with `npm run build` to typecheck.
