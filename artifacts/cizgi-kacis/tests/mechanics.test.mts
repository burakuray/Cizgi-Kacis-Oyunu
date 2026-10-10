import assert from 'node:assert/strict';
import test from 'node:test';
import { STONE_RADIUS, distanceToSegment, levelKind, makeCourse, wallLayout } from '../game-logic.ts';
import {
  ERASE_MEMORY, INK_LINE_LIFETIME, INK_LINE_MAX_LENGTH, INK_MAX, TEAR_SPEED,
  activeInkLines, applyHazardForces, compressTrail, dailyRuleFor, eraserConfig, eraserHitsStone, eraserRect, erasedFlags,
  expandTrail, frictionFor, hashString, isNearMiss, makeHazards, pencilBars, planInkLine, predictPath, refillInk,
  resolveTear, reflectFromSegments, flipHazards, flipSegment, rollDrop, surpriseLevelFor, EMPTY_HAZARDS, COLLISION_DISTANCE,
} from '../lib/mechanics.ts';

const W = 360;
const H = 520;

test('level kinds follow the designed rhythm and every wall has a passable gap and roomy chambers', () => {
  assert.equal(levelKind(1), 'standard');
  assert.equal(levelKind(5), 'portals');
  assert.equal(levelKind(6), 'relax');
  assert.equal(levelKind(13), 'eraser');
  assert.equal(levelKind(16), 'boss');
  assert.equal(levelKind(24), 'boss');
  const kinds = new Set(Array.from({ length: 40 }, (_, i) => levelKind(i + 1)));
  for (const kind of ['standard', 'precision', 'portals', 'relax', 'pencil', 'eraser', 'boss'] as const) assert.ok(kinds.has(kind), kind);
  for (const [w, h] of [[360, 460], [360, 520], [390, 700]]) {
    for (let level = 1; level <= 60; level += 1) {
      const gaps = wallLayout(level, w, h);
      assert.ok(gaps.length >= 2, `level ${level}: at least two walls`);
      gaps.forEach((gap, i) => {
        assert.ok(gap.w >= 2 * (STONE_RADIUS + 3) + 24, `level ${level}: gap leaves less than +-12px of aim`);
        assert.ok(gap.x - gap.w / 2 >= 20 && gap.x + gap.w / 2 <= w - 20, `level ${level}: gap leaves the page`);
        if (i > 0) {
          assert.ok(gaps[i - 1].y - gap.y >= 66, `level ${level}: chamber too short`);
          assert.ok(Math.abs(gaps[i - 1].x - gap.x) > w * 0.35, `level ${level}: consecutive gaps must be on opposite sides`);
        }
      });
    }
  }
});

test('hazards appear on schedule, are deterministic and keep clear of barriers', () => {
  assert.deepEqual(makeHazards(2, W, H), EMPTY_HAZARDS);
  assert.equal(makeHazards(8, W, H).puddles.length, 1);
  assert.equal(makeHazards(6, W, H).puddles.length, 0, 'the relax page is calm');
  assert.equal(makeHazards(12, W, H).puddles.length, 0, 'the relax page has no hazards');
  assert.ok(makeHazards(11, W, H).tears.length >= 1);
  assert.deepEqual(makeHazards(11, W, H), makeHazards(11, W, H));
  for (let level = 4; level <= 12; level += 1) {
    const bars = makeCourse(level, W, H);
    for (const magnet of makeHazards(level, W, H).magnets) {
      const clearance = Math.min(...bars.map((bar) => distanceToSegment(magnet, bar)));
      assert.ok(clearance > 18, `level ${level}: magnet sits on a bar`);
    }
  }
});

test('sticky ink slows the stone and magnets pull or push it', () => {
  const v = { x: 5, y: 0 };
  const inPuddle = applyHazardForces({ x: 100, y: 100 }, v, { ...EMPTY_HAZARDS, puddles: [{ x: 100, y: 100, r: 30 }] }, 1);
  assert.ok(inPuddle.x < 5 * 0.95);
  const outside = applyHazardForces({ x: 300, y: 300 }, v, { ...EMPTY_HAZARDS, puddles: [{ x: 100, y: 100, r: 30 }] }, 1);
  assert.deepEqual(outside, v);
  const attract = applyHazardForces({ x: 100, y: 100 }, { x: 0, y: 0 }, { ...EMPTY_HAZARDS, magnets: [{ x: 160, y: 100, r: 104, strength: 0.11, polarity: 1 }] }, 1);
  const repel = applyHazardForces({ x: 100, y: 100 }, { x: 0, y: 0 }, { ...EMPTY_HAZARDS, magnets: [{ x: 160, y: 100, r: 104, strength: 0.11, polarity: -1 }] }, 1);
  assert.ok(attract.x > 0 && repel.x < 0);
});

