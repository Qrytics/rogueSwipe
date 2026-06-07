import type { PersistentProgress, RunSnapshot, SaveData } from './types';

const STORAGE_KEY = 'rogueSwipe.save.v2';
const LEGACY_STORAGE_KEYS = ['rogueSwipe.save.v1'];
const CURRENT_SCHEMA_VERSION = 2;

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
  } catch {
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

export function recordRunCompletion(turnsSurvived: number, goldEarned: number, victory: boolean): PersistentProgress {
  const current = loadMetaProgress();

  const nextMeta: PersistentProgress = {
    bankedGold: current.bankedGold + goldEarned + (victory ? 15 : 0),
    completedRuns: current.completedRuns + 1,
    bestTurnsSurvived: Math.max(current.bestTurnsSurvived, turnsSurvived),
    permanentMaxHpBonus: current.permanentMaxHpBonus + (victory ? 1 : 0),
    permanentAttackBonus: current.permanentAttackBonus + (victory ? 1 : 0)
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
    permanentMaxHpBonus: meta?.permanentMaxHpBonus ?? DEFAULT_META.permanentMaxHpBonus,
    permanentAttackBonus: meta?.permanentAttackBonus ?? DEFAULT_META.permanentAttackBonus
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

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    activeRun: raw.activeRun ? migrateRunSnapshot(raw.activeRun) : null
  };
}

function migrateRunSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    board: {
      ...snapshot.board,
      bossTurnsElapsed: snapshot.board.bossTurnsElapsed ?? 0,
      bossAttackCountdown: snapshot.board.bossAttackCountdown ?? 0,
      bossAttackAxis: snapshot.board.bossAttackAxis ?? 'row',
      bossAttackLine: snapshot.board.bossAttackLine ?? 0,
      heroLevel: snapshot.board.heroLevel ?? 1,
      heroMaxHp: snapshot.board.heroMaxHp ?? snapshot.board.tiles.find((tile) => tile.kind === 'hero')?.hp ?? 5,
      spellCharges: snapshot.board.spellCharges ?? 1,
      spellMaxCharges: snapshot.board.spellMaxCharges ?? 3,
      mode: snapshot.board.mode ?? snapshot.runConfig.mode,
      phase: snapshot.board.phase ?? 'run'
    }
  };
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