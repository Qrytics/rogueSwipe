export type Direction = 'up' | 'down' | 'left' | 'right';

export type TileKind = 'hero' | 'goblin' | 'spider' | 'rock' | 'web' | 'gold' | 'boss';

export type RunStatus = 'playing' | 'victory' | 'defeat';

export type GameMode = 'quest' | 'daily' | 'endless';

export interface RunConfig {
  mode: GameMode;
  seed: string;
  progressTarget: number;
  progressPerTurn: number;
  spawnsPerTurn: number;
  bossHp: number;
  title: string;
  subtitle: string;
}

export interface PersistentProgress {
  bankedGold: number;
  completedRuns: number;
  bestTurnsSurvived: number;
  permanentMaxHpBonus: number;
  permanentAttackBonus: number;
}

export interface RunSnapshot {
  board: BoardState;
  runConfig: RunConfig;
  lastActionMessage: string;
  savedAt: string;
}

export interface SaveData {
  schemaVersion: number;
  meta: PersistentProgress;
  activeRun: RunSnapshot | null;
}

export type RunPhase = 'run' | 'boss';

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
  phase: RunPhase;
  turn: number;
  bossTurnsElapsed: number;
  bossAttackCountdown: number;
  bossAttackAxis: 'row' | 'column';
  bossAttackLine: number;
  progress: number;
  maxProgress: number;
  progressPerTurn: number;
  spawnsPerTurn: number;
  bossHp: number;
  bossMaxHp: number;
  xp: number;
  heroLevel: number;
  heroMaxHp: number;
  spellCharges: number;
  spellMaxCharges: number;
  gold: number;
  status: RunStatus;
  seed: string;
  tiles: Tile[];
}

export interface SlideResult {
  moved: boolean;
  combatLog: string[];
}

export interface SpellResult {
  used: boolean;
  message: string;
}