test('a tear-sheet bar bounces a slow stone and rips under a fast one', () => {
  const tears = [{ id: 't1', segment: { x1: 50, y1: 100, x2: 130, y2: 100 } }];
  const slow = resolveTear({ x: 90, y: 100 + STONE_RADIUS }, { x: 0, y: -(TEAR_SPEED - 1) }, tears, new Set());
  assert.equal(slow.kind, 'bounce');
  const fast = resolveTear({ x: 90, y: 100 + STONE_RADIUS }, { x: 0, y: -(TEAR_SPEED + 1) }, tears, new Set());
  assert.equal(fast.kind, 'tear');
  assert.equal(resolveTear({ x: 90, y: 100 + STONE_RADIUS }, { x: 0, y: -7 }, tears, new Set(['t1'])).kind, 'none');
});

test('the Eraser only exists on eraser/boss pages, stays on the board and rubs out bars temporarily', () => {
  assert.equal(eraserConfig(2, W, H), null);
  const config = eraserConfig(13, W, H);
  assert.ok(config);
  for (let t = 0; t < 30; t += 0.37) {
    const r = eraserRect(config, t);
    assert.ok(r.cx - r.w / 2 >= -1 && r.cx + r.w / 2 <= W + 1, 'eraser leaves the board horizontally');
    assert.ok(r.cy - r.h / 2 >= 90 && r.cy + r.h / 2 <= H - 110, 'eraser leaves the play band');
  }
  assert.ok(eraserConfig(16, W, H)!.period < config.period, 'the boss is faster');
  const rect = eraserRect(config, 1);
  assert.equal(eraserHitsStone(rect, { x: rect.cx, y: rect.cy }), true);
  assert.equal(eraserHitsStone(rect, { x: rect.cx, y: rect.cy + rect.h / 2 + 40 }), false);
  const bar = { x1: rect.cx, y1: rect.cy - 5, x2: rect.cx, y2: rect.cy + 5 };
  assert.equal(erasedFlags(config, 1, [bar])[0], true);
  const later = 1 + ERASE_MEMORY + 2.0;
  const laterRect = eraserRect(config, later);
  const far = Math.hypot(laterRect.cx - rect.cx, laterRect.cy - rect.cy) > 120;
  if (far) assert.equal(erasedFlags(config, later, [bar])[0], false, 'the bar is redrawn after a while');
});

test('the pencil warns first, draws, holds, then rubs out; it is deterministic', () => {
  assert.deepEqual(pencilBars(2, W, H, 3), []);
  const phases = new Set<string>();
  for (let t = 0; t < 12; t += 0.1) for (const bar of pencilBars(9, W, H, t)) phases.add(bar.phase);
  for (const phase of ['telegraph', 'draw', 'hold', 'erase']) assert.ok(phases.has(phase), phase);
  for (let t = 0; t < 12; t += 0.1) for (const bar of pencilBars(9, W, H, t)) if (bar.phase === 'telegraph') assert.equal(bar.solid, false, 'a warning must never be lethal');
  assert.deepEqual(pencilBars(9, W, H, 4.2), pencilBars(9, W, H, 4.2));
});

test('ink lines are capped by length and by the pool, expire, and the pool refills', () => {
  const plan = planInkLine({ x: 0, y: 0 }, { x: 400, y: 0 }, INK_MAX)!;
  assert.ok(Math.abs(plan.segment.x2 - INK_LINE_MAX_LENGTH) < 1e-6);
  assert.ok(plan.cost <= INK_MAX);
  assert.equal(planInkLine({ x: 0, y: 0 }, { x: 5, y: 0 }, INK_MAX), null, 'too short');
  assert.equal(planInkLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 3), null, 'not enough ink');
  const small = planInkLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)!;
  assert.ok(small.cost <= 30 + 1e-9);
  const lines = [{ segment: plan.segment, born: 2 }];
  assert.equal(activeInkLines(lines, 2.5).length, 1);
  assert.equal(activeInkLines(lines, 2 + INK_LINE_LIFETIME + 0.01).length, 0);
  assert.equal(refillInk(INK_MAX - 1, 5), INK_MAX - 1);
  assert.equal(refillInk(10, 1), 10, 'ink never refills while the stone flies');
});

test('the daily rule is stable per day, the surprise page is a reachable level, slick lowers friction', () => {
  assert.equal(dailyRuleFor('2026-10-05'), dailyRuleFor('2026-10-05'));
  const rules = new Set(Array.from({ length: 40 }, (_, i) => dailyRuleFor(`2026-10-${String(i + 1).padStart(2, '0')}`)));
  assert.equal(rules.size, 3, 'all three rules occur over time');
  for (let best = 3; best <= 30; best += 3) {
    const level = surpriseLevelFor('2026-10-05', best);
    assert.ok(level >= 3 && level <= Math.max(3, best));
  }
  assert.ok(frictionFor('slick') > frictionFor(null));
  assert.equal(frictionFor('mirror'), frictionFor(null));
});

