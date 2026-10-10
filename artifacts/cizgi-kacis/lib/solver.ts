/**
 * Level solver: replays the game loop (the same order of operations as app/index.tsx) for sampled shots.
 * Used by tests and scripts to prove a level is NOT solvable with a single shot and IS solvable with a few.
 * No React / AsyncStorage, so it runs under plain Node.
 */
import type { MovingBar, Point, PortalPair, Segment } from '../game-logic.ts';
import {
  STONE_RADIUS, bounceFromBarriers, clamp, levelKind, makeBouncyBarriers, makeCourse, makeMovingBars, makePortals, renderedMovingBars, resolvePortalStep,
} from '../game-logic.ts';
import {
  type EraserConfig, type Hazards, applyHazardForces, frictionFor, eraserConfig, eraserHitsStone, eraserRect, erasedFlags, makeHazards, pencilBars,
  resolveTear, solidPencilSegments,
} from './mechanics.ts';

export type BuiltLevel = {
  width: number;
  height: number;
  course: Segment[];
  bouncy: Segment[];
  blueprints: MovingBar[];
  portals: PortalPair[];
  hazards: Hazards;
  eraser: EraserConfig | null;
  level: number;
  goal: Point;
  origin: Point;
};

export function buildLevel(level: number, width: number, height: number): BuiltLevel {
  return {
    width, height, level,
    course: makeCourse(level, width, height),
    bouncy: makeBouncyBarriers(level, width, height),
    blueprints: makeMovingBars(level, width, height),
    portals: makePortals(level, width, height),
    hazards: makeHazards(level, width, height),
    eraser: eraserConfig(level, width, height),
    goal: { x: width / 2, y: 51 },
    origin: { x: width / 2, y: height - 57 },
  };
}

export type ShotResult = { outcome: 'goal' | 'hit' | 'rest' | 'timeout'; rest: Point; time: number };

/** Speeds the player can really produce: 7.1 * clamp(drag / 94, 0.25, 1). */
export const SHOT_SPEEDS = [1.8, 3, 4.4, 5.8, 7.1];

