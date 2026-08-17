import type { LeaderboardEntry, PersistentProgress, RunSnapshot, SaveData } from './types';

const STORAGE_KEY = 'rogueSwipe.save.v5';
const LEGACY_STORAGE_KEYS = ['rogueSwipe.save.v4', 'rogueSwipe.save.v3', 'rogueSwipe.save.v2', 'rogueSwipe.save.v1'];
const CURRENT_SCHEMA_VERSION = 5;
const LEADERBOARD_KEY = 'rogueSwipe.leaderboard.v1';
const MAX_LEADERBOARD_ENTRIES = 10;
/** Identical entries recorded within this window are treated as one accidental double-submission. */
const DUPLICATE_WINDOW_MS = 5_000;
/** Ceiling on permanent meta bonuses so long-time players don't become unkillable. */
const MAX_PERMANENT_BONUS = 5;

const DEFAULT_META: PersistentProgress = {
  bankedGold: 0,
  completedRuns: 0,
  bestTurnsSurvived: 0,
  permanentMaxHpBonus: 0,
  permanentAttackBonus: 0
};

export function loadSaveData(): SaveData {
  try {
    const rawValue = readStoredSaveValue();

    if (!rawValue) {
      return createEmptySaveData();
    }

    const parsed = JSON.parse(rawValue) as Partial<SaveData> & { version?: number };
    const migrated = migrateSaveData(parsed);

    if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      saveSaveData(migrated);
    }

    return migrated;
  } catch (error) {
    console.warn('rogueSwipe: failed to load save data, starting fresh', error);
    return createEmptySaveData();
  }
}

export function loadMetaProgress(): PersistentProgress {
  return loadSaveData().meta;
}

export function loadActiveRun(): RunSnapshot | null {
  return loadSaveData().activeRun;
}

export function saveMetaProgress(meta: PersistentProgress): void {
  const current = loadSaveData();
  saveSaveData({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    activeRun: current.activeRun
  });
}

export function saveActiveRun(snapshot: RunSnapshot): void {
  const current = loadSaveData();
  saveSaveData({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: current.meta,
    activeRun: snapshot
  });
}

export function clearActiveRun(): void {
  const current = loadSaveData();
  saveSaveData({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: current.meta,
    activeRun: null
  });
}

export function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const rawValue = localStorage.getItem(LEADERBOARD_KEY);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as LeaderboardEntry[];

    return parsed
      .filter((entry) => typeof entry.score === 'number')
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_LEADERBOARD_ENTRIES);
  } catch {
    return [];
  }
}

