import { hashString, mulberry32 } from './random';
import type {
  BoardState,
  Direction,
  GameMode,
  SpellResult,
  StrikeQuality,
  SwipePeek,
  Tile,
  TileKind,
  TurnResult
} from './types';

export const BOARD_SIZE = 5;
/** Raw damage of a boss weave sweep, before the hero's block is subtracted. */
const BOSS_WEAVE_DAMAGE = 3;
/** Turns between boss weave sweeps on layer 1. Deeper layers shorten it. */
const BOSS_ATTACK_INTERVAL = 4;
/** Fallback boss HP when a run config supplies none. */
const DEFAULT_BOSS_HP = 12;

// Combat and progression budget for a Quest run, which fills its progress track in ~18 turns.
// A level-1 hero trades 2 HP for a goblin (12 XP) and 4 HP for a spider (15 XP), and only ~3-4
// kills are actually reachable in those 18 turns — which is why the XP thresholds are as low as
// they are. The target is arriving at the Stone-Weaver around level 3, a bit over half HP, with
// two fireball charges banked. These values are one connected budget: changing any of them
// invalidates the boss matchup documented in startBossEncounter.
const HERO_BASE_HP = 8;
const HERO_BASE_ATTACK = 2;
/** Max HP gained per level. */
const LEVEL_UP_MAX_HP = 2;
/**
 * HP restored per level. The single most sensitive number here — it sets how much HP the hero has
 * left when the boss appears, and moving it by 1 swings the win rate by roughly 10%.
 */
const LEVEL_UP_HEAL = 5;

const DEFAULT_PROGRESS_PER_TURN: Record<GameMode, number> = {
  quest: 8,
  daily: 8,
  endless: 0
};

const DEFAULT_SPAWNS_PER_TURN: Record<GameMode, number> = {
  quest: 1,
  daily: 1,
  // Was 2, which on a 25-cell board put the player under a solid wall of enemies inside ten turns.
  // The mode is meant to escalate, not to open at its ceiling. Note MenuScene supplies its own
  // `spawnsPerTurn` per mode and that value wins, so this default and that config must agree.
  endless: 1
};

/** How many layers a Quest run must clear. Other modes run a single layer. */
export const QUEST_LAYERS = 5;
/**
 * Layer names, in descent order. These are game content rather than styling, so they live here and
 * not in `theme.ts` — the engine needs them for the descent message. `LAYER_THEMES` supplies the
 * matching palette for each index.
 */
export const LAYER_NAMES = [
  'Mosswood Cellars',
  'Amber Catacombs',
  'Cobalt Cistern',
  'Ashen Forge',
  "The Weaver's Heart"
] as const;

/** Fraction of max HP restored on descending to a new layer. */
const LAYER_HEAL_FRACTION = 0.4;
/** Enemies and props seeded onto a freshly entered layer. Matches the opening board. */
const LAYER_START_TILES = 7;
/** Each layer multiplies boss HP by this much on top of the level scaling. */
const BOSS_HP_LAYER_GROWTH = 0.3;

/**
 * Hard ceiling on how full the board may get before spawning stops for the turn — 14 of 25 cells.
 *
 * This, not the per-turn spawn rate, is what actually keeps a board playable. Any turn-based cap
 * still compounds: spawn 1 per turn and kill 0.6 per turn and the board fills anyway, just slower.
 * Capping *occupancy* means the pressure self-regulates — fall behind and spawning pauses until you
 * cut your way back out.
 */
const SPAWN_OCCUPANCY_CEILING = 0.56;
/** Endless gains one extra spawn per this many turns... */
const ENDLESS_SPAWN_RAMP_TURNS = 25;
/** ...up to this many per turn. */
const ENDLESS_SPAWN_CAP = 3;

export function createInitialBoard(seed: string, mode: GameMode = 'daily'): BoardState {
  return createInitialBoardWithBonuses(seed, mode, 0, 0);
}

