# rogueSwipe

RogueSwipe is a mobile-first roguelike prototype built with TypeScript and Phaser 3.

## Current state

The first playable slice is in place:

- 5x5 grid board
- swipe and keyboard input
- deterministic daily seed generation
- basic combat, gold collection, and turn-based spawning
- progress bar, HP, XP, and gold HUD
- victory and defeat overlays

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Optional cloud sync

Set these environment variables to enable browser-to-Supabase meta progression sync:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The game uses an anonymous local cloud identity and upserts into a `rogueswipe_profiles` table.

## Save migration

Player progress is stored in a versioned local save and migrated forward on load, so game updates should not wipe banked gold, unlocks, or an active run.

## Next steps

- add the menu and mode selection flow
- expand the board engine into full enemy, obstacle, and spell systems
- wire persistence and leaderboard submission with Supabase
