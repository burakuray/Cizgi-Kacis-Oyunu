/** Portals are shortcuts for the player: one-way, placed where they help, and never a trap. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOLE_RADIUS, STONE_RADIUS, distanceToSegment, exitPoint, makeCourse, makePortals, resolvePortalEntry, shotRange, startPoint, wallLayout,
} from '../game-logic.ts';

const SIZES: Array<[number, number]> = [[360, 460], [360, 520], [360, 600], [390, 700]];

test('portal entrances are reachable, exits are beyond a wall and in line above the entrance', () => {
  let checked = 0;
  for (const [w, h] of SIZES) {
    for (let level = 1; level <= 40; level += 1) {
      const walls = makeCourse(level, w, h).filter((s) => s.y1 === s.y2);
      for (const pair of makePortals(level, w, h)) {
        checked += 1;
        assert.ok(pair.b.y < pair.a.y - 40, `level ${level}: the exit must be well above the entrance`);
        assert.equal(Math.round(pair.a.x), Math.round(pair.b.x), `level ${level}: exit is straight above the entrance`);
        assert.ok(walls.some((wall) => wall.y1 < pair.a.y && wall.y1 > pair.b.y), `level ${level}: a wall lies between entrance and exit (that is the shortcut)`);
        for (const point of [pair.a, pair.b]) {
          const clearance = Math.min(...walls.map((wall) => distanceToSegment(point, wall)));
          assert.ok(clearance >= HOLE_RADIUS + STONE_RADIUS, `level ${level}: portal is jammed against a wall (${clearance.toFixed(0)}px)`);
        }
      }
    }
  }
  assert.ok(checked > 20, 'portals actually exist on many levels');
});

test('portals can never turn a page into a one-shot: the jumps are budgeted', () => {
  for (const [w, h] of SIZES) {
    for (let level = 1; level <= 40; level += 1) {
      const jumps = makePortals(level, w, h).reduce((sum, p) => sum + Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y), 0);
      const start = startPoint(w, h);
      const goal = exitPoint(w);
      const straight = Math.hypot(goal.x - start.x, goal.y - start.y);
      assert.ok(straight - jumps >= shotRange(h) * 1.15, `level ${level} ${w}x${h}: jumps ${jumps.toFixed(0)} leave only ${(straight - jumps).toFixed(0)}px`);
    }
  }
});

test('only the entrance swallows the stone, so the exit can never trap it', () => {
  const [pair] = makePortals(4, 360, 520);
  assert.ok(pair);
  assert.equal(resolvePortalEntry(pair.a, [pair], null).enteredPortalId, pair.id);
  assert.equal(resolvePortalEntry(pair.b, [pair], null).enteredPortalId, null);
  const jumped = resolvePortalEntry(pair.a, [pair], null);
  assert.deepEqual(jumped.point, pair.b);
});

test('a portal in the first chamber is not placed on the gap line (the stone does not enter it by accident)', () => {
  for (const [w, h] of SIZES) {
    for (let level = 4; level <= 30; level += 1) {
      const gaps = wallLayout(level, w, h);
      for (const pair of makePortals(level, w, h)) {
        for (const gap of gaps) {
          const nearGapLine = Math.abs(pair.a.y - gap.y) < HOLE_RADIUS + STONE_RADIUS && Math.abs(pair.a.x - gap.x) < gap.w / 2 + 10;
          assert.ok(!nearGapLine, `level ${level}: entrance sits in a gap`);
        }
      }
    }
  }
});