export function createInitialBoardWithBonuses(seed: string, mode: GameMode = 'daily', maxHpBonus = 0, attackBonus = 0): BoardState {
  const random = mulberry32(hashString(seed));
  const tiles: Tile[] = [];

  const hero: Tile = {
    id: 'hero',
    kind: 'hero',
    x: 2,
    y: 2,
    hp: HERO_BASE_HP + maxHpBonus,
    attack: HERO_BASE_ATTACK + attackBonus,
    block: 0,
    blocksMovement: false,
    immovable: false
  };

  tiles.push(hero);

  const spawnKinds: TileKind[] = ['goblin', 'spider', 'rock', 'web', 'gold'];
  let nextTileId = 0;

  for (let index = 0; index < LAYER_START_TILES; index += 1) {
    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    const position = pickSpawnCell(tiles, random);

    if (!position) {
      break;
    }

    tiles.push(createTile(kind, position.x, position.y, nextTileId));
    nextTileId += 1;
  }

  return {
    size: BOARD_SIZE,
    mode,
    phase: 'run',
    turn: 0,
    bossTurnsElapsed: 0,
    bossAttackCountdown: 0,
    bossAttackAxis: 'row',
    bossAttackLine: 0,
    progress: 0,
    maxProgress: 100,
    progressPerTurn: DEFAULT_PROGRESS_PER_TURN[mode],
    spawnsPerTurn: DEFAULT_SPAWNS_PER_TURN[mode],
    bossHp: 0,
    bossMaxHp: 0,
    // The caller overwrites these from its RunConfig; a bare board is a single bossless layer.
    bossBaseHp: 0,
    layer: 1,
    maxLayers: 1,
    nextTileId,
    xp: 0,
    heroLevel: 1,
    heroMaxHp: hero.hp,
    spellCharges: 1,
    spellMaxCharges: 3,
    gold: 0,
    status: 'playing',
    seed,
    tiles,
    heroIsSlowed: false
  };
}

/**
 * Reports what a swipe would run into, **without mutating anything**.
 *
 * This exists so the scene can open the strike minigame before the turn is committed.
 * `moveHeroOneTile` resolves an entire turn synchronously — combat, loot, XP, spawns, boss countdown —
 * so it cannot be suspended half-way through to wait for a tap. Peeking first and passing the result
 * back in as `quality` keeps the turn atomic and keeps this file free of any UI concern.
 */
export function peekSwipe(board: BoardState, direction: Direction): SwipePeek {
  if (board.status !== 'playing') {
    return { triggersDuel: false };
  }

  const hero = board.tiles.find((tile) => tile.kind === 'hero');

  if (!hero) {
    return { triggersDuel: false };
  }

  const next = offset(hero.x, hero.y, direction);

  if (!inBounds(next.x, next.y)) {
    return { triggersDuel: false };
  }

  const occupant = board.tiles.find((tile) => tile.id !== hero.id && tile.x === next.x && tile.y === next.y);

  if (!occupant) {
    return { triggersDuel: false };
  }

  // Only things that fight back are worth a timed strike. Rocks and boss-woven stone have no attack,
  // which is the same property that exempts them from the damage floor in resolveCombat — they are
  // scenery, and making the player pass a timing check to shove a boulder would be busywork.
  return {
    kind: occupant.kind,
    triggersDuel: occupant.blocksMovement && occupant.attack > 0
  };
}

