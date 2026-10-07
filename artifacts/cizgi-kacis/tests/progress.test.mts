import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAPTER_BONUS_INK,
  DAILY_BONUS_INK,
  DAILY_TARGET,
  applyClear,
  applySurpriseClear,
  surpriseAvailable,
  dayDiff,
  defaultProgress,
  grantSkins,
  localDate,
  markStorySeen,
  hasSeenStory,
  migrateLegacy,
  nextSkinGoal,
  normalizeProgress,
  secretUnlocked,
  spendInk,
  touchDay,
} from '../lib/progress.ts';
import { CHAPTERS, chapterForLevel, isChapterEnd, isChapterStart, secretStarTarget } from '../lib/story.ts';

test('story chapters are contiguous and every finite chapter has an ending', () => {
  for (let i = 0; i < CHAPTERS.length - 1; i += 1) {
    const chapter = CHAPTERS[i];
    assert.ok(chapter.end !== null);
    assert.equal(CHAPTERS[i + 1].start, chapter.end + 1);
    assert.ok(chapter.ending && chapter.ending.tr.length > 0 && chapter.ending.en.length > 0);
    assert.ok(chapter.opening.tr.length > 0 && chapter.opening.en.length > 0);
  }
  assert.equal(CHAPTERS[CHAPTERS.length - 1].end, null);
  assert.equal(chapterForLevel(1).id, 'first-trace');
  assert.equal(chapterForLevel(8).id, 'portal-room');
  assert.equal(chapterForLevel(999).id, 'draft-pages');
  assert.equal(isChapterStart(3), true);
  assert.equal(isChapterEnd(4), true);
});

test('local date helpers do not use UTC', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayDiff('2026-02-28', '2026-03-01'), 1);
  assert.equal(dayDiff('2025-12-31', '2026-01-01'), 1);
});

test('day streak grows on consecutive days, resets after a gap, ignores same-day reopen', () => {
  let progress = defaultProgress();
  let step = touchDay(progress, '2026-05-01');
  assert.equal(step.progress.dayStreak, 1);
  assert.equal(step.firstVisitToday, true);

  progress = step.progress;
  step = touchDay(progress, '2026-05-01');
  assert.equal(step.firstVisitToday, false);
  assert.equal(step.progress.dayStreak, 1);

  step = touchDay(step.progress, '2026-05-02');
  assert.equal(step.progress.dayStreak, 2);
  assert.ok(step.newSkins.includes('mint'), 'the 2-day streak unlocks the mint stone');

  step = touchDay(step.progress, '2026-05-05');
  assert.equal(step.progress.dayStreak, 1);
  assert.equal(step.streakBroken, true);
  assert.equal(step.progress.bestDayStreak, 2, 'best streak is remembered');
});

test('clearing a level awards stars, ink, advances progress and counts for the daily quest', () => {
  const start = touchDay(defaultProgress(), '2026-05-01').progress;
  const { progress, result } = applyClear(start, { level: 1, failedAttempts: 0, riskBonus: 50, today: '2026-05-01' });
  assert.equal(result.stars, 3);
  assert.equal(result.firstClear, true);
  const dropInk = result.drop?.kind === 'ink' ? result.drop.amount : 0;
  assert.equal(result.inkEarned - dropInk, 3 * 4 + 2 + 6);
  assert.equal(progress.ink, result.inkEarned);
  assert.equal(progress.stars['1'], 3);
  assert.equal(progress.bestLevel, 2);
  assert.equal(progress.currentLevel, 2);
  assert.equal(result.dailyClears, 1);
  assert.equal(result.chapterCompleted, null);

  const replay = applyClear(progress, { level: 1, failedAttempts: 3, riskBonus: 0, today: '2026-05-01' });
  assert.equal(replay.progress.stars['1'], 3, 'a worse replay never lowers stars');
  assert.equal(replay.result.firstClear, false);
});

