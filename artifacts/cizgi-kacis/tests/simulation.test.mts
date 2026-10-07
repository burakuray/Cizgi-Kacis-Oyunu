/**
 * Headless soak test: replays the exact order of operations of the game loop in app/index.tsx
 * (hazard forces -> edges -> springs -> tears -> collisions) for many random shots on many levels,
 * with random ink lines, and checks the physics stays finite and on the board.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STONE_RADIUS, bounceFromBarriers, clamp, levelKind, makeBouncyBarriers, makeCourse, makeMovingBars, makePortals,
  renderedMovingBars, resolvePortalStep,
} from '../game-logic.ts';
import {
  INK_MAX, activeInkLines, applyHazardForces, eraserConfig, eraserHitsStone, eraserRect, erasedFlags, frictionFor, makeHazards,
  pencilBars, planInkLine, reflectFromSegments, refillInk, resolveTear, rng, solidPencilSegments,
  type DailyRule, type InkLine,
} from '../lib/mechanics.ts';

const W = 360;
const H = 520;

function simulate(level: number, seed: number, rule: DailyRule | null) {
  const random = rng(seed);
  const course = makeCourse(level, W, H);
  const bouncy = makeBouncyBarriers(level, W, H);
  const blueprints = makeMovingBars(level, W, H);
  const portals = makePortals(level, W, H);
  const hazards = makeHazards(level, W, H);
  const eraser = eraserConfig(level, W, H);
  const baseFriction = frictionFor(rule);
  let broken: ReadonlySet<string> = new Set();
  let pool = INK_MAX;
  let lines: InkLine[] = [];
  let lock: string | null = null;
  let stone = { x: W / 2, y: H - 57 };
  const angle = -Math.PI / 2 + (random() - 0.5) * 1.3;
  const speed = 2 + random() * 5.1;
  let velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  let t = 0;
  let bounces = 0;
  let outcome: 'goal' | 'hit' | 'rest' | 'timeout' = 'timeout';

  for (let frame = 0; frame < 900; frame += 1) {
    const delta = 1;
    t += 1 / 60;
    pool = refillInk(pool, 1 / 60);
    if (frame % 40 === 20) {
      const from = { x: stone.x + (random() - 0.5) * 60, y: stone.y + (random() - 0.5) * 60 };
      const plan = planInkLine(from, { x: from.x + (random() - 0.5) * 200, y: from.y + (random() - 0.5) * 200 }, pool);
      if (plan) {
        pool -= plan.cost;
        lines = [...activeInkLines(lines, t), { segment: plan.segment, born: t }];
      }
    }
    const raw = { x: stone.x + velocity.x * delta, y: stone.y + velocity.y * delta };
    const friction = Math.pow(baseFriction, delta);
    let next = { x: clamp(raw.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(raw.y, STONE_RADIUS, H - STONE_RADIUS) };
    let v = applyHazardForces(stone, { x: velocity.x * friction, y: velocity.y * friction }, hazards, delta);
    if (raw.x < STONE_RADIUS || raw.x > W - STONE_RADIUS) v = { ...v, x: -v.x };
    if (raw.y < STONE_RADIUS || raw.y > H - STONE_RADIUS) v = { ...v, y: -v.y };

    const moving = renderedMovingBars(blueprints, t);
    const erased = eraser ? erasedFlags(eraser, t, course) : null;
    const standing = erased ? course.filter((_, i) => !erased[i]) : course;
    const solid = [...standing, ...bouncy, ...moving, ...solidPencilSegments(pencilBars(level, W, H, t))];
    const inkSegments = activeInkLines(lines, t).map((l) => l.segment);

    const ink = reflectFromSegments(next, v, inkSegments);
    const spring = ink.bounced ? ink : bounceFromBarriers(next, v, bouncy);
    if (spring.bounced) {
      bounces += 1;
      stone = { x: clamp(spring.point.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(spring.point.y, STONE_RADIUS, H - STONE_RADIUS) };
      velocity = spring.velocity;
    } else {
      const tear = resolveTear(next, v, hazards.tears, broken);
      if (tear.kind === 'bounce') {
        bounces += 1;
        stone = { x: clamp(tear.point.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(tear.point.y, STONE_RADIUS, H - STONE_RADIUS) };
        velocity = tear.velocity;
      } else {
        if (tear.kind === 'tear') {
          broken = new Set(broken).add(tear.id);
          v = tear.velocity;
        }
        const step = resolvePortalStep(next, portals, lock, solid);
        if (step.collided || (eraser && eraserHitsStone(eraserRect(eraser, t), next))) {
          outcome = 'hit';
          break;
        }
        if (Math.hypot(next.x - W / 2, next.y - 51) < 26) {
          outcome = 'goal';
          break;
        }
        lock = step.portalLock;
        if (step.enteredPortalId) next = { x: step.point.x, y: step.point.y };
        stone = next;
        velocity = v;
        if (Math.hypot(v.x, v.y) < 0.08) {
          outcome = 'rest';
          break;
        }
      }
    }
    assert.ok(Number.isFinite(stone.x) && Number.isFinite(stone.y), `level ${level} seed ${seed}: position became non-finite`);
    assert.ok(Number.isFinite(velocity.x) && Number.isFinite(velocity.y), `level ${level} seed ${seed}: velocity became non-finite`);
    assert.ok(stone.x >= STONE_RADIUS - 0.01 && stone.x <= W - STONE_RADIUS + 0.01 && stone.y >= STONE_RADIUS - 0.01 && stone.y <= H - STONE_RADIUS + 0.01, `level ${level} seed ${seed}: stone left the board at frame ${frame} (${stone.x.toFixed(1)}, ${stone.y.toFixed(1)})`);
    assert.ok(Math.hypot(velocity.x, velocity.y) < 14, `level ${level} seed ${seed}: runaway speed`);
  }
  return { outcome, bounces };
}

test('thousands of random shots stay finite and on the board across every level kind and daily rule', () => {
  const outcomes: Record<string, number> = { goal: 0, hit: 0, rest: 0, timeout: 0 };
  const kinds = new Set<string>();
  let bounced = 0;
  for (let level = 1; level <= 40; level += 1) {
    kinds.add(levelKind(level));
    for (let seed = 1; seed <= 25; seed += 1) {
      const rule: DailyRule | null = seed % 4 === 0 ? 'slick' : null;
      const result = simulate(level, level * 1000 + seed, rule);
      outcomes[result.outcome] += 1;
      bounced += result.bounces;
    }
  }
  assert.equal(kinds.size, 7, 'every level kind was exercised');
  assert.ok(bounced > 200, `the springs and ink lines should actually be hit (${bounced})`);
  assert.ok(outcomes.hit > 100, 'barriers and the Eraser end some attempts');
  assert.ok(outcomes.goal + outcomes.rest + outcomes.hit + outcomes.timeout === 1000);
});
