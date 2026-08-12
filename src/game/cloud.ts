import type { PersistentProgress } from './types';

const CLOUD_USER_KEY = 'rogueSwipe.cloudUserId.v1';

type CloudConfig = {
  url: string;
  anonKey: string;
};

type CloudSyncResult = {
  synced: boolean;
  message: string;
};

function getCloudConfig(): CloudConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

function getAnonymousCloudUserId(): string {
  const existing = localStorage.getItem(CLOUD_USER_KEY);

  if (existing) {
    return existing;
  }

  const generated = globalThis.crypto?.randomUUID?.() ?? `anon-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  localStorage.setItem(CLOUD_USER_KEY, generated);

  return generated;
}

export function hasCloudSync(): boolean {
  return getCloudConfig() !== null;
}

export function getCloudIdentityLabel(): string {
  return getAnonymousCloudUserId().slice(0, 8);
}

export async function syncMetaProgressToCloud(meta: PersistentProgress): Promise<CloudSyncResult> {
  const config = getCloudConfig();

  if (!config) {
    return { synced: false, message: 'Cloud sync is not configured.' };
  }

  const userId = getAnonymousCloudUserId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/rogueswipe_profiles?on_conflict=user_id`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        banked_gold: meta.bankedGold,
        completed_runs: meta.completedRuns,
        best_turns_survived: meta.bestTurnsSurvived,
        permanent_max_hp_bonus: meta.permanentMaxHpBonus,
        permanent_attack_bonus: meta.permanentAttackBonus,
        updated_at: new Date().toISOString()
      })
    });

    if (!response.ok) {
      return {
        synced: false,
        message: `Cloud sync failed (${response.status}).`
      };
    }

    return {
      synced: true,
      message: `Cloud sync saved for ${userId.slice(0, 8)}.`
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { synced: false, message: 'Cloud sync timed out.' };
    }
    return { synced: false, message: 'Cloud sync error.' };
  } finally {
    clearTimeout(timeoutId);
  }
}