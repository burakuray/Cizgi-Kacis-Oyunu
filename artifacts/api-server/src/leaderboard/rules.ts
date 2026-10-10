/**
 * Pure leaderboard rules shared by the HTTP layer and the tests: nickname hygiene, which scores are
 * possible at all, and how players are ordered. No imports, so it runs under plain Node.
 */

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const MAX_LEVELS = 500;
export const MAX_PAGE = 100;

const RESERVED = ["admin", "administrator", "moderator", "mod", "system", "sistem", "yonetici", "yönetici", "support", "destek", "claude", "anthropic"];

export type NicknameResult = { ok: true; nickname: string } | { ok: false; reason: "type" | "length" | "chars" | "reserved" };

/** Letters, digits, spaces and _ . - only; 3-16 characters; no impersonation of staff names. */
export function sanitizeNickname(raw: unknown, operatorBlocklist: string[] = []): NicknameResult {
  if (typeof raw !== "string") return { ok: false, reason: "type" };
  const cleaned = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const length = [...cleaned].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return { ok: false, reason: "length" };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u.test(cleaned)) return { ok: false, reason: "chars" };
  const folded = cleaned.toLocaleLowerCase("en").replace(/[ _.\-]/gu, "");
  if (RESERVED.includes(folded)) return { ok: false, reason: "reserved" };
  if (operatorBlocklist.some((word) => word.length >= 2 && folded.includes(word.toLocaleLowerCase("en").replace(/[ _.\-]/gu, "")))) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, nickname: cleaned };
}

/*
 * What a clear can be worth (mirrors scoreForLevel in the game): level*100 + up to 300 for clean play
 * + up to 192 risk bonus, and never less than 100. A player's total is the sum of their best score per level.
 */
export const MIN_SCORE_PER_LEVEL = 100;
export const maxScoreForLevel = (level: number) => level * 100 + 300 + 192;

export function maxPossibleScore(levelsCleared: number): number {
  let total = 0;
  for (let level = 1; level <= levelsCleared; level += 1) total += maxScoreForLevel(level);
  return total;
}

export type ScoreSubmission = { score: number; levelsCleared: number; stars: number; bestLevel: number };
export type SubmissionResult = { ok: true; value: ScoreSubmission } | { ok: false; reason: string };

const isCount = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/** Rejects numbers the game cannot produce. This is a plausibility check, not proof (see docs/LEADERBOARD.md). */
export function parseSubmission(body: unknown): SubmissionResult {
  if (!body || typeof body !== "object") return { ok: false, reason: "body" };
  const { score, levelsCleared, stars, bestLevel } = body as Record<string, unknown>;
  if (!isCount(levelsCleared, MAX_LEVELS)) return { ok: false, reason: "levelsCleared" };
  if (!isCount(stars, 3 * MAX_LEVELS) || stars > 3 * levelsCleared) return { ok: false, reason: "stars" };
  if (!isCount(bestLevel, MAX_LEVELS + 2) || bestLevel < levelsCleared || bestLevel > levelsCleared + 2) return { ok: false, reason: "bestLevel" };
  if (!isCount(score, maxPossibleScore(MAX_LEVELS))) return { ok: false, reason: "score" };
  if (score < MIN_SCORE_PER_LEVEL * levelsCleared) return { ok: false, reason: "scoreTooLow" };
  if (score > maxPossibleScore(levelsCleared)) return { ok: false, reason: "scoreTooHigh" };
  return { ok: true, value: { score, levelsCleared, stars, bestLevel } };
}

/** Only progress is accepted: a total never goes down, so an old copy of the game cannot overwrite a better one. */
export function isImprovement(current: ScoreSubmission, next: ScoreSubmission): boolean {
  return next.score > current.score || (next.score === current.score && (next.levelsCleared > current.levelsCleared || next.stars > current.stars));
}

export type Rankable = { id: string; score: number; scoreUpdatedAt: Date };

/** Higher score first; on a tie, whoever reached it first; then id so the order is total and stable. */
export function compareRank(a: Rankable, b: Rankable): number {
  return b.score - a.score || a.scoreUpdatedAt.getTime() - b.scoreUpdatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function clampLimit(raw: unknown, fallback = 50): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(value)));
}