export function moveHeroOneTile(
  board: BoardState,
  direction: Direction,
  quality: StrikeQuality = 'good'
): TurnResult {
  if (board.status !== 'playing') {
    return { acted: false, moved: false, messages: [] };
  }

  const hero = board.tiles.find((tile) => tile.kind === 'hero');

  if (!hero) {
    return { acted: false, moved: false, messages: ['No hero found.'] };
  }

  const next = offset(hero.x, hero.y, direction);

  if (!inBounds(next.x, next.y)) {
    return { acted: false, moved: false, messages: ['A wall blocks the path.'] };
  }

  const occupant = board.tiles.find((tile) => tile.id !== hero.id && tile.x === next.x && tile.y === next.y);
  const messages: string[] = [];
  let acted = false;
  let moved = false;
  let snared = false;
  let leveledUp = false;
  let damageDealt: number | undefined;
  let strikeQuality: StrikeQuality | undefined;

  if (!occupant) {
    hero.x = next.x;
    hero.y = next.y;
    acted = true;
    moved = true;
  } else if (occupant.kind === 'gold') {
    board.gold += occupant.value ?? 1;
    board.tiles = board.tiles.filter((tile) => tile.id !== occupant.id);
    hero.x = next.x;
    hero.y = next.y;
    acted = true;
    moved = true;
    messages.push(`You picked up ${occupant.value ?? 1} gold.`);
  } else if (occupant.kind === 'web') {
    // A web costs the hero the whole turn: the strands tear apart but the hero stays put while
    // the rest of the board still spawns and acts. That makes the tile a genuine hazard rather
    // than the free spawn-skip it used to be.
    board.tiles = board.tiles.filter((tile) => tile.id !== occupant.id);
    acted = true;
    snared = true;
    messages.push('A web snares you. You tear free but lose your step.');
  } else if (occupant.kind === 'door') {
    // Descending is a scene change, not a turn: the lifecycle deliberately does not run, so no wave
    // spawns onto the fresh layer and the turn counter does not tick for a step spent in a doorway.
    advanceLayer(board, hero, messages);

    return { acted: true, moved: true, messages, descended: true };
  } else if (occupant.blocksMovement && occupant.kind !== 'hero') {
    const combatOutcome = resolveCombat(hero, occupant, quality);
    acted = true;
    strikeQuality = quality;
    damageDealt = combatOutcome.damageDealt;
    messages.push(combatOutcome.message);

    // board.bossHp mirrors the boss tile's hp for the UI — resync after EVERY change to the tile
    if (occupant.kind === 'boss') {
      board.bossHp = Math.max(0, occupant.hp);
    }

    if (combatOutcome.targetDied) {
      board.tiles = board.tiles.filter((tile) => tile.id !== occupant.id);
      board.xp += xpForTarget(occupant.kind);
      board.gold += goldForTarget(occupant.kind);

      if (goldForTarget(occupant.kind) > 0) {
        messages.push(`Looted ${goldForTarget(occupant.kind)} gold.`);
      }

      if (applyLevelUps(board, hero)) {
        leveledUp = true;
        messages.push('Level up!');
      }

      hero.x = next.x;
      hero.y = next.y;
      moved = true;

      if (occupant.kind === 'boss') {
        board.bossHp = 0;
      }
    }

    // The hero dying takes precedence: a mutual kill must not also grant victory
    if (combatOutcome.heroDied) {
      board.status = 'defeat';
    }
  }

  if (acted) {
    // The snare notice describes the turn that just resolved, so it is rewritten on every turn
    // the hero actually spends and left untouched by a no-op like a wall bump.
    board.heroIsSlowed = snared;
    processTurnLifecycle(board, messages);
  }

  return {
    acted,
    moved,
    messages,
    strikeQuality,
    damageDealt,
    damageAt: damageDealt !== undefined ? { x: next.x, y: next.y } : undefined,
    leveledUp
  };
}

export function useBackpackSpell(board: BoardState): SpellResult {
  if (board.status !== 'playing') {
    return { used: false, message: 'You cannot use a spell right now.' };
  }

  if (board.spellCharges <= 0) {
    return { used: false, message: 'No spell charges left.' };
  }

  const hero = board.tiles.find((tile) => tile.kind === 'hero');

  if (!hero) {
    return { used: false, message: 'No hero found.' };
  }

  board.spellCharges -= 1;

  const target = findSpellTarget(board, hero);

  if (target) {
    if (target.kind === 'boss') {
      target.hp -= 3;
      board.bossHp = Math.max(0, target.hp);

      if (target.hp <= 0) {
        board.tiles = board.tiles.filter((tile) => tile.id !== target.id);
        board.xp += xpForTarget('boss');
        board.gold += goldForTarget('boss');
        applyLevelUps(board, hero);

        // Must go through onBossDefeated rather than setting victory directly — otherwise fireballing
        // a layer-2 boss would end a five-layer run three floors early.
        const outcome: string[] = ['Fireball scorched the boss.'];
        onBossDefeated(board, outcome);

        return { used: true, message: outcome.join(' ') };
      }

      return { used: true, message: 'Fireball hit the boss.' };
    }

    target.hp -= 999;

    if (target.hp <= 0) {
      board.tiles = board.tiles.filter((tile) => tile.id !== target.id);
      board.xp += xpForTarget(target.kind);
      board.gold += goldForTarget(target.kind);
      const leveled = applyLevelUps(board, hero);

      return {
        used: true,
        message: leveled
          ? `Fireball destroyed the ${target.kind}. Level up!`
          : `Fireball destroyed the ${target.kind}.`
      };
    }
  }

  hero.hp = Math.min(board.heroMaxHp, hero.hp + 2);
  return { used: true, message: 'Fireball restored 2 HP.' };
}

