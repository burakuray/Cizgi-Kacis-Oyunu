/**
 * Progression rules. Pure functions only (no React Native / AsyncStorage) so they can be unit-tested.
 * Persistence lives in `progressStore.ts`.
 *
 * Why these systems exist (each one is a reason to come back):
 *  - day streak ........ "come back tomorrow" (also unlocks a stone)
 *  - daily quest ....... clear 3 levels today for bonus ink
 *  - ink ............... currency that buys a second chance instead of being demoted
 *  - stars + 3-star .... replay old levels; unlock stones and the Artist's secret notes
 *  - story chapters .... cliffhanger endings pull the player into the next chapter
 */
import { type Chapter, chapterById, chapterForLevel, secretStarTarget } from './story.ts';

export const REVIVE_COST = 20;
export const DAILY_TARGET = 3;
export const DAILY_BONUS_INK = 25;
export const CHAPTER_BONUS_INK = 40;
export const MAX_HISTORY = 20;

export type ScoreEntry = { level: number; score: number; stars: number; date: string };

export type SkinRequirement =
  | { type: 'free' }
  | { type: 'dayStreak'; target: number }
  | { type: 'stars'; target: number }
  | { type: 'perfect'; target: number }
  | { type: 'chapter'; chapterId: string };

export type Skin = { id: string; color: string; requirement: SkinRequirement };

export const SKINS: Skin[] = [
  { id: 'coral', color: '#F28C66', requirement: { type: 'free' } },
  { id: 'mint', color: '#B8E7D4', requirement: { type: 'dayStreak', target: 2 } },
  { id: 'gold', color: '#FFD5A6', requirement: { type: 'stars', target: 15 } },
  { id: 'violet', color: '#B79BFF', requirement: { type: 'chapter', chapterId: 'thorn-garden' } },
  { id: 'ice', color: '#8FD3FF', requirement: { type: 'perfect', target: 5 } },
];

export type DailyState = { date: string; clears: number; claimed: boolean };

export type Progress = {
  version: 2;
  currentLevel: number;
  bestLevel: number;
  bestScore: number;
  stars: Record<string, number>;
  ink: number;
  dayStreak: number;
  bestDayStreak: number;
  lastPlayedDate: string | null;
  daily: DailyState;
  dailiesCompleted: number;
  skins: string[];
  selectedSkin: string;
  seenStory: string[];
  history: ScoreEntry[];
};

export function defaultProgress(): Progress {
  return {
    version: 2,
    currentLevel: 1,
    bestLevel: 1,
    bestScore: 0,
    stars: {},
    ink: 0,
    dayStreak: 0,
    bestDayStreak: 0,
    lastPlayedDate: null,
    daily: { date: '', clears: 0, claimed: false },
    dailiesCompleted: 0,
    skins: ['coral'],
    selectedSkin: 'coral',
    seenStory: [],
    history: [],
  };
}

/* ---------- dates ---------- */

/** Local calendar date (YYYY-MM-DD). `toISOString()` is UTC and would roll the day over at 03:00 in Turkey. */
export function localDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/* ---------- scoring ---------- */

export function starsForAttempts(failedAttempts: number): number {
  if (failedAttempts === 0) return 3;
  if (failedAttempts <= 2) return 2;
  return 1;
}

export function scoreForLevel(level: number, failedAttempts: number, riskBonus: number): number {
  return Math.max(100, level * 100 + Math.max(0, 300 - failedAttempts * 90) + riskBonus);
}

/* ---------- derived values ---------- */

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((sum, value) => sum + value, 0);
}

export function perfectLevels(progress: Progress): number {
  return Object.values(progress.stars).filter((value) => value >= 3).length;
}

export function chapterStars(progress: Progress, chapter: Chapter): number {
  if (chapter.end === null) return 0;
  let sum = 0;
  for (let level = chapter.start; level <= chapter.end; level += 1) sum += progress.stars[String(level)] ?? 0;
  return sum;
}

export function isChapterCompleted(progress: Progress, chapter: Chapter): boolean {
  return chapter.end !== null && progress.bestLevel > chapter.end;
}

export function isChapterReached(progress: Progress, chapter: Chapter): boolean {
  return progress.bestLevel >= chapter.start;
}

export function secretUnlocked(progress: Progress, chapter: Chapter): boolean {
  return chapter.secret !== null && chapterStars(progress, chapter) >= secretStarTarget(chapter);
}

/** Daily quest state as it should be shown today (resets when the date changed). */
export function dailyFor(progress: Progress, today: string): DailyState {
  return progress.daily.date === today ? progress.daily : { date: today, clears: 0, claimed: false };
}

/* ---------- skins ---------- */

export function skinProgress(progress: Progress, skin: Skin): { current: number; target: number } {
  const req = skin.requirement;
  switch (req.type) {
    case 'free':
      return { current: 1, target: 1 };
    case 'dayStreak':
      return { current: Math.min(progress.bestDayStreak, req.target), target: req.target };
    case 'stars':
      return { current: Math.min(totalStars(progress), req.target), target: req.target };
    case 'perfect':
      return { current: Math.min(perfectLevels(progress), req.target), target: req.target };
    case 'chapter': {
      const chapter = chapterById(req.chapterId);
      return { current: chapter && isChapterCompleted(progress, chapter) ? 1 : 0, target: 1 };
    }
  }
}