test('daily quest pays out exactly once per day and resets the next day', () => {
  let progress = touchDay(defaultProgress(), '2026-05-01').progress;
  let completed = 0;
  for (let i = 0; i < DAILY_TARGET + 2; i += 1) {
    const step = applyClear(progress, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
    progress = step.progress;
    if (step.result.dailyJustCompleted) completed += 1;
  }
  assert.equal(completed, 1);
  assert.equal(progress.dailiesCompleted, 1);
  assert.equal(progress.daily.claimed, true);

  const nextDay = touchDay(progress, '2026-05-02').progress;
  assert.deepEqual(nextDay.daily, { date: '2026-05-02', clears: 0, claimed: false });
  const first = applyClear(nextDay, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-02' });
  assert.equal(first.result.dailyClears, 1);
  assert.ok(DAILY_BONUS_INK > 0);
});

test('finishing the last level of a chapter completes it once, with bonus ink and the thorn-garden stone', () => {
  let progress = touchDay(defaultProgress(), '2026-05-01').progress;
  let last = applyClear(progress, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  last = applyClear(last.progress, { level: 2, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  assert.equal(last.result.chapterCompleted?.id, 'first-trace');
  assert.ok(last.result.inkEarned >= CHAPTER_BONUS_INK);

  const again = applyClear(last.progress, { level: 2, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  assert.equal(again.result.chapterCompleted, null, 'replaying does not re-trigger the chapter ending');

  progress = again.progress;
  let step = applyClear(progress, { level: 3, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  step = applyClear(step.progress, { level: 4, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  assert.equal(step.result.chapterCompleted?.id, 'thorn-garden');
  assert.ok(step.progress.skins.includes('violet'));
});

test('the artist note unlocks only once the chapter star target is reached', () => {
  const [first] = CHAPTERS;
  assert.equal(secretStarTarget(first), 5);
  let progress = touchDay(defaultProgress(), '2026-05-01').progress;
  const a = applyClear(progress, { level: 1, failedAttempts: 5, riskBonus: 0, today: '2026-05-01' });
  const b = applyClear(a.progress, { level: 2, failedAttempts: 5, riskBonus: 0, today: '2026-05-01' });
  assert.equal(secretUnlocked(b.progress, first), false);
  const c = applyClear(b.progress, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  assert.equal(secretUnlocked(c.progress, first), false, '3 + 1 stars is below the target of 5');
  const d = applyClear(c.progress, { level: 2, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' });
  assert.equal(secretUnlocked(d.progress, first), true);
  assert.equal(d.result.secretUnlockedFor?.id, 'first-trace');
});

test('ink can only be spent when affordable', () => {
  const progress = { ...defaultProgress(), ink: 19 };
  assert.equal(spendInk(progress, 20), null);
  assert.equal(spendInk({ ...progress, ink: 25 }, 20)?.ink, 5);
});

test('next skin goal points at the closest locked stone', () => {
  const progress = { ...defaultProgress(), stars: { '1': 3, '2': 3, '3': 3, '4': 2 }, bestDayStreak: 1, skins: ['coral', 'mint'] };
  const goal = nextSkinGoal(progress);
  assert.ok(goal);
  assert.equal(goal.skin.id, 'gold');
  assert.equal(goal.current, 11);
  assert.equal(goal.target, 15);
  assert.equal(grantSkins({ ...progress, stars: { ...progress.stars, '5': 3, '6': 3 } }).newSkins.includes('gold'), true);
});

test('legacy storage values migrate without losing stars, skins or scores', () => {
  const migrated = migrateLegacy({
    bestLevel: '6',
    stars: JSON.stringify({ '1': 3, '2': 2 }),
    skins: JSON.stringify(['coral', 'gold']),
    selectedSkin: 'gold',
    bestScore: '740',
    history: JSON.stringify([{ level: 2, score: 740, stars: 2, date: '2026-04-01' }]),
  });
  assert.equal(migrated.bestLevel, 6);
  assert.equal(migrated.currentLevel, 6);
  assert.equal(migrated.stars['1'], 3);
  assert.deepEqual(migrated.skins, ['coral', 'gold']);
  assert.equal(migrated.selectedSkin, 'gold');
  assert.equal(migrated.history.length, 1);
});

test('normalizeProgress repairs corrupt saves instead of throwing', () => {
  assert.deepEqual(normalizeProgress(null), defaultProgress());
  const repaired = normalizeProgress({ bestLevel: -4, ink: 'many', stars: { '1': 9 }, skins: [1, 'mint'], selectedSkin: 'gold' });
  assert.equal(repaired.bestLevel, 1);
  assert.equal(repaired.ink, 0);
  assert.equal(repaired.stars['1'], 3);
  assert.deepEqual(repaired.skins, ['coral', 'mint']);
  assert.equal(repaired.selectedSkin, 'coral');
});

test('story seen flags are idempotent', () => {
  let progress = defaultProgress();
  assert.equal(hasSeenStory(progress, 'open', 'first-trace'), false);
  progress = markStorySeen(progress, 'open', 'first-trace');
  progress = markStorySeen(progress, 'open', 'first-trace');
  assert.equal(hasSeenStory(progress, 'open', 'first-trace'), true);
  assert.equal(progress.seenStory.length, 1);
});

test('a pure clear (no ink line) pays a one-time bonus and is remembered', () => {
  const start = touchDay(defaultProgress(), '2026-05-01').progress;
  const first = applyClear(start, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01', pure: true });
  assert.equal(first.result.pureFirst, true);
  assert.deepEqual(first.progress.pure, ['1']);
  const again = applyClear(first.progress, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01', pure: true });
  assert.equal(again.result.pureFirst, false);
  assert.deepEqual(again.progress.pure, ['1']);
  const notPure = applyClear(start, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01', pure: false });
  assert.deepEqual(notPure.progress.pure, []);
});

test('the winning route is saved for the gallery and only replaced by an equal or better clear', () => {
  const start = touchDay(defaultProgress(), '2026-05-01').progress;
  const route = [[500, 900], [500, 500], [500, 100]];
  const good = applyClear(start, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01', trail: route });
  assert.deepEqual(good.progress.trails['1'], route);
  const worse = applyClear(good.progress, { level: 1, failedAttempts: 4, riskBonus: 0, today: '2026-05-01', trail: [[1, 1], [2, 2]] });
  assert.deepEqual(worse.progress.trails['1'], route);
});

test('drops grant what they promise and the pity timer resets', () => {
  let progress = touchDay(defaultProgress(), '2026-05-01').progress;
  let sawDrop = false;
  for (let i = 0; i < 40 && !sawDrop; i += 1) {
    const step = applyClear(progress, { level: 1 + (i % 2), failedAttempts: i % 4, riskBonus: 0, today: '2026-05-01' });
    progress = step.progress;
    const drop = step.result.drop;
    if (!drop) continue;
    sawDrop = true;
    assert.equal(progress.dropMisses, 0);
    if (drop.kind === 'skin') assert.ok(progress.skins.includes(drop.id));
    if (drop.kind === 'card') assert.ok(progress.cards.includes(drop.id));
  }
  assert.ok(sawDrop, 'a drop must arrive within 40 clears thanks to the pity timer');
});

test('rare stones can never be earned by progress alone', () => {
  const rich = { ...defaultProgress(), bestLevel: 99, bestDayStreak: 99, stars: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i + 1), 3])) };
  const granted = grantSkins(rich).progress.skins;
  assert.ok(!granted.includes('galaxy') && !granted.includes('ember'));
  assert.ok(nextSkinGoal({ ...rich, skins: ['coral', 'mint', 'gold', 'violet', 'ice'] }) === null, 'drop-only stones are never suggested as a goal');
});

test('the daily surprise pays once per day, a bonus page always pays', () => {
  const base = { ...defaultProgress(), bestLevel: 6 };
  assert.equal(surpriseAvailable(base, '2026-05-01'), true);
  assert.equal(surpriseAvailable({ ...base, bestLevel: 2 }, '2026-05-01'), false, 'needs level 3 first');
  const first = applySurpriseClear(base, 'surprise', '2026-05-01');
  assert.ok(first.inkEarned > 0);
  assert.equal(surpriseAvailable(first.progress, '2026-05-01'), false);
  assert.equal(applySurpriseClear(first.progress, 'surprise', '2026-05-01').inkEarned, 0);
  assert.equal(surpriseAvailable(first.progress, '2026-05-02'), true);
  assert.ok(applySurpriseClear(first.progress, 'bonus', '2026-05-01').inkEarned > 0);
});