function processTurnLifecycle(board: BoardState, messages: string[]): void {
  // A death resolved during the action itself ends the run — never run a lifecycle on a finished board
  if (board.status !== 'playing') {
    return;
  }

  board.turn += 1;

  if (board.phase === 'run') {
    board.progress = Math.min(board.maxProgress, board.progress + board.progressPerTurn);

    if (board.progress >= board.maxProgress) {
      if (board.mode === 'quest') {
        startBossEncounter(board);
        messages.push('The Stone-Weaver awakens!');
      } else {
        // daily and endless reach victory directly when progress fills
        board.status = 'victory';
        return;
      }
    }
  }

  if (board.status !== 'playing') {
    return;
  }

  spawnTurnTiles(board);

  if (board.phase === 'boss') {
    board.bossTurnsElapsed += 1;
    board.bossAttackCountdown -= 1;

    if (board.bossAttackCountdown <= 0) {
      bossWeaveAttack(board, messages);
      scheduleBossAttack(board);
    }
  }

  // Only resolve the kill if the boss weave didn't just kill the hero — a mutual kill is a defeat.
  if (board.phase === 'boss' && board.bossHp <= 0 && board.status === 'playing') {
    onBossDefeated(board, messages);
  }
}

/**
 * The single place a boss death is resolved. Both routes to it — melee via `processTurnLifecycle` and
 * fireball via `useBackpackSpell` — must come through here, or one of them will end a multi-layer run
 * at the wrong floor.
 *
 * On the final layer (or in any single-layer mode) that is the run's victory. Otherwise the floor is
 * merely *cleared*: a stairway opens and the hero has to walk to it.
 */
function onBossDefeated(board: BoardState, messages: string[]): void {
  board.bossHp = 0;

  if (board.mode !== 'quest' || board.layer >= board.maxLayers) {
    board.status = 'victory';

    return;
  }

  board.phase = 'cleared';
  board.bossAttackCountdown = 0;
  spawnDoor(board);
  messages.push('A stairway grinds open below.');
}

