import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Progress, defaultProgress, migrateLegacy, normalizeProgress } from './progress.ts';

const PROGRESS_KEY = '@cizgi-kacis/progress-v2';

// Keys used before progress-v2. Read once so existing players keep their stars, skins and scores.
const LEGACY_KEYS = {
  bestLevel: '@cizgi-kacis/best-level',
  stars: '@cizgi-kacis/level-stars',
  skins: '@cizgi-kacis/stone-skins',
  selectedSkin: '@cizgi-kacis/selected-skin',
  bestScore: '@cizgi-kacis/best-score',
  history: '@cizgi-kacis/score-history',
} as const;

export async function loadProgress(): Promise<Progress> {
  try {
    const stored = await AsyncStorage.getItem(PROGRESS_KEY);
    if (stored) return normalizeProgress(JSON.parse(stored));
    const names = Object.keys(LEGACY_KEYS) as Array<keyof typeof LEGACY_KEYS>;
    const values = await AsyncStorage.multiGet(names.map((name) => LEGACY_KEYS[name]));
    const legacy: Record<string, string | null> = {};
    names.forEach((name, index) => {
      legacy[name] = values[index]?.[1] ?? null;
    });
    return migrateLegacy(legacy);
  } catch {
    return defaultProgress();
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  try {
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Saving is best-effort; the game must stay playable if storage is unavailable.
  }
}