export function simulateShot(built: BuiltLevel, from: Point, angle: number, speed: number, startTime = 0, friction?: number): ShotResult {
  const { width: W, height: H, level } = built;
  const drag = friction ?? frictionFor(null, H);
  let stone = { ...from };
  let velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  let broken: ReadonlySet<string> = new Set();
  let lock: string | null = null;
  let t = startTime;
  for (let frame = 0; frame < 1100; frame += 1) {
    t += 1 / 60;
    const raw = { x: stone.x + velocity.x, y: stone.y + velocity.y };
    let v = applyHazardForces(stone, { x: velocity.x * drag, y: velocity.y * drag }, built.hazards, 1);
    let next = { x: clamp(raw.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(raw.y, STONE_RADIUS, H - STONE_RADIUS) };
    if (raw.x < STONE_RADIUS || raw.x > W - STONE_RADIUS) v = { ...v, x: -v.x };
    if (raw.y < STONE_RADIUS || raw.y > H - STONE_RADIUS) v = { ...v, y: -v.y };

    const moving = renderedMovingBars(built.blueprints, t);
    const erased = built.eraser ? erasedFlags(built.eraser, t, built.course) : null;
    const standing = erased ? built.course.filter((_, i) => !erased[i]) : built.course;
    const solid = [...standing, ...built.bouncy, ...moving, ...solidPencilSegments(pencilBars(level, W, H, t))];

    const spring = bounceFromBarriers(next, v, built.bouncy);
    if (spring.bounced) {
      stone = { x: clamp(spring.point.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(spring.point.y, STONE_RADIUS, H - STONE_RADIUS) };
      velocity = spring.velocity;
      continue;
    }
    const tear = resolveTear(next, v, built.hazards.tears, broken);
    if (tear.kind === 'bounce') {
      stone = { x: clamp(tear.point.x, STONE_RADIUS, W - STONE_RADIUS), y: clamp(tear.point.y, STONE_RADIUS, H - STONE_RADIUS) };
      velocity = tear.velocity;
      continue;
    }
    if (tear.kind === 'tear') {
      broken = new Set(broken).add(tear.id);
      v = tear.velocity;
    }
    const step = resolvePortalStep(next, built.portals, lock, solid);
    if (step.collided || (built.eraser && eraserHitsStone(eraserRect(built.eraser, t), next))) return { outcome: 'hit', rest: next, time: t };
    if (Math.hypot(next.x - built.goal.x, next.y - built.goal.y) < 26) return { outcome: 'goal', rest: next, time: t };
    lock = step.portalLock;
    if (step.enteredPortalId) next = { x: step.point.x, y: step.point.y };
    stone = next;
    velocity = v;
    if (Math.hypot(v.x, v.y) < 0.08) return { outcome: 'rest', rest: stone, time: t };
  }
  return { outcome: 'timeout', rest: stone, time: t };
}

/** Every sampled single shot from the start that reaches the exit. Empty = the level needs at least two shots. */
export function oneShotSolutions(built: BuiltLevel, angles = 180, speeds = SHOT_SPEEDS): Array<{ angle: number; speed: number }> {
  const wins: Array<{ angle: number; speed: number }> = [];
  for (let i = 0; i < angles; i += 1) {
    const angle = (i / angles) * Math.PI * 2;
    for (const speed of speeds) {
      if (simulateShot(built, built.origin, angle, speed).outcome === 'goal') wins.push({ angle, speed });
    }
  }
  return wins;
}

/**
 * Smallest number of shots found (breadth-first over resting positions, beam-limited). Returns Infinity if none
 * is found within `maxShots`. Approximate: it samples angles and speeds, so it can only over-estimate.
 */
export function minShots(built: BuiltLevel, maxShots = 5, beam = 28, angles = 72, speeds = SHOT_SPEEDS): number {
  const timed = built.eraser !== null || built.blueprints.length > 0 || levelKind(built.level) === 'pencil' || levelKind(built.level) === 'boss';
  let frontier: Array<{ at: Point; time: number }> = [{ at: built.origin, time: 0 }];
  const seen = new Set<string>();
  for (let depth = 1; depth <= maxShots; depth += 1) {
    const rests: Array<{ at: Point; time: number }> = [];
    for (const state of frontier) {
      for (let i = 0; i < angles; i += 1) {
        const angle = (i / angles) * Math.PI * 2;
        for (const speed of speeds) {
          const result = simulateShot(built, state.at, angle, speed, state.time);
          if (result.outcome === 'goal') return depth;
          if (result.outcome === 'rest') {
            // On pages with time-dependent hazards the same spot at another moment is a different state.
            const bucket = timed ? Math.floor(result.time) % 6 : 0;
            const key = `${Math.round(result.rest.x / 22)}:${Math.round(result.rest.y / 22)}:${bucket}`;
            if (!seen.has(key)) {
              seen.add(key);
              rests.push({ at: result.rest, time: result.time });
            }
          }
        }
      }
    }
    // Keep a diverse set of resting spots: the best (closest to the exit) of every 60px cell, so the search
    // does not fill up with dead ends pressed against one wall.
    const cells = new Map<string, { at: Point; time: number }>();
    for (const rest of rests) {
      const key = `${Math.floor(rest.at.x / 60)}:${Math.floor(rest.at.y / 60)}:${timed ? Math.floor(rest.time) % 6 : 0}`;
      const held = cells.get(key);
      const score = (r: { at: Point }) => Math.hypot(r.at.x - built.goal.x, r.at.y - built.goal.y);
      if (!held || score(rest) < score(held)) cells.set(key, rest);
    }
    frontier = [...cells.values()].sort((a, b) => Math.hypot(a.at.x - built.goal.x, a.at.y - built.goal.y) - Math.hypot(b.at.x - built.goal.x, b.at.y - built.goal.y)).slice(0, beam);
    if (frontier.length === 0) return Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}