export function recordLeaderboardEntry(entry: Omit<LeaderboardEntry, 'id' | 'createdAt'>): LeaderboardEntry[] {
  const current = loadLeaderboard();

  // Deduplicate double-submissions (same run recorded twice on a refresh) without rejecting a
  // genuine second run that happens to tie: identical entries only collide inside a short window.
  const now = Date.now();
  const isDoubleSubmission = current.some((existing) => {
    if (existing.score !== entry.score || existing.mode !== entry.mode || existing.turns !== entry.turns) {
      return false;
    }

    const existingTime = Date.parse(existing.createdAt);

    return Number.isFinite(existingTime) && Math.abs(now - existingTime) < DUPLICATE_WINDOW_MS;
  });

  if (isDoubleSubmission) {
    return current;
  }

  const nextEntry: LeaderboardEntry = {
    ...entry,
    id: globalThis.crypto?.randomUUID?.() ?? `score-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    createdAt: new Date().toISOString()
  };

  const nextLeaderboard = [nextEntry, ...current]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_LEADERBOARD_ENTRIES);

  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextLeaderboard));

  return nextLeaderboard;
}

export function recordRunCompletion(turnsSurvived: number, goldEarned: number, victory: boolean): PersistentProgress {
  const current = loadMetaProgress();

  const nextMeta: PersistentProgress = {
    bankedGold: current.bankedGold + goldEarned + (victory ? 15 : 0),
    completedRuns: current.completedRuns + 1,
    bestTurnsSurvived: Math.max(current.bestTurnsSurvived, turnsSurvived),
    permanentMaxHpBonus: Math.min(MAX_PERMANENT_BONUS, current.permanentMaxHpBonus + (victory ? 1 : 0)),
    permanentAttackBonus: Math.min(MAX_PERMANENT_BONUS, current.permanentAttackBonus + (victory ? 1 : 0))
  };

  saveMetaProgress(nextMeta);

  return nextMeta;
}

export function saveSaveData(data: SaveData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...data,
    schemaVersion: CURRENT_SCHEMA_VERSION
  }));
}

function mergeMeta(meta: Partial<PersistentProgress> | undefined): PersistentProgress {
  return {
    bankedGold: meta?.bankedGold ?? DEFAULT_META.bankedGold,
    completedRuns: meta?.completedRuns ?? DEFAULT_META.completedRuns,
    bestTurnsSurvived: meta?.bestTurnsSurvived ?? DEFAULT_META.bestTurnsSurvived,
    // Clamp on read too, so saves written before the cap existed are brought back in line
    permanentMaxHpBonus: Math.min(MAX_PERMANENT_BONUS, meta?.permanentMaxHpBonus ?? DEFAULT_META.permanentMaxHpBonus),
    permanentAttackBonus: Math.min(MAX_PERMANENT_BONUS, meta?.permanentAttackBonus ?? DEFAULT_META.permanentAttackBonus)
  };
}

function createEmptySaveData(): SaveData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...DEFAULT_META },
    activeRun: null
  };
}

function migrateSaveData(raw: Partial<SaveData> & { version?: number }): SaveData {
  const meta = mergeMeta(raw.meta);
  // Always attempt to migrate the active run — migrateRunSnapshot fills in missing fields with safe defaults
  const activeRun = raw.activeRun
    ? migrateRunSnapshot(raw.activeRun)
    : null;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    activeRun
  };
}

function migrateRunSnapshot(snapshot: RunSnapshot): RunSnapshot {
  const tiles = snapshot.board.tiles ?? [];

  return {
    ...snapshot,
    board: {
      ...snapshot.board,
      tiles,
      bossTurnsElapsed: snapshot.board.bossTurnsElapsed ?? 0,
      bossAttackCountdown: snapshot.board.bossAttackCountdown ?? 0,
      bossAttackAxis: snapshot.board.bossAttackAxis ?? 'row',
      bossAttackLine: snapshot.board.bossAttackLine ?? 0,
      heroLevel: snapshot.board.heroLevel ?? 1,
      heroMaxHp: snapshot.board.heroMaxHp ?? tiles.find((tile) => tile.kind === 'hero')?.hp ?? 5,
      spellCharges: snapshot.board.spellCharges ?? 1,
      spellMaxCharges: snapshot.board.spellMaxCharges ?? 3,
      mode: snapshot.board.mode ?? snapshot.runConfig.mode,
      phase: snapshot.board.phase ?? 'run',
      heroIsSlowed: snapshot.board.heroIsSlowed ?? false,
      // v5. `maxLayers ?? 1`, deliberately not 5: a v4 Quest run was saved under the rules where its
      // boss *was* the ending, so it should still end there rather than being dropped into four
      // surprise extra floors it was never balanced for. New runs get 5 from their RunConfig.
      layer: snapshot.board.layer ?? 1,
      maxLayers: snapshot.board.maxLayers ?? 1,
      // Pre-v5 boards kept the configured boss HP in `bossMaxHp`, which is now a per-encounter output.
      bossBaseHp: snapshot.board.bossBaseHp ?? snapshot.runConfig.bossHp ?? snapshot.board.bossMaxHp ?? 0,
      // Ids used to be positional, so seed the monotonic counter above every id already in play.
      nextTileId: snapshot.board.nextTileId ?? highestTileId(tiles) + 1
    },
    runConfig: {
      ...snapshot.runConfig,
      layers: snapshot.runConfig.layers ?? 1
    }
  };
}

/**
 * Highest numeric suffix among existing tile ids, so a resumed run cannot mint an id that collides
 * with one already on the board. Ids are strings like `goblin-12` or `stone-30`; anything unparseable
 * (the hero's bare `'hero'`) contributes nothing.
 */
function highestTileId(tiles: RunSnapshot['board']['tiles']): number {
  return tiles.reduce((highest, tile) => {
    const suffix = Number.parseInt(tile.id.slice(tile.id.lastIndexOf('-') + 1), 10);

    return Number.isFinite(suffix) ? Math.max(highest, suffix) : highest;
  }, 0);
}

function readStoredSaveValue(): string | null {
  const current = localStorage.getItem(STORAGE_KEY);

  if (current) {
    return current;
  }

  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    const legacyValue = localStorage.getItem(legacyKey);

    if (legacyValue) {
      return legacyValue;
    }
  }

  return null;
}