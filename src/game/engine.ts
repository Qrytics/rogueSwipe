import { hashString, mulberry32 } from './random';
import type { BoardState, Direction, GameMode, SpellResult, Tile, TileKind, TurnResult } from './types';

const BOARD_SIZE = 5;

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
    hp: 5 + maxHpBonus,
    attack: 1 + attackBonus,
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
    tiles
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
  } else if (occupant.blocksMovement && occupant.kind !== 'hero') {
    const combatOutcome = resolveCombat(hero, occupant);
    acted = true;
    messages.push(combatOutcome.message);

    if (occupant.kind === 'boss') {
      board.bossHp = Math.max(0, occupant.hp);
    }

    if (combatOutcome.targetDied) {
      board.tiles = board.tiles.filter((tile) => tile.id !== occupant.id);
      board.xp += xpForTarget(occupant.kind);
      board.gold += goldForTarget(occupant.kind);
      applyLevelUps(board, hero);
      hero.x = next.x;
      hero.y = next.y;
      moved = true;

      if (occupant.kind === 'boss') {
        board.bossHp = 0;
      }
    }

    if (combatOutcome.heroDied) {
      board.status = 'defeat';
    }
  }

  if (acted) {
    processTurnLifecycle(board);
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
      applyLevelUps(board, hero);
      return { used: true, message: `Fireball destroyed the ${target.kind}.` };
    }
  }

  hero.hp = Math.min(board.heroMaxHp, hero.hp + 2);
  return { used: true, message: 'Fireball restored 2 HP.' };
}

function processTurnLifecycle(board: BoardState): void {
  board.turn += 1;

  if (board.phase === 'run') {
    board.progress = Math.min(board.maxProgress, board.progress + board.progressPerTurn);
  }

  if (board.mode === 'quest' && board.phase === 'run' && board.progress >= board.maxProgress && board.status === 'playing') {
    startBossEncounter(board);
  }

  if (board.phase === 'boss' && board.bossHp <= 0 && board.status === 'playing') {
    board.status = 'victory';
    return;
  }

  if (board.status === 'playing') {
    spawnTurnTiles(board);
  }

  if (board.phase === 'boss' && board.status === 'playing') {
    board.bossTurnsElapsed += 1;
    board.bossAttackCountdown -= 1;

    if (board.bossAttackCountdown <= 0) {
      const nextTiles = new Map(board.tiles.map((tile) => [tile.id, { ...tile }]));
      bossWeaveAttack(board, nextTiles);
      board.tiles = [...nextTiles.values()];
      scheduleBossAttack(board);
    }
  }

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
        hp: 5,
        attack: 1,
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
        blocksMovement: true,
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
        hp: 12,
        attack: 2,
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

  const damageToTarget = Math.max(1, attacker.attack - defender.block);
  const targetRemainingHp = defender.hp - damageToTarget;
  const heroDamage = Math.max(0, defender.attack - attacker.block);
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
    case 'gold':
    case 'web':
    case 'boss':
    case 'hero':
      return 0;
  }
}

function goldForTarget(kind: TileKind): number {
  return kind === 'gold' ? 1 : 0;
}

function spawnTurnTiles(board: BoardState): void {
  const random = mulberry32(hashString(`${board.seed}:${board.turn}:spawn`));
  const spawnKinds: TileKind[] = ['goblin', 'goblin', 'spider', 'rock', 'web', 'gold'];

  for (let index = 0; index < board.spawnsPerTurn; index += 1) {
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
  const bossHp = Math.max(1, board.bossMaxHp || 12);
  const bossPosition = pickEmptyCell(board.tiles, random) ?? findFallbackBossPosition(board.tiles);

  board.phase = 'boss';
  board.bossTurnsElapsed = 0;
  scheduleBossAttack(board, random);
  board.progress = 0;
  board.bossHp = bossHp;
  board.bossMaxHp = bossHp;

  if (!bossPosition) {
    board.status = 'victory';
    return;
  }

  board.tiles.push(createTile('boss', bossPosition.x, bossPosition.y, board.turn + board.tiles.length + 99));
}

function scheduleBossAttack(board: BoardState, random: () => number = mulberry32(hashString(`${board.seed}:boss-schedule:${board.turn}`))): void {
  board.bossAttackCountdown = 4;
  board.bossAttackAxis = random() > 0.5 ? 'row' : 'column';
  board.bossAttackLine = Math.floor(random() * BOARD_SIZE);
}

function bossWeaveAttack(board: BoardState, tiles: Map<string, Tile>): void {
  const boss = [...tiles.values()].find((tile) => tile.kind === 'boss');
  const hero = [...tiles.values()].find((tile) => tile.kind === 'hero');

  if (!boss) {
    return;
  }

  const attackIsRow = board.bossAttackAxis === 'row';
  const energyLine = board.bossAttackLine;

  if (hero && ((attackIsRow && hero.y === energyLine) || (!attackIsRow && hero.x === energyLine))) {
    hero.hp -= 2;

    if (hero.hp <= 0) {
      board.status = 'defeat';
    }
  }

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const x = attackIsRow ? index : energyLine;
    const y = attackIsRow ? energyLine : index;

    if (x === boss.x && y === boss.y) {
      continue;
    }

    const occupied = [...tiles.values()].find((tile) => tile.x === x && tile.y === y);

    if (!occupied) {
      tiles.set(`stone-${board.turn}-${index}`, {
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

function findFallbackBossPosition(tiles: Tile[]): { x: number; y: number } | undefined {
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const occupant = tiles.find((tile) => tile.x === x && tile.y === y && tile.kind !== 'hero');

      if (occupant) {
        return { x, y };
      }
    }
  }

  return undefined;
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

function applyLevelUps(board: BoardState, hero: Tile): void {
  while (board.xp >= 100) {
    board.xp -= 100;
    board.heroLevel += 1;
    board.heroMaxHp += 2;
    hero.attack += 1;
    hero.block += 1;
    hero.hp = Math.min(board.heroMaxHp, hero.hp + 3);
    board.spellCharges = Math.min(board.spellMaxCharges, board.spellCharges + 1);
  }
}