/** Drops the stairway tile that ends a cleared layer. */
function spawnDoor(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:L${board.layer}:door`));
  const position = pickEmptyCell(board.tiles, random) ?? clearCell(board, random);

  board.tiles.push(createTile('door', position.x, position.y, takeTileId(board)));
}

/**
 * Descends to the next layer: a fresh board, a harder spawn tier, and a partial heal.
 *
 * The hero's level, attack, block, max HP, gold and XP all carry over — the run is one continuous
 * character, not five separate ones. What resets is the board itself and the progress track.
 */
function advanceLayer(board: BoardState, hero: Tile, messages: string[]): void {
  board.layer += 1;
  board.phase = 'run';
  board.progress = 0;
  board.bossHp = 0;
  board.bossMaxHp = 0;
  board.bossTurnsElapsed = 0;
  board.bossAttackCountdown = 0;
  board.heroIsSlowed = false;

  hero.x = 2;
  hero.y = 2;
  board.tiles = [hero];

  const healed = Math.min(board.heroMaxHp - hero.hp, Math.ceil(board.heroMaxHp * LAYER_HEAL_FRACTION));
  hero.hp += healed;
  board.spellCharges = Math.min(board.spellMaxCharges, board.spellCharges + 1);

  const random = mulberry32(hashString(`${board.seed}:L${board.layer}:layout`));
  const spawnKinds = spawnPoolForTier(spawnTierFor(board));

  for (let index = 0; index < LAYER_START_TILES; index += 1) {
    const position = pickSpawnCell(board.tiles, random);

    if (!position) {
      break;
    }

    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    board.tiles.push(createTile(kind, position.x, position.y, takeTileId(board)));
  }

  messages.push(`Layer ${board.layer}: ${layerName(board.layer)}.`);

  if (healed > 0) {
    messages.push(`You catch your breath and recover ${healed} HP.`);
  }
}

/** Name of a 1-based layer, clamped so an out-of-range depth still reads sensibly. */
export function layerName(layer: number): string {
  return LAYER_NAMES[Math.min(LAYER_NAMES.length - 1, Math.max(0, layer - 1))];
}

/**
 * Hands out the next tile id. Ids used to be built from `turn + tiles.length + index`, which is not
 * injective — two tiles created on different turns could collide. The renderer keys its view map by
 * id, so a collision surfaced as a tile that never moved or never died.
 */
function takeTileId(board: BoardState): number {
  const id = board.nextTileId;
  board.nextTileId += 1;

  return id;
}

function createTile(kind: TileKind, x: number, y: number, index: number): Tile {
  switch (kind) {
    case 'hero':
      return {
        id: `hero-${index}`,
        kind,
        x,
        y,
        hp: HERO_BASE_HP,
        attack: HERO_BASE_ATTACK,
        block: 0,
        blocksMovement: false,
        immovable: false
      };
    case 'goblin':
      return {
        id: `goblin-${index}`,
        kind,
        x,
        y,
        hp: 3,
        attack: 1,
        block: 0,
        blocksMovement: true,
        immovable: false
      };
    case 'spider':
      return {
        id: `spider-${index}`,
        kind,
        x,
        y,
        hp: 4,
        attack: 2,
        block: 0,
        blocksMovement: true,
        immovable: false
      };
    case 'rock':
      return {
        id: `rock-${index}`,
        kind,
        x,
        y,
        hp: 1,
        attack: 0,
        block: 1,
        blocksMovement: true,
        immovable: false
      };
    case 'web':
      return {
        id: `web-${index}`,
        kind,
        x,
        y,
        hp: 1,
        attack: 0,
        block: 0,
        // Webs deliberately do not block — stepping in costs the turn instead of starting a fight
        blocksMovement: false,
        immovable: true
      };
    case 'gold':
      return {
        id: `gold-${index}`,
        kind,
        x,
        y,
        hp: 1,
        attack: 0,
        block: 0,
        blocksMovement: false,
        immovable: false,
        value: 1
      };
    case 'boss':
      return {
        id: `boss-${index}`,
        kind,
        x,
        y,
        // hp and attack are overwritten by startBossEncounter with the level- and layer-scaled values
        hp: DEFAULT_BOSS_HP,
        attack: 3,
        block: 1,
        blocksMovement: true,
        immovable: false
      };
    case 'door':
      return {
        id: `door-${index}`,
        kind,
        x,
        y,
        hp: 1,
        attack: 0,
        block: 0,
        // The hero has to be able to step onto it — walking through is the entire point. `immovable`
        // keeps the boss weave from treating its cell as free ground.
        blocksMovement: false,
        immovable: true
      };
  }
}

function emptyCells(tiles: Tile[]): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!tiles.some((tile) => tile.x === x && tile.y === y)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
}

function pickEmptyCell(tiles: Tile[], random: () => number): { x: number; y: number } | undefined {
  const cells = emptyCells(tiles);

  if (cells.length === 0) {
    return undefined;
  }

  return cells[Math.floor(random() * cells.length)];
}

/**
 * Like `pickEmptyCell`, but avoids the four cells orthogonally touching the hero when anywhere else is
 * free. An enemy materialising in your face is the one death the player cannot read coming, and it was
 * the main reason Endless felt arbitrary rather than hard. Diagonals are still fair game — they cost a
 * turn to close, so you get to respond.
 */
function pickSpawnCell(tiles: Tile[], random: () => number): { x: number; y: number } | undefined {
  const cells = emptyCells(tiles);

  if (cells.length === 0) {
    return undefined;
  }

  const hero = tiles.find((tile) => tile.kind === 'hero');
  const away = hero
    ? cells.filter((cell) => Math.abs(cell.x - hero.x) + Math.abs(cell.y - hero.y) > 1)
    : cells;
  const pool = away.length > 0 ? away : cells;

  return pool[Math.floor(random() * pool.length)];
}

function offset(x: number, y: number, direction: Direction): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: x - 1, y };
    case 'right':
      return { x: x + 1, y };
    case 'up':
      return { x, y: y - 1 };
    case 'down':
      return { x, y: y + 1 };
  }
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

/**
 * The hero's swing, scaled by how well the player timed the strike minigame.
 *
 * Applied to the attack value *before* the defender's block, so a perfect hit also punches through
 * armour rather than just adding a flat amount on top of it.
 */
function attackForQuality(attack: number, quality: StrikeQuality): number {
  switch (quality) {
    case 'perfect':
      return attack * 2;
    case 'weak':
      return Math.max(1, Math.floor(attack / 2));
    case 'good':
      return attack;
  }
}

function strikeMessage(kind: TileKind, damage: number, quality: StrikeQuality): string {
  switch (quality) {
    case 'perfect':
      return `Perfect strike! ${kind} takes ${damage}.`;
    case 'weak':
      return `Glancing blow — ${kind} takes ${damage}.`;
    case 'good':
      return `You strike ${kind} for ${damage}.`;
  }
}

function resolveCombat(
  attacker: Tile,
  defender: Tile,
  quality: StrikeQuality
): { targetDied: boolean; heroDied: boolean; damageDealt: number; message: string } {
  if (attacker.kind !== 'hero') {
    return { targetDied: false, heroDied: false, damageDealt: 0, message: '' };
  }

  // Both sides floor at 1 so neither becomes untouchable: the hero always chips at least 1 off a
  // target, and a levelled-up block reduces an enemy counter without ever nullifying it. Inert
  // tiles (rocks, boss-woven stone) have no attack at all and are excluded from the floor, so
  // walking into scenery is still free.
  const damageToTarget = Math.max(1, attackForQuality(attacker.attack, quality) - defender.block);
  const targetRemainingHp = defender.hp - damageToTarget;
  // The counter-attack is identical for all three qualities, deliberately: mistiming the bar should
  // cost you damage, never add risk. A timing minigame that can get you killed for a slow thumb turns
  // every fight into a coin flip instead of a skill check.
  const heroDamage = defender.attack > 0 ? Math.max(1, defender.attack - attacker.block) : 0;
  const heroRemainingHp = attacker.hp - heroDamage;

  attacker.hp = heroRemainingHp;
  defender.hp = targetRemainingHp;

  return {
    targetDied: targetRemainingHp <= 0,
    heroDied: heroRemainingHp <= 0,
    damageDealt: damageToTarget,
    message: strikeMessage(defender.kind, damageToTarget, quality)
  };
}

function xpForTarget(kind: TileKind): number {
  switch (kind) {
    case 'goblin':
      return 12;
    case 'spider':
      return 15;
    case 'rock':
      return 4;
    case 'boss':
      return 40;
    case 'gold':
    case 'web':
    case 'hero':
    case 'door':
      return 0;
  }
}

function goldForTarget(kind: TileKind): number {
  switch (kind) {
    case 'goblin':
      return 2;
    case 'spider':
      return 3;
    case 'boss':
      return 10;
    case 'rock':
    case 'web':
    case 'gold':
    case 'hero':
    case 'door':
      // Gold tiles pay out through their own `value` on pickup, not through combat
      return 0;
  }
}

const SPAWN_POOLS: TileKind[][] = [
  ['goblin', 'goblin', 'spider', 'rock', 'web', 'gold'],
  ['goblin', 'goblin', 'goblin', 'spider', 'spider', 'rock'],
  ['goblin', 'goblin', 'spider', 'spider', 'spider', 'rock']
];

/**
 * Which spawn pool the board draws from. Turns *and* depth both push it toward harder enemies, so
 * layer 3 opens at the difficulty layer 1 reaches around turn 40.
 */
function spawnTierFor(board: BoardState): number {
  return Math.min(SPAWN_POOLS.length - 1, Math.floor(board.turn / 20) + (board.layer - 1));
}

function spawnPoolForTier(tier: number): TileKind[] {
  return SPAWN_POOLS[Math.min(SPAWN_POOLS.length - 1, Math.max(0, tier))];
}

/** Fraction of the grid currently holding a tile of any kind, hero included. */
function occupancy(board: BoardState): number {
  return board.tiles.length / (BOARD_SIZE * BOARD_SIZE);
}

function spawnsThisTurn(board: BoardState): number {
  const base = board.mode === 'endless'
    ? Math.min(ENDLESS_SPAWN_CAP, board.spawnsPerTurn + Math.floor(board.turn / ENDLESS_SPAWN_RAMP_TURNS))
    : board.spawnsPerTurn;

  // A cleared layer is a breather, not a second gauntlet — the walk to the stairway should not have to
  // be fought through.
  return board.phase === 'cleared' ? Math.floor(base / 2) : base;
}

function spawnTurnTiles(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:L${board.layer}:${board.turn}:spawn`));
  const spawnKinds = spawnPoolForTier(spawnTierFor(board));
  const spawns = spawnsThisTurn(board);

  for (let index = 0; index < spawns; index += 1) {
    // Re-checked inside the loop, not once above it: a turn allowed to place three tiles must still
    // stop at the ceiling rather than overshooting it by two.
    if (occupancy(board) >= SPAWN_OCCUPANCY_CEILING) {
      return;
    }

    const position = pickSpawnCell(board.tiles, random);

    if (!position) {
      return;
    }

    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    board.tiles.push(createTile(kind, position.x, position.y, takeTileId(board)));
  }
}

