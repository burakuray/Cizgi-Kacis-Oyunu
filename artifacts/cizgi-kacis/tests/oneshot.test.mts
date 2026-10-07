/**
 * The design rule behind every page: you can NEVER get from the start to the exit with a single shot.
 * It is guaranteed by physics (the strongest shot stops short of the exit) and checked here by brute force.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SHOT_SPEED, STOP_SPEED, makeCourse, shotRange, wallLayout } from '../game-logic.ts';
import { buildLevel, minShots, oneShotSolutions } from '../lib/solver.ts';
import { frictionFor } from '../lib/mechanics.ts';

const SIZES: Array<[number, number]> = [[360, 460], [360, 520], [360, 600], [390, 700]];

test('the strongest shot always stops short of the exit, on every screen height', () => {
  for (const height of [420, 460, 520, 600, 700, 800]) {
    const friction = frictionFor(null, height);
    let speed = MAX_SHOT_SPEED;
    let distance = 0;
    while (speed >= STOP_SPEED) {
      distance += speed;
      speed *= friction;
    }
    const startToExit = height - 57 - 51;
    assert.ok(distance < startToExit * 0.7, `height ${height}: a shot travels ${distance.toFixed(0)}px of ${startToExit}px`);
    assert.ok(Math.abs(distance - shotRange(height)) / shotRange(height) < 0.05, `height ${height}: range formula is accurate`);
  }
});

test('no sampled single shot reaches the exit on any level or screen size (levels 1-40)', () => {
  for (const [w, h] of SIZES) {
    for (let level = 1; level <= 40; level += 1) {
      const wins = oneShotSolutions(buildLevel(level, w, h), 72, [2.5, 4.4, 6, 7.1]);
      assert.equal(wins.length, 0, `level ${level} ${w}x${h} can be cleared with ONE shot (${wins.length} solutions)`);
    }
  }
});

test('pages stay solvable: found within a handful of shots', () => {
  for (const level of [1, 2, 3, 4, 6, 8]) {
    const shots = minShots(buildLevel(level, 360, 520), 7, 30, 96, [1.8, 2.6, 3.4, 4.2, 5, 5.8, 6.5, 7.1]);
    assert.ok(shots >= 2, `level ${level}: needs at least two shots`);
    assert.ok(shots <= 6, `level ${level}: should be solvable in six shots or fewer (got ${shots})`);
  }
});

test('walls alternate sides so the stone cannot just fly straight up', () => {
  for (const [w, h] of SIZES) {
    for (let level = 1; level <= 30; level += 1) {
      const walls = makeCourse(level, w, h).filter((s) => s.y1 === s.y2);
      assert.ok(walls.length >= 4, `level ${level}: at least two walls with a gap each`);
      const gaps = wallLayout(level, w, h);
      for (let i = 1; i < gaps.length; i += 1) {
        assert.ok((gaps[i - 1].x < w / 2) !== (gaps[i].x < w / 2), `level ${level}: gaps must alternate sides`);
      }
    }
  }
});
