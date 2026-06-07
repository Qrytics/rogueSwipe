import { hashString, mulberry32 } from './random';
import type { BoardState, Direction, GameMode, RunConfig, SlideResult, Tile, TileKind } from './types';

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
  const random = mulberry32(hashString(seed));
  const tiles: Tile[] = [];

  const hero: Tile = {
    id: 'hero',
    kind: 'hero',
    x: 2,
    y: 2,
    hp: 5,
    attack: 1,
    block: 0,
    blocksMovement: false,
    immovable: false
  };

  tiles.push(hero);

  const spawnKinds: TileKind[] = ['goblin', 'spider', 'rock', 'web', 'gold'];

  for (let index = 0; index < 7; index += 1) {
    const kind = spawnKinds[Math.floor(random() * spawnKinds.length)];
    const position = pickEmptyCell(tiles, random);

    tiles.push(createTile(kind, position.x, position.y, index));
  }

  return {
    size: BOARD_SIZE,
    mode,
    phase: 'run',
    turn: 0,
    progress: 0,
    maxProgress: 100,
    progressPerTurn: DEFAULT_PROGRESS_PER_TURN[mode],
    spawnsPerTurn: DEFAULT_SPAWNS_PER_TURN[mode],
    bossHp: 0,
    bossMaxHp: 0,
    xp: 0,
    gold: 0,
    status: 'playing',
    seed,
    tiles
  };
}

export function slideBoard(board: BoardState, direction: Direction): SlideResult {
  if (board.status !== 'playing') {
    return { moved: false, combatLog: [] };
  }

  const combatLog: string[] = [];
  const nextTiles = new Map(board.tiles.map((tile) => [tile.id, { ...tile }]));
  const orderedTiles = [...nextTiles.values()].sort((left, right) => sortForDirection(left, right, direction));
  let moved = false;

  for (const tile of orderedTiles) {
    const current = nextTiles.get(tile.id);

    if (!current || current.immovable) {
      continue;
    }

    let destinationX = current.x;
    let destinationY = current.y;

    while (true) {
      const candidate = offset(destinationX, destinationY, direction);

      if (!inBounds(candidate.x, candidate.y)) {
        break;
      }

      const occupant = findOccupant(nextTiles, candidate.x, candidate.y, current.id);

      if (!occupant) {
        destinationX = candidate.x;
        destinationY = candidate.y;
        continue;
      }

      if (occupant.kind === 'gold' && current.kind === 'hero') {
        nextTiles.delete(occupant.id);
        board.gold += occupant.value ?? 1;
        destinationX = candidate.x;
        destinationY = candidate.y;
        continue;
      }

      if (occupant.blocksMovement) {
        if (current.kind === 'hero' && occupant.kind !== 'hero') {
          const combatOutcome = resolveCombat(current, occupant);

          combatLog.push(combatOutcome.message);

          if (combatOutcome.targetDied) {
            nextTiles.delete(occupant.id);
            board.xp += xpForTarget(occupant.kind);
            board.gold += goldForTarget(occupant.kind);
            destinationX = candidate.x;
            destinationY = candidate.y;
          }

          if (combatOutcome.heroDied) {
            board.status = 'defeat';
          }
        }

        break;
      }

      break;
    }

    if (destinationX !== current.x || destinationY !== current.y) {
      current.x = destinationX;
      current.y = destinationY;
      moved = true;
    }
  }

  board.tiles = [...nextTiles.values()];
  board.turn += 1;
  if (board.phase === 'run') {
    board.progress = Math.min(board.maxProgress, board.progress + board.progressPerTurn);
  }

  if (board.status === 'playing') {
    spawnTurnTiles(board);
  }

  if (board.mode === 'quest' && board.phase === 'run' && board.progress >= board.maxProgress && board.status === 'playing') {
    startBossEncounter(board);
  }

  if (board.phase === 'boss' && board.bossHp <= 0 && board.status === 'playing') {
    board.status = 'victory';
  }

  return { moved, combatLog };
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

function pickEmptyCell(tiles: Tile[], random: () => number): { x: number; y: number } {
  const emptyCells: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!tiles.some((tile) => tile.x === x && tile.y === y)) {
        emptyCells.push({ x, y });
      }
    }
  }

  return emptyCells[Math.floor(random() * emptyCells.length)];
}

function sortForDirection(left: Tile, right: Tile, direction: Direction): number {
  switch (direction) {
    case 'left':
      return left.x - right.x || left.y - right.y;
    case 'right':
      return right.x - left.x || left.y - right.y;
    case 'up':
      return left.y - right.y || left.x - right.x;
    case 'down':
      return right.y - left.y || left.x - right.x;
  }
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

function findOccupant(tiles: Map<string, Tile>, x: number, y: number, movingId: string): Tile | undefined {
  return [...tiles.values()].find((tile) => tile.id !== movingId && tile.x === x && tile.y === y);
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
    message: `${attacker.kind} hit ${defender.kind} for ${damageToTarget}.`
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
      return 0;
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
  const bossHp = 12;
  const bossPosition = pickEmptyCell(board.tiles, random) ?? findFallbackBossPosition(board.tiles);

  board.phase = 'boss';
  board.progress = 0;
  board.bossHp = bossHp;
  board.bossMaxHp = bossHp;

  if (!bossPosition) {
    board.status = 'victory';
    return;
  }

  board.tiles.push(createTile('boss', bossPosition.x, bossPosition.y, board.turn + board.tiles.length + 99));
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