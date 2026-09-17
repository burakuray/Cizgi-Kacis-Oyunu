import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeCourse,
  makeMovingBars,
  makePortals,
  positionMovingBar,
  renderedMovingBars,
  resolvePortalEntry,
  resolvePortalStep,
  isStoneColliding,
} from '../game-logic.ts';

const BOARD = { width: 360, height: 560 };

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

test('moving-bar collision uses the bar position rendered at that time', () => {
  const blueprints = makeMovingBars(2, BOARD.width, BOARD.height);
  assert.equal(blueprints.length, 1);
  const bar = blueprints[0];
  assert.ok(bar);

  const time = 0.4;
  const rendered = positionMovingBar(bar, time);
  const renderedMidpoint = {
    x: (rendered.x1 + rendered.x2) / 2,
    y: (rendered.y1 + rendered.y2) / 2,
  };

  assert.equal(isStoneColliding(renderedMidpoint, [rendered]), true);
  assert.equal(isStoneColliding(renderedMidpoint, [bar.segment]), false);
  assert.deepEqual(renderedMovingBars(blueprints, time), [rendered]);
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