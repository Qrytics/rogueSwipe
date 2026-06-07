export type Direction = 'up' | 'down' | 'left' | 'right';

export type TileKind = 'hero' | 'goblin' | 'spider' | 'rock' | 'web' | 'gold';

export type RunStatus = 'playing' | 'victory' | 'defeat';

export type GameMode = 'quest' | 'daily' | 'endless';

export interface RunConfig {
  mode: GameMode;
  seed: string;
  progressTarget: number;
  progressPerTurn: number;
  spawnsPerTurn: number;
  title: string;
  subtitle: string;
}

export interface Tile {
  id: string;
  kind: TileKind;
  x: number;
  y: number;
  hp: number;
  attack: number;
  block: number;
  blocksMovement: boolean;
  immovable: boolean;
  value?: number;
}

export interface BoardState {
  size: number;
  mode: GameMode;
  turn: number;
  progress: number;
  maxProgress: number;
  progressPerTurn: number;
  spawnsPerTurn: number;
  xp: number;
  gold: number;
  status: RunStatus;
  seed: string;
  tiles: Tile[];
}

export interface SlideResult {
  moved: boolean;
  combatLog: string[];
}