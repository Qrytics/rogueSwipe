import type { PersistentProgress, RunSnapshot, SaveData } from './types';

const STORAGE_KEY = 'rogueSwipe.save.v1';

const DEFAULT_META: PersistentProgress = {
  bankedGold: 0,
  completedRuns: 0,
  bestTurnsSurvived: 0,
  permanentMaxHpBonus: 0,
  permanentAttackBonus: 0
};

export function loadSaveData(): SaveData {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return { meta: { ...DEFAULT_META }, activeRun: null };
    }

    const parsed = JSON.parse(rawValue) as Partial<SaveData>;

    return {
      meta: mergeMeta(parsed.meta),
      activeRun: parsed.activeRun ?? null
    };
  } catch {
    return { meta: { ...DEFAULT_META }, activeRun: null };
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
    meta,
    activeRun: current.activeRun
  });
}

export function saveActiveRun(snapshot: RunSnapshot): void {
  const current = loadSaveData();
  saveSaveData({
    meta: current.meta,
    activeRun: snapshot
  });
}

export function clearActiveRun(): void {
  const current = loadSaveData();
  saveSaveData({
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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