/** The game's score must always be a score the server accepts, and must never lose points. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubmission, maxScoreForLevel, MIN_SCORE_PER_LEVEL } from '../../api-server/src/leaderboard/rules.ts';
import { rng } from '../lib/mechanics.ts';
import { MIN_LEVEL_SCORE, applyClear, defaultProgress, leaderboardSnapshot, maxLevelScore, migrateLegacy, normalizeProgress, scoreForLevel, totalScore, touchDay } from '../lib/progress.ts';

const start = () => touchDay(defaultProgress(), '2026-05-01').progress;

test('client and server agree on what one level can be worth', () => {
  assert.equal(MIN_LEVEL_SCORE, MIN_SCORE_PER_LEVEL);
  for (let level = 1; level <= 200; level += 1) {
    assert.equal(maxLevelScore(level), maxScoreForLevel(level));
    // the best the game can ever give: no failures and the largest risk bonus the physics allows
    assert.ok(scoreForLevel(level, 0, 192) <= maxLevelScore(level), `level ${level}`);
    assert.ok(scoreForLevel(level, 9, 0) >= MIN_LEVEL_SCORE);
  }
});

test('every score a real run can produce passes the server checks, and the total only ever grows', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const random = rng(seed);
    let progress = start();
    let previous = 0;
    for (let step = 0; step < 80; step += 1) {
      const frontier = progress.bestLevel;
      const replay = step > 5 && random() < 0.3;
      const level = replay ? 1 + Math.floor(random() * (frontier - 1)) : frontier;
      progress = applyClear(progress, { level, failedAttempts: Math.floor(random() * 6), riskBonus: Math.floor(random() * 129), today: '2026-05-01' }).progress;
      const snapshot = leaderboardSnapshot(progress);
      const verdict = parseSubmission(snapshot);
      assert.ok(verdict.ok, `seed ${seed} step ${step}: server would refuse ${JSON.stringify(snapshot)} (${verdict.ok ? '' : verdict.reason})`);
      assert.ok(snapshot.score >= previous, `seed ${seed} step ${step}: the total went down (${previous} -> ${snapshot.score})`);
      previous = snapshot.score;
    }
  }
});

test('the total is the sum of the best score on each cleared level', () => {
  let progress = start();
  progress = applyClear(progress, { level: 1, failedAttempts: 0, riskBonus: 0, today: '2026-05-01' }).progress;
  progress = applyClear(progress, { level: 2, failedAttempts: 2, riskBonus: 40, today: '2026-05-01' }).progress;
  const expected = scoreForLevel(1, 0, 0) + scoreForLevel(2, 2, 40);
  assert.equal(totalScore(progress), expected);
  // a worse replay of level 1 does not lower it, a better one raises it
  progress = applyClear(progress, { level: 1, failedAttempts: 5, riskBonus: 0, today: '2026-05-01' }).progress;
  assert.equal(totalScore(progress), expected);
  progress = applyClear(progress, { level: 1, failedAttempts: 0, riskBonus: 100, today: '2026-05-01' }).progress;
  assert.equal(totalScore(progress), scoreForLevel(1, 0, 100) + scoreForLevel(2, 2, 40));
  assert.deepEqual(leaderboardSnapshot(progress), { score: totalScore(progress), levelsCleared: 2, stars: 5, bestLevel: 3 });
});

test('a new player has nothing to submit, and players from before scores were stored keep their points', () => {
  assert.deepEqual(leaderboardSnapshot(defaultProgress()), { score: 0, levelsCleared: 0, stars: 0, bestLevel: 1 });
  const legacy = migrateLegacy({
    bestLevel: '5',
    stars: JSON.stringify({ '1': 3, '2': 2, '3': 3, '4': 1 }),
    history: JSON.stringify([{ level: 4, score: 640, stars: 1, date: '2026-04-01' }, { level: 1, score: 520, stars: 3, date: '2026-04-01' }]),
  });
  const snapshot = leaderboardSnapshot(legacy);
  assert.equal(snapshot.levelsCleared, 4);
  assert.equal(snapshot.stars, 3 + 2 + 3 + 1);
  assert.ok(parseSubmission(snapshot).ok);
  // levels with a remembered score use it, the others are rebuilt from their stars with the same formula
  assert.equal(legacy.levelScores['4'], 640);
  assert.equal(snapshot.score, 520 + scoreForLevel(2, 1, 0) + scoreForLevel(3, 0, 0) + 640);
});

test('corrupt local data cannot produce a score the server would reject', () => {
  const broken = normalizeProgress({ bestLevel: 12, stars: { '1': 9, '2': -4 }, levelScores: { '1': 99_999_999, '2': -5, '3': 'x' } });
  const snapshot = leaderboardSnapshot(broken);
  assert.ok(parseSubmission(snapshot).ok, JSON.stringify(parseSubmission(snapshot)));
  assert.ok(snapshot.score <= Array.from({ length: 11 }, (_, i) => maxLevelScore(i + 1)).reduce((a, b) => a + b, 0));
});
