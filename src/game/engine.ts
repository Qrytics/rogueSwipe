import { hashString, mulberry32 } from './random';
import type { BoardState, Direction, GameMode, SpellResult, Tile, TileKind, TurnResult } from './types';

const BOARD_SIZE = 5;
/** Raw damage of a boss weave sweep, before the hero's block is subtracted. */
const BOSS_WEAVE_DAMAGE = 3;
/** Turns between boss weave sweeps. */
const BOSS_ATTACK_INTERVAL = 4;

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
  endless: 2
};

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

  for (let index = 0; index < 7; index += 1) {
    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    const position = pickEmptyCell(tiles, random);

    if (!position) {
      break;
    }

    tiles.push(createTile(kind, position.x, position.y, index));
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

export function moveHeroOneTile(board: BoardState, direction: Direction): TurnResult {
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
  } else if (occupant.blocksMovement && occupant.kind !== 'hero') {
    const combatOutcome = resolveCombat(hero, occupant);
    acted = true;
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

  return { acted, moved, messages };
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
        board.status = 'victory';
        return { used: true, message: 'Fireball scorched the boss.' };
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

  // Only claim victory if the boss weave didn't just kill the hero
  if (board.phase === 'boss' && board.bossHp <= 0 && board.status === 'playing') {
    board.status = 'victory';
  }
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
        // hp is overwritten by startBossEncounter with the level-scaled value
        hp: 12,
        attack: 3,
        block: 1,
        blocksMovement: true,
        immovable: false
      };
  }
}

function pickEmptyCell(tiles: Tile[], random: () => number): { x: number; y: number } | undefined {
  const emptyCells: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!tiles.some((tile) => tile.x === x && tile.y === y)) {
        emptyCells.push({ x, y });
      }
    }
  }

  if (emptyCells.length === 0) {
    return undefined;
  }

  return emptyCells[Math.floor(random() * emptyCells.length)];
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

function resolveCombat(attacker: Tile, defender: Tile): { targetDied: boolean; heroDied: boolean; message: string } {
  if (attacker.kind !== 'hero') {
    return { targetDied: false, heroDied: false, message: '' };
  }

  // Both sides floor at 1 so neither becomes untouchable: the hero always chips at least 1 off a
  // target, and a levelled-up block reduces an enemy counter without ever nullifying it. Inert
  // tiles (rocks, boss-woven stone) have no attack at all and are excluded from the floor, so
  // walking into scenery is still free.
  const damageToTarget = Math.max(1, attacker.attack - defender.block);
  const targetRemainingHp = defender.hp - damageToTarget;
  const heroDamage = defender.attack > 0 ? Math.max(1, defender.attack - attacker.block) : 0;
  const heroRemainingHp = attacker.hp - heroDamage;

  attacker.hp = heroRemainingHp;
  defender.hp = targetRemainingHp;

  return {
    targetDied: targetRemainingHp <= 0,
    heroDied: heroRemainingHp <= 0,
    message: `You strike ${defender.kind} for ${damageToTarget}.`
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
      // Gold tiles pay out through their own `value` on pickup, not through combat
      return 0;
  }
}

function spawnTurnTiles(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:${board.turn}:spawn`));

  // Shift spawn pool toward harder enemies as turns advance
  const difficultyTier = Math.min(2, Math.floor(board.turn / 20));
  const spawnPools: TileKind[][] = [
    ['goblin', 'goblin', 'spider', 'rock', 'web', 'gold'],
    ['goblin', 'goblin', 'goblin', 'spider', 'spider', 'rock'],
    ['goblin', 'goblin', 'spider', 'spider', 'spider', 'rock']
  ];
  const spawnKinds = spawnPools[difficultyTier];

  // Endless mode gains extra spawns every 30 turns, capped at 4
  const dynamicSpawns = board.mode === 'endless'
    ? Math.min(4, board.spawnsPerTurn + Math.floor(board.turn / 30))
    : board.spawnsPerTurn;

  for (let index = 0; index < dynamicSpawns; index += 1) {
    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    const position = pickEmptyCell(board.tiles, random);

    if (!position) {
      return;
    }

    board.tiles.push(createTile(kind, position.x, position.y, board.turn + board.tiles.length + index));
  }
}

function startBossEncounter(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:boss`));
  // Scale boss HP with hero level so it stays challenging after upgrades. At the expected level 3
  // that lands on 14 HP: the hero's 4 attack against 1 block is 5 swings of melee taking 2 back
  // each, which a hero arriving at ~9 HP does not survive on melee alone — the banked fireballs
  // (3 damage each) are what close the gap. Spending charges on spiders earlier is a real trade.
  const baseHp = board.bossMaxHp > 0 ? board.bossMaxHp : 12;
  const bossHp = Math.max(baseHp, 8 + board.heroLevel * 2);
  const bossPosition = pickEmptyCell(board.tiles, random) ?? clearCellForBoss(board, random);

  board.phase = 'boss';
  board.bossTurnsElapsed = 0;
  scheduleBossAttack(board, random);
  board.progress = 0;
  board.bossHp = bossHp;
  board.bossMaxHp = bossHp;

  const boss = createTile('boss', bossPosition.x, bossPosition.y, board.turn + board.tiles.length + 99);
  boss.hp = bossHp;
  board.tiles.push(boss);
}

/**
 * Last resort when the board is completely full at boss time: crush a non-hero tile to make room.
 * A packed board must never hand the player a free victory.
 */
function clearCellForBoss(board: BoardState, random: () => number): { x: number; y: number } {
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

function scheduleBossAttack(board: BoardState, random: () => number = mulberry32(hashString(`${board.seed}:boss-schedule:${board.turn}`))): void {
  board.bossAttackCountdown = BOSS_ATTACK_INTERVAL;
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
      board.tiles.push({
        id: `stone-${board.turn}-${index}`,
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
        if (occupant.kind !== 'gold') {
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
