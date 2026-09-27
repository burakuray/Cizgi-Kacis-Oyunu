import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeCourse,
  makeBouncyBarriers,
  getDifficultyProfile,
  makeMovingBars,
  makePortals,
  positionMovingBar,
  renderedMovingBars,
  resolvePortalEntry,
  resolveLifeLoss,
  resolvePortalStep,
  isStoneColliding,
  bounceFromBarriers,
} from '../game-logic.ts';

const BOARD = { width: 360, height: 560 };

test('difficulty profile does not regress in later levels', () => {
  const early = getDifficultyProfile(2);
  const mid = getDifficultyProfile(8);
  const late = getDifficultyProfile(12);
  assert.ok(mid.barrierCount >= early.barrierCount);
  assert.ok(late.barrierCount >= mid.barrierCount);
  assert.ok(mid.movingBarSpeed > early.movingBarSpeed);
  assert.ok(late.movingBarSpeed > mid.movingBarSpeed);
  assert.ok(late.portalPairCount >= mid.portalPairCount);
  assert.ok(late.bouncyBarrierCount >= mid.bouncyBarrierCount);
});

test('life loss retries, demotes, then ends the run at level one', () => {
  assert.deepEqual(resolveLifeLoss(4, 2), { outcome: 'retry', level: 4, lives: 1 });
  assert.deepEqual(resolveLifeLoss(4, 1), { outcome: 'demoted', level: 3, lives: 3 });
  assert.deepEqual(resolveLifeLoss(1, 1), { outcome: 'gameover', level: 1, lives: 0 });
});

test('portal entry teleports to its pair and stays locked at the exit', () => {
  const [portal] = makePortals(4, BOARD.width, BOARD.height);
  assert.ok(portal);

  const firstEntry = resolvePortalEntry(portal.a, [portal], null);
  assert.deepEqual(firstEntry.point, portal.b);
  assert.equal(firstEntry.portalLock, `${portal.id}:b`);
  assert.equal(firstEntry.enteredPortalId, portal.id);

  const sameFrame = resolvePortalEntry(firstEntry.point, [portal], firstEntry.portalLock);
  assert.deepEqual(sameFrame.point, portal.b);
  assert.equal(sameFrame.portalLock, firstEntry.portalLock);
  assert.equal(sameFrame.enteredPortalId, null);
});

test('moving bars stay clear of static barriers over time', () => {
  const blueprints = makeMovingBars(2, BOARD.width, BOARD.height);
  assert.equal(blueprints.length, 1);
  const bar = blueprints[0];
  assert.ok(bar);

  const course = makeCourse(2, BOARD.width, BOARD.height);
  for (const time of [0, 0.2, 0.5, 1, 1.5]) {
    const rendered = positionMovingBar(bar, time);
    const midpoint = { x: (rendered.x1 + rendered.x2) / 2, y: (rendered.y1 + rendered.y2) / 2 };
    assert.equal(isStoneColliding(midpoint, course, 18), false, `moving bar touched a static barrier at ${time}s: ${JSON.stringify(rendered)}`);
    assert.deepEqual(renderedMovingBars(blueprints, time), [rendered]);
  }
});

test('bouncy barriers reflect the stone without ending the attempt', () => {
  const barriers = makeBouncyBarriers(3, BOARD.width, BOARD.height);
  assert.equal(barriers.length, 1);
  const barrier = barriers[0];
  const response = bounceFromBarriers({ x: (barrier.x1 + barrier.x2) / 2, y: barrier.y1 - 14 }, { x: 1, y: 3 }, barriers);
  assert.equal(response.bounced, true);
  assert.ok(response.velocity.y < 0);
  assert.ok(response.point.y < barrier.y1);
});

test('portal exit does not get hit by a moving bar on the teleport frame', () => {
  const [portal] = makePortals(4, BOARD.width, BOARD.height);
  assert.ok(portal);
  const exitBar = {
    x1: portal.b.x - 40,
    y1: portal.b.y,
    x2: portal.b.x + 40,
    y2: portal.b.y,
  };

  const step = resolvePortalStep(portal.a, [portal], null, [exitBar]);
  assert.equal(step.collided, false);
  assert.deepEqual(step.point, portal.b);
  assert.equal(step.portalLock, `${portal.id}:b`);
});

test('course, bars, and portals are deterministic for a level and board size', () => {
  for (const level of [1, 2, 4, 6, 8, 12]) {
    assert.deepEqual(
      {
        course: makeCourse(level, BOARD.width, BOARD.height),
        bars: makeMovingBars(level, BOARD.width, BOARD.height),
        portals: makePortals(level, BOARD.width, BOARD.height),
      },
      {
        course: makeCourse(level, BOARD.width, BOARD.height),
        bars: makeMovingBars(level, BOARD.width, BOARD.height),
        portals: makePortals(level, BOARD.width, BOARD.height),
      },
    );
  }
});