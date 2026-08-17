export type Direction = 'up' | 'down' | 'left' | 'right';

export type TileKind = 'hero' | 'goblin' | 'spider' | 'rock' | 'web' | 'gold' | 'boss' | 'door';

/**
 * How well the player timed the strike minigame. Scales the hero's outgoing damage only — the
 * enemy's counter-attack is identical in all three cases, so a mistimed tap costs damage but never
 * adds risk.
 */
export type StrikeQuality = 'perfect' | 'good' | 'weak';

export type RunStatus = 'playing' | 'victory' | 'defeat';

export type GameMode = 'quest' | 'daily' | 'endless';

export interface RunConfig {
  mode: GameMode;
  seed: string;
  progressTarget: number;
  progressPerTurn: number;
  spawnsPerTurn: number;
  bossHp: number;
  /** How many dungeon layers must be cleared to win. 1 for a single-boss (or bossless) mode. */
  layers: number;
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

export interface LeaderboardEntry {
  id: string;
  mode: GameMode;
  score: number;
  turns: number;
  gold: number;
  level: number;
  victory: boolean;
  createdAt: string;
}

/**
 * `cleared` is the beat after a layer boss dies but before the hero reaches the stairway: the run is
 * still alive, progress no longer accrues, and a `door` tile is waiting somewhere on the board.
 */
export type RunPhase = 'run' | 'boss' | 'cleared';

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
  /** Current boss's remaining HP, mirrored from the boss tile for the UI. Zero outside a boss fight. */
  bossHp: number;
  /** The current encounter's starting HP — a per-fight output, recomputed by startBossEncounter. */
  bossMaxHp: number;
  /**
   * The run's configured boss HP floor, set once from RunConfig and never overwritten. Kept separate
   * from `bossMaxHp` because that field is a per-encounter result: reading the scaling base out of it
   * would make each layer's boss inherit the previous layer's (already scaled) HP.
   */
  bossBaseHp: number;
  /** 1-based dungeon depth. Only Quest goes past 1. */
  layer: number;
  /** Layers needed to win. Beating the boss on this layer ends the run in victory. */
  maxLayers: number;
  /**
   * Monotonic source of tile ids. Ids used to be derived from `turn + tiles.length`, which could
   * repeat across turns — and since the renderer keys its views by id, a collision showed up as a
   * tile that never moved or never died.
   */
  nextTileId: number;
  xp: number;
  heroLevel: number;
  heroMaxHp: number;
  spellCharges: number;
  spellMaxCharges: number;
  gold: number;
  status: RunStatus;
  seed: string;
  tiles: Tile[];
  /** True when the turn that just resolved was spent tearing out of a web. Display only. */
  heroIsSlowed: boolean;
}

/**
 * Outcome of one turn. The three optional flags exist so the renderer and the sound engine can react
 * to *what happened* rather than pattern-matching the message strings — `messages[0]` is the player's
 * own action, so a level-up or a descent never wins that slot and used to be silently unreachable.
 */
export interface TurnResult {
  moved: boolean;
  acted: boolean;
  messages: string[];
  /** Present only when the turn resolved a melee strike. */
  strikeQuality?: StrikeQuality;
  /** Damage the hero dealt this turn, for the floating damage number. */
  damageDealt?: number;
  /** Cell the damage landed on, in grid coordinates. */
  damageAt?: { x: number; y: number };
  leveledUp?: boolean;
  /** True on the turn the hero walked through a stairway into the next layer. */
  descended?: boolean;
}

/**
 * What a swipe *would* hit, computed without mutating the board. This is what lets the scene open the
 * strike minigame before committing to the turn: `moveHeroOneTile` resolves a whole turn synchronously
 * (combat, loot, XP, spawns, boss countdown), so it cannot be suspended half-way through.
 */
export interface SwipePeek {
  /** The tile the hero would run into, or undefined for an empty cell or the board edge. */
  kind?: TileKind;
  /** True when the target is a living enemy — something worth a timed strike. */
  triggersDuel: boolean;
}

export interface SpellResult {
  used: boolean;
  message: string;
}