export function skinRequirementMet(progress: Progress, skin: Skin): boolean {
  const { current, target } = skinProgress(progress, skin);
  return current >= target;
}

/** Grants every skin whose requirement is met. Returns the new progress and the newly granted ids. */
export function grantSkins(progress: Progress): { progress: Progress; newSkins: string[] } {
  const newSkins = SKINS.filter((skin) => !progress.skins.includes(skin.id) && skinRequirementMet(progress, skin)).map((skin) => skin.id);
  if (newSkins.length === 0) return { progress, newSkins };
  return { progress: { ...progress, skins: [...progress.skins, ...newSkins] }, newSkins };
}

export function selectSkin(progress: Progress, skinId: string): Progress {
  return progress.skins.includes(skinId) ? { ...progress, selectedSkin: skinId } : progress;
}

export function skinColor(skinId: string): string {
  return (SKINS.find((skin) => skin.id === skinId) ?? SKINS[0]).color;
}

/** The locked skin the player is closest to (used for the "one more level" nudge). */
export function nextSkinGoal(progress: Progress): { skin: Skin; current: number; target: number } | null {
  let best: { skin: Skin; current: number; target: number; ratio: number } | null = null;
  for (const skin of SKINS) {
    if (progress.skins.includes(skin.id)) continue;
    const { current, target } = skinProgress(progress, skin);
    const ratio = current / target;
    if (!best || ratio > best.ratio) best = { skin, current, target, ratio };
  }
  return best ? { skin: best.skin, current: best.current, target: best.target } : null;
}

/* ---------- day streak ---------- */

export type TouchDayResult = {
  progress: Progress;
  firstVisitToday: boolean;
  streakBroken: boolean;
  newSkins: string[];
};

/** Call once when the app opens. Advances (or resets) the day streak and rolls the daily quest over. */
export function touchDay(progress: Progress, today: string): TouchDayResult {
  if (progress.lastPlayedDate === today) {
    return { progress: { ...progress, daily: dailyFor(progress, today) }, firstVisitToday: false, streakBroken: false, newSkins: [] };
  }
  const gap = progress.lastPlayedDate ? dayDiff(progress.lastPlayedDate, today) : null;
  let dayStreak: number;
  if (gap === 1) dayStreak = progress.dayStreak + 1;
  else if (gap !== null && gap < 1) dayStreak = Math.max(1, progress.dayStreak); // device clock moved backwards
  else dayStreak = 1;
  const streakBroken = gap !== null && gap > 1 && progress.dayStreak > 1;
  const advanced: Progress = {
    ...progress,
    dayStreak,
    bestDayStreak: Math.max(progress.bestDayStreak, dayStreak),
    lastPlayedDate: today,
    daily: { date: today, clears: 0, claimed: false },
  };
  const granted = grantSkins(advanced);
  return { progress: granted.progress, firstVisitToday: true, streakBroken, newSkins: granted.newSkins };
}

/* ---------- level clear ---------- */

export type ClearResult = {
  stars: number;
  previousStars: number;
  score: number;
  inkEarned: number;
  firstClear: boolean;
  newBestScore: boolean;
  chapterCompleted: Chapter | null;
  secretUnlockedFor: Chapter | null;
  newSkins: string[];
  dailyClears: number;
  dailyJustCompleted: boolean;
};

export function applyClear(
  progress: Progress,
  input: { level: number; failedAttempts: number; riskBonus: number; today: string },
): { progress: Progress; result: ClearResult } {
  const { level, failedAttempts, riskBonus, today } = input;
  const key = String(level);
  const previousStars = progress.stars[key] ?? 0;
  const firstClear = previousStars === 0;
  const stars = starsForAttempts(failedAttempts);
  const score = scoreForLevel(level, failedAttempts, riskBonus);
  const chapter = chapterForLevel(level);
  const chapterCompleted = chapter.end === level && progress.bestLevel <= level ? chapter : null;
  const secretWasUnlocked = secretUnlocked(progress, chapter);

  const daily = dailyFor(progress, today);
  const dailyClears = Math.min(DAILY_TARGET, daily.clears + 1);
  const dailyJustCompleted = dailyClears >= DAILY_TARGET && !daily.claimed;

  let inkEarned = stars * 4 + Math.floor(riskBonus / 25) + (firstClear ? 6 : 0);
  if (chapterCompleted) inkEarned += CHAPTER_BONUS_INK;
  if (dailyJustCompleted) inkEarned += DAILY_BONUS_INK;

  const history = [...progress.history, { level, score, stars, date: today }].sort((a, b) => b.score - a.score).slice(0, MAX_HISTORY);
  const updated: Progress = {
    ...progress,
    stars: { ...progress.stars, [key]: Math.max(previousStars, stars) },
    bestLevel: Math.max(progress.bestLevel, level + 1),
    currentLevel: level + 1,
    bestScore: Math.max(progress.bestScore, score),
    ink: progress.ink + inkEarned,
    daily: { date: today, clears: dailyClears, claimed: daily.claimed || dailyJustCompleted },
    dailiesCompleted: progress.dailiesCompleted + (dailyJustCompleted ? 1 : 0),
    history,
  };
  const granted = grantSkins(updated);
  return {
    progress: granted.progress,
    result: {
      stars,
      previousStars,
      score,
      inkEarned,
      firstClear,
      newBestScore: score > progress.bestScore,
      chapterCompleted,
      secretUnlockedFor: !secretWasUnlocked && secretUnlocked(granted.progress, chapter) ? chapter : null,
      newSkins: granted.newSkins,
      dailyClears,
      dailyJustCompleted,
    },
  };
}