test('drops are deterministic, rare, and a pity timer guarantees one eventually', () => {
  const cards = ['c1', 'c2'];
  assert.deepEqual(rollDrop('a', ['coral'], [], cards, 0), rollDrop('a', ['coral'], [], cards, 0));
  let drops = 0;
  for (let i = 0; i < 400; i += 1) if (rollDrop(`seed-${i}`, ['coral'], [], cards, 0)) drops += 1;
  assert.ok(drops > 40 && drops < 140, `unexpected drop count ${drops}`);
  for (let i = 0; i < 50; i += 1) assert.ok(rollDrop(`p-${i}`, ['coral'], [], cards, 8), 'pity timer');
  const seen = new Set<string>();
  for (let i = 0; i < 300; i += 1) {
    const drop = rollDrop(`k-${i}`, ['coral', 'galaxy', 'ember'], ['c1', 'c2'], cards, 9);
    if (drop) seen.add(drop.kind);
  }
  assert.deepEqual([...seen], ['ink'], 'with everything owned only ink drops');
});

test('near miss window sits just outside the collision distance', () => {
  assert.equal(isNearMiss(COLLISION_DISTANCE - 1, 6), false);
  assert.equal(isNearMiss(COLLISION_DISTANCE + 3, 6), true);
  assert.equal(isNearMiss(COLLISION_DISTANCE + 12, 6), false);
  assert.equal(isNearMiss(COLLISION_DISTANCE + 3, 1), false, 'a slow drift is not a near miss');
});

test('trail compression round-trips within a small error and caps the size', () => {
  const trail = Array.from({ length: 200 }, (_, i) => ({ x: 10 + i, y: 500 - i * 2 }));
  const packed = compressTrail(trail, W, H, 36);
  assert.ok(packed.length <= 38);
  const back = expandTrail(packed, W, H);
  assert.ok(Math.abs(back[0].x - trail[0].x) < 1 && Math.abs(back[back.length - 1].y - trail[199].y) < 1);
  assert.deepEqual(compressTrail([], W, H), []);
});

test('path prediction stops at the first barrier', () => {
  const path = predictPath({ x: 100, y: 400 }, { x: 100, y: 300 }, [{ x1: 60, y1: 340, x2: 140, y2: 340 }]);
  assert.ok(path[path.length - 1].y > 330, 'the preview stops before passing the bar');
  assert.ok(predictPath({ x: 100, y: 400 }, { x: 100, y: 300 }, []).length > 10);
  assert.ok(hashString('a') !== hashString('b'));
});

test('a drawn ink line reflects the stone at any angle (45 degrees turns right into up)', () => {
  const diagonal = { x1: 100, y1: 200, x2: 200, y2: 100 }; // runs "/" so its normal points to the lower-right / upper-left
  const point = { x: 150 + 14, y: 150 + 14 }; // just below-right of the line's midpoint
  const hit = reflectFromSegments(point, { x: -3, y: -3 }, [diagonal]);
  assert.equal(hit.bounced, true);
  assert.ok(hit.velocity.x > 0 && hit.velocity.y > 0, 'the stone is thrown back along its incoming path');
  assert.ok(Math.hypot(hit.velocity.x, hit.velocity.y) <= Math.hypot(3, 3) + 1e-9, 'no energy is gained');
  const out = Math.min(...[diagonal].map((s) => distanceToSegment(hit.point, s)));
  assert.ok(out >= STONE_RADIUS + 9, 'the stone is pushed out of the line');
  assert.equal(reflectFromSegments({ x: 0, y: 0 }, { x: 1, y: 1 }, [diagonal]).bounced, false);
  const leaving = reflectFromSegments(point, { x: 3, y: 3 }, [diagonal]);
  assert.deepEqual(leaving.velocity, { x: 3, y: 3 }, 'a stone already moving away keeps its velocity');
});

test('mirroring flips x only and is its own inverse', () => {
  const seg = { x1: 10, y1: 5, x2: 40, y2: 5 };
  assert.deepEqual(flipSegment(360, flipSegment(360, seg)), seg);
  const hz = { puddles: [{ x: 50, y: 9, r: 30 }], magnets: [], tears: [] };
  assert.equal(flipHazards(360, hz).puddles[0].x, 310);
  assert.equal(flipHazards(360, hz).puddles[0].y, 9);
});