/**
 * The current layer's boss HP.
 *
 * Reads its floor from `bossBaseHp` — the value the run was configured with — and never from
 * `bossMaxHp`, which is this function's own *output*. Using the output as the input is what would make
 * each layer's boss inherit the previous layer's already-scaled HP and compound away from the tuning.
 */
function bossHpForLayer(board: BoardState): number {
  const baseHp = board.bossBaseHp > 0 ? board.bossBaseHp : DEFAULT_BOSS_HP;
  // Scale boss HP with hero level so it stays challenging after upgrades. At the expected level 3
  // that lands on 14 HP: the hero's 4 attack against 1 block is 5 swings of melee taking 2 back
  // each, which a hero arriving at ~9 HP does not survive on melee alone — the banked fireballs
  // (3 damage each) are what close the gap. Spending charges on spiders earlier is a real trade.
  const levelScaled = Math.max(baseHp, 8 + board.heroLevel * 2);

  return Math.round(levelScaled * (1 + BOSS_HP_LAYER_GROWTH * (board.layer - 1)));
}

/** Turns between weave sweeps. Deeper layers give the hero less room between them. */
function bossAttackInterval(board: BoardState): number {
  return Math.max(2, BOSS_ATTACK_INTERVAL - Math.floor((board.layer - 1) / 2));
}

function startBossEncounter(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:L${board.layer}:boss`));
  const bossHp = bossHpForLayer(board);
  const bossPosition = pickEmptyCell(board.tiles, random) ?? clearCell(board, random);

  board.phase = 'boss';
  board.bossTurnsElapsed = 0;
  scheduleBossAttack(board, random);
  board.progress = 0;
  board.bossHp = bossHp;
  board.bossMaxHp = bossHp;

  const boss = createTile('boss', bossPosition.x, bossPosition.y, takeTileId(board));
  boss.hp = bossHp;
  boss.attack += Math.floor((board.layer - 1) / 2);
  board.tiles.push(boss);
}

/**
 * Last resort when the board is completely full and something has to be placed anyway — a boss, or the
 * stairway out of a cleared layer: crush a non-hero tile to make room. A packed board must never hand
 * the player a free victory, nor trap them on a floor with no exit.
 */
function clearCell(board: BoardState, random: () => number): { x: number; y: number } {
  const hero = board.tiles.find((tile) => tile.kind === 'hero');
  const candidates = board.tiles.filter((tile) => tile.kind !== 'hero');

  if (candidates.length === 0) {
    // Only the hero is on the board — drop the boss in any cell the hero isn't standing on
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (hero?.x !== x || hero?.y !== y) {
          return { x, y };
        }
      }
    }

    return { x: 0, y: 0 };
  }

  const victim = candidates[Math.floor(random() * candidates.length)];
  board.tiles = board.tiles.filter((tile) => tile.id !== victim.id);

  return { x: victim.x, y: victim.y };
}

function scheduleBossAttack(board: BoardState, random: () => number = mulberry32(hashString(`${board.seed}:L${board.layer}:boss-schedule:${board.turn}`))): void {
  board.bossAttackCountdown = bossAttackInterval(board);
  board.bossAttackAxis = random() > 0.5 ? 'row' : 'column';
  board.bossAttackLine = Math.floor(random() * BOARD_SIZE);
}

/**
 * The boss sweeps a full row or column: the hero takes damage if caught in it, and every
 * empty cell along the line is walled off with woven stone. Mutates `board.tiles` in place so
 * tile identity (and therefore any renderer-side animation state) survives the attack.
 */
function bossWeaveAttack(board: BoardState, messages: string[]): void {
  const boss = board.tiles.find((tile) => tile.kind === 'boss');
  const hero = board.tiles.find((tile) => tile.kind === 'hero');

  if (!boss) {
    return;
  }

  const attackIsRow = board.bossAttackAxis === 'row';
  const energyLine = board.bossAttackLine;
  const heroIsCaught = hero !== undefined
    && ((attackIsRow && hero.y === energyLine) || (!attackIsRow && hero.x === energyLine));

  if (hero && heroIsCaught) {
    const weaveDamage = Math.max(1, BOSS_WEAVE_DAMAGE - hero.block);
    hero.hp -= weaveDamage;
    messages.push(`The weave lashes you for ${weaveDamage}!`);

    if (hero.hp <= 0) {
      board.status = 'defeat';
    }
  } else {
    messages.push('Stone floods the weave line.');
  }

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const x = attackIsRow ? index : energyLine;
    const y = attackIsRow ? energyLine : index;

    if (x === boss.x && y === boss.y) {
      continue;
    }

    const occupied = board.tiles.some((tile) => tile.x === x && tile.y === y);

    if (!occupied) {
      // Built inline rather than through createTile: woven stone is a tougher rock (block 2), so it
      // is not the same tile the spawn pool produces.
      board.tiles.push({
        id: `stone-${takeTileId(board)}`,
        kind: 'rock',
        x,
        y,
        hp: 1,
        attack: 0,
        block: 2,
        blocksMovement: true,
        immovable: false
      });
    }
  }
}

function findSpellTarget(board: BoardState, hero: Tile): Tile | undefined {
  const directions: Direction[] = ['up', 'right', 'down', 'left'];

  for (const direction of directions) {
    let x = hero.x;
    let y = hero.y;

    while (true) {
      const next = offset(x, y, direction);

      if (!inBounds(next.x, next.y)) {
        break;
      }

      const occupant = board.tiles.find((tile) => tile.id !== hero.id && tile.x === next.x && tile.y === next.y);

      if (occupant) {
        // Gold and the stairway are not targets — the fireball deletes whatever it hits, and burning
        // down the only exit from a cleared layer would strand the run with no way to descend.
        if (occupant.kind !== 'gold' && occupant.kind !== 'door') {
          return occupant;
        }

        break;
      }

      x = next.x;
      y = next.y;
    }
  }

  return undefined;
}

/** Applies every level-up the current XP total earns. Returns true if the hero gained at least one level. */
function applyLevelUps(board: BoardState, hero: Tile): boolean {
  let xpNeeded = xpForNextLevel(board.heroLevel);
  let leveled = false;

  while (board.xp >= xpNeeded) {
    board.xp -= xpNeeded;
    board.heroLevel += 1;
    board.heroMaxHp += LEVEL_UP_MAX_HP;
    hero.attack += 1;
    // Block only every other level. At +1 per level it outran every enemy's attack within three
    // kills and the hero stopped taking damage entirely.
    if (board.heroLevel % 2 === 0) {
      hero.block += 1;
    }

    hero.hp = Math.min(board.heroMaxHp, hero.hp + LEVEL_UP_HEAL);
    // Each level grants a charge, so banking several levels at once banks several charges
    board.spellCharges = Math.min(board.spellMaxCharges, board.spellCharges + 1);
    leveled = true;
    // Recompute threshold for the new level
    xpNeeded = xpForNextLevel(board.heroLevel);
  }

  return leveled;
}

/**
 * XP needed to leave `heroLevel`: 20, 32, 44, 56, … Tuned against the ~18 turns a Quest run gives
 * you before the boss and the 12–15 XP an enemy is worth — the old 100-and-up curve meant a Quest
 * hero met the Stone-Weaver still at level 1, dealing 1 damage a swing, which was unwinnable.
 */
export function xpForNextLevel(heroLevel: number): number {
  return 20 + (heroLevel - 1) * 12;
}