/* ---------- ink, level, story bookkeeping ---------- */

export function spendInk(progress: Progress, cost: number): Progress | null {
  return progress.ink >= cost ? { ...progress, ink: progress.ink - cost } : null;
}

export function setCurrentLevel(progress: Progress, level: number): Progress {
  const safe = Math.max(1, Math.floor(level));
  return progress.currentLevel === safe ? progress : { ...progress, currentLevel: safe, bestLevel: Math.max(progress.bestLevel, safe) };
}

export type StoryKind = 'open' | 'end';

export function storyKey(kind: StoryKind, chapterId: string): string {
  return `${kind}:${chapterId}`;
}

export function hasSeenStory(progress: Progress, kind: StoryKind, chapterId: string): boolean {
  return progress.seenStory.includes(storyKey(kind, chapterId));
}

export function markStorySeen(progress: Progress, kind: StoryKind, chapterId: string): Progress {
  const key = storyKey(kind, chapterId);
  return progress.seenStory.includes(key) ? progress : { ...progress, seenStory: [...progress.seenStory, key] };
}

/* ---------- persistence helpers (pure) ---------- */

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Repairs unknown JSON into a valid Progress so a corrupt or older save can never crash the game. */
export function normalizeProgress(raw: unknown): Progress {
  const base = defaultProgress();
  if (!raw || typeof raw !== 'object') return base;
  const source = raw as Record<string, unknown>;
  const skins = Array.isArray(source.skins) ? source.skins.filter((id): id is string => typeof id === 'string') : base.skins;
  const grantedSkins = skins.includes('coral') ? skins : ['coral', ...skins];
  const selected = typeof source.selectedSkin === 'string' && grantedSkins.includes(source.selectedSkin) ? source.selectedSkin : 'coral';
  const bestLevel = Math.max(1, Math.floor(asNumber(source.bestLevel, 1)));
  const dailyRaw = (source.daily ?? {}) as Record<string, unknown>;
  const stars: Record<string, number> = {};
  if (source.stars && typeof source.stars === 'object') {
    for (const [level, value] of Object.entries(source.stars as Record<string, unknown>)) {
      stars[level] = Math.min(3, Math.max(0, Math.floor(asNumber(value, 0))));
    }
  }
  return {
    version: 2,
    bestLevel,
    currentLevel: Math.min(bestLevel, Math.max(1, Math.floor(asNumber(source.currentLevel, 1)))),
    bestScore: Math.max(0, asNumber(source.bestScore, 0)),
    stars,
    ink: Math.max(0, Math.floor(asNumber(source.ink, 0))),
    dayStreak: Math.max(0, Math.floor(asNumber(source.dayStreak, 0))),
    bestDayStreak: Math.max(0, Math.floor(asNumber(source.bestDayStreak, 0))),
    lastPlayedDate: typeof source.lastPlayedDate === 'string' ? source.lastPlayedDate : null,
    daily: {
      date: typeof dailyRaw.date === 'string' ? dailyRaw.date : '',
      clears: Math.min(DAILY_TARGET, Math.max(0, Math.floor(asNumber(dailyRaw.clears, 0)))),
      claimed: dailyRaw.claimed === true,
    },
    dailiesCompleted: Math.max(0, Math.floor(asNumber(source.dailiesCompleted, 0))),
    skins: grantedSkins,
    selectedSkin: selected,
    seenStory: Array.isArray(source.seenStory) ? source.seenStory.filter((id): id is string => typeof id === 'string') : [],
    history: Array.isArray(source.history) ? (source.history as ScoreEntry[]).filter((entry) => entry && typeof entry.score === 'number').slice(0, MAX_HISTORY) : [],
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Builds a v2 Progress from the old per-key AsyncStorage values so existing players keep everything. */
export function migrateLegacy(legacy: Record<string, string | null | undefined>): Progress {
  const base = defaultProgress();
  const bestLevel = Math.max(1, Number(legacy.bestLevel ?? 1) || 1);
  const skins = parseJson<string[]>(legacy.skins, ['coral']);
  return normalizeProgress({
    ...base,
    bestLevel,
    currentLevel: bestLevel,
    bestScore: Number(legacy.bestScore ?? 0) || 0,
    stars: parseJson<Record<string, number>>(legacy.stars, {}),
    skins,
    selectedSkin: legacy.selectedSkin ?? 'coral',
    history: parseJson<ScoreEntry[]>(legacy.history, []),
  });
}
