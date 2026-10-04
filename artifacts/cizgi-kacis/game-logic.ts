export type Point = { x: number; y: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type MovingBar = {
  id: string;
  segment: Segment;
  axis: 'x' | 'y';
  direction: -1 | 1;
  travel: number;
  speed: number;
  phase: number;
};
export type PortalPair = { id: string; a: Point; b: Point; label: string };

export const STONE_RADIUS = 13;
export const HOLE_RADIUS = 18;

export type DifficultyProfile = {
  barrierCount: number;
  movingBarCount: number;
  movingBarSpeed: number;
  portalPairCount: number;
  bouncyBarrierCount: number;
};

export function getDifficultyProfile(level: number): DifficultyProfile {
  const safeLevel = Math.max(1, Math.floor(level));
  return {
    barrierCount: Math.min(12, 2 + Math.floor((safeLevel + 1) / 2)),
    movingBarCount: safeLevel < 2 ? 0 : Math.min(3, 1 + Math.floor((safeLevel - 2) / 4)),
    movingBarSpeed: 1.1 + Math.min(1.1, Math.max(0, safeLevel - 2) * 0.1),
    portalPairCount: safeLevel < 4 ? 0 : Math.min(3, 1 + Math.floor((safeLevel - 4) / 4)),
    bouncyBarrierCount: safeLevel < 3 ? 0 : Math.min(2, 1 + Math.floor((safeLevel - 3) / 6)),
  };
}

export type LifeLossResult = {
  outcome: 'retry' | 'demoted' | 'gameover';
  level: number;
  lives: number;
};

export function resolveLifeLoss(level: number, lives: number, maxLives = 3): LifeLossResult {
  const remainingLives = Math.max(0, lives - 1);
  if (remainingLives > 0) return { outcome: 'retry', level, lives: remainingLives };
  if (level > 1) return { outcome: 'demoted', level: level - 1, lives: maxLives };
  return { outcome: 'gameover', level: 1, lives: 0 };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function distanceToSegment(point: Point, segment: Segment) {
  const vx = segment.x2 - segment.x1;
  const vy = segment.y2 - segment.y1;
  const wx = point.x - segment.x1;
  const wy = point.y - segment.y1;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : clamp((wx * vx + wy * vy) / length, 0, 1);
  const nearest = { x: segment.x1 + t * vx, y: segment.y1 + t * vy };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

function clearanceTo(point: Point, segments: Segment[]) {
  return segments.reduce((nearest, segment) => Math.min(nearest, distanceToSegment(point, segment)), Infinity);
}

function segmentsOverlap(a: Segment, b: Segment, pad = 8) {
  const aMinX = Math.min(a.x1, a.x2) - pad;
  const aMaxX = Math.max(a.x1, a.x2) + pad;
  const aMinY = Math.min(a.y1, a.y2) - pad;
  const aMaxY = Math.max(a.y1, a.y2) + pad;
  const bMinX = Math.min(b.x1, b.x2) - pad;
  const bMaxX = Math.max(b.x1, b.x2) + pad;
  const bMinY = Math.min(b.y1, b.y2) - pad;
  const bMaxY = Math.max(b.y1, b.y2) + pad;
  return !(aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY);
}

function segmentCollidesWithAny(candidate: Segment, segments: Segment[], pad = 10) {
  return segments.some((segment) => segmentsOverlap(candidate, segment, pad));
}

function orientation(a: Point, b: Point, c: Point) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point) {
  return (
    b.x >= Math.min(a.x, c.x) - 0.0001 &&
    b.x <= Math.max(a.x, c.x) + 0.0001 &&
    b.y >= Math.min(a.y, c.y) - 0.0001 &&
    b.y <= Math.max(a.y, c.y) + 0.0001
  );
}

function segmentsIntersect(a: Segment, b: Segment) {
  const a1 = { x: a.x1, y: a.y1 };
  const a2 = { x: a.x2, y: a.y2 };
  const b1 = { x: b.x1, y: b.y1 };
  const b2 = { x: b.x2, y: b.y2 };
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function segmentDistance(a: Segment, b: Segment) {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(
    distanceToSegment({ x: a.x1, y: a.y1 }, b),
    distanceToSegment({ x: a.x2, y: a.y2 }, b),
    distanceToSegment({ x: b.x1, y: b.y1 }, a),
    distanceToSegment({ x: b.x2, y: b.y2 }, a),
  );
}

export function isDirectEscapeBlocked(origin: Point, goal: Point, obstacles: Segment[], padding = STONE_RADIUS + 4) {
  const escapeLine: Segment = { x1: origin.x, y1: origin.y, x2: goal.x, y2: goal.y };
  return obstacles.some((obstacle) => segmentDistance(escapeLine, obstacle) <= padding);
}


type PlacementBounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Finds the spot closest to `anchor` whose `score` is >= 0 (searching outwards in rings).
 * Deterministic, so a level always looks the same. Falls back to the best score found.
 */
function placeNear(anchor: Point, score: (point: Point) => number, bounds: PlacementBounds): Point {
  const inside = (point: Point) => ({ x: clamp(point.x, bounds.minX, bounds.maxX), y: clamp(point.y, bounds.minY, bounds.maxY) });
  let best = inside(anchor);
  let bestScore = score(best);
  if (bestScore >= 0) return best;
  for (let radius = 6; radius <= 190; radius += 6) {
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const candidate = inside({ x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius });
      const candidateScore = score(candidate);
      if (candidateScore >= 0) return candidate;
      if (candidateScore > bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
  }
  return best;
}

export function makeCourse(level: number, width: number, height: number): Segment[] {
  const lines: Segment[] = [];
  const { barrierCount: count } = getDifficultyProfile(level);
  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const laneWidth = width / (count + 1);

  const addSafeVertical = (x: number, topY: number, bottomY: number) => {
    const top = { x1: x, y1: usableTop, x2: x, y2: topY };
    const bottom = { x1: x, y1: bottomY, x2: x, y2: usableBottom };
    if (!segmentCollidesWithAny(top, lines, 12) && !segmentCollidesWithAny(bottom, lines, 12)) {
      lines.push(top, bottom);
      return true;
    }

    for (const delta of [12, -12, 24, -24, 36, -36, 48, -48, 60, -60]) {
      const candidateTopY = topY + delta;
      const candidateBottomY = Math.min(usableBottom - 22, candidateTopY + Math.max(44, (height - usableTop - usableBottom) / 2 + ((x / laneWidth) % 2) * 24) + Math.max(30, 62 - Math.floor(level / 3) * 5) + ((level + Math.round(x / laneWidth) * 13) % 3) * 11);
      const candidateTop = { x1: x, y1: usableTop, x2: x, y2: candidateTopY };
      const candidateBottom = { x1: x, y1: candidateBottomY, x2: x, y2: usableBottom };
      if (!segmentCollidesWithAny(candidateTop, lines, 12) && !segmentCollidesWithAny(candidateBottom, lines, 12)) {
        lines.push(candidateTop, candidateBottom);
        return true;
      }
    }

    return false;
  };

  for (let index = 0; index < count; index += 1) {
    const x = laneWidth * (index + 1);
    const gap = Math.max(30, 62 - Math.floor(level / 3) * 5) + ((level + index * 13) % 3) * 11;
    const shift = (index % 2) * 24;
    const topLength = Math.max(44, (height - usableTop - usableBottom) / 2 + shift);
    const topY = usableTop + ((index * 37 + level * 19) % 55);
    const bottomY = Math.min(usableBottom - 22, topY + topLength + gap);
    addSafeVertical(x, topY, bottomY);
  }

  const addSafeHorizontal = (segment: Segment, pad = 16) => {
    if (!segmentCollidesWithAny(segment, lines, pad)) {
      lines.push(segment);
      return true;
    }

    const baseY = segment.y1;
    for (const delta of [18, -18, 36, -36, 54, -54, 72, -72, 90, -90]) {
      const candidate = { ...segment, y1: baseY + delta, y2: baseY + delta };
      if (!segmentCollidesWithAny(candidate, lines, pad)) {
        lines.push(candidate);
        return true;
      }
    }

    return false;
  };

  if (level >= 3) {
    const y = usableTop + 100 + ((level * 23) % 60);
    addSafeHorizontal({ x1: 26, y1: y, x2: width * 0.42, y2: y });
  }
  if (level >= 5) {
    const y = usableTop + 214 + ((level * 17) % 56);
    addSafeHorizontal({ x1: width * 0.58, y1: y, x2: width - 26, y2: y });
  }
  if (level >= 7) {
    const y = usableTop + 158 + ((level * 29) % 52);
    addSafeHorizontal({ x1: 26, y1: y, x2: width * 0.34, y2: y });
  }

  // From level 3 onward, never leave the start-to-exit spine completely open.
  // This prevents a lucky single launch from reaching the fixed exit directly.
  if (level >= 3 && !isDirectEscapeBlocked(
    { x: width / 2, y: height - 57 },
    { x: width / 2, y: 51 },
    lines,
    STONE_RADIUS + 5,
  )) {
    const centerX = width / 2;
    const candidates = [
      usableTop + 80,
      usableTop + 125,
      usableTop + 170,
      usableTop + 215,
      usableTop + 260,
      usableTop + 305,
    ];
    for (const centerY of candidates) {
      // A short horizontal gate in the central lane blocks the exact
      // start-to-exit spine without crossing the neighbouring vertical walls.
      const candidate = {
        x1: Math.max(26, centerX - 68),
        y1: centerY,
        x2: Math.min(width - 26, centerX + 68),
        y2: centerY,
      };
      if (
        candidate.y1 >= usableTop + 20 &&
        candidate.y1 <= usableBottom - 20 &&
        !segmentCollidesWithAny(candidate, lines, 12)
      ) {
        lines.push(candidate);
        break;
      }
    }
  }
  return lines;
}

/** The strip a moving bar sweeps over time, as one segment (used so other pieces keep clear of it). */
function sweptSegment(bar: MovingBar): Segment {
  const { segment, axis, travel } = bar;
  return axis === 'x'
    ? { x1: segment.x1 - travel, y1: segment.y1, x2: segment.x2 + travel, y2: segment.y2 }
    : { x1: segment.x1, y1: segment.y1 - travel, x2: segment.x2, y2: segment.y2 + travel };
}

export function makeBouncyBarriers(level: number, width: number, height: number): Segment[] {
  const { bouncyBarrierCount } = getDifficultyProfile(level);
  if (bouncyBarrierCount === 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const y = usableTop + 62 + ((level * 31) % Math.max(40, usableBottom - usableTop - 120));
  const build = (baseY: number) => {
    const barriers: Segment[] = [];
    for (let index = 0; index < bouncyBarrierCount; index += 1) {
      const length = width * (index === 0 ? 0.34 : 0.24);
      const left = index === 0 ? (level % 2 === 0 ? width * 0.1 : width * 0.56) : width * 0.18;
      const offsetY = index * 74;
      barriers.push({ x1: left, y1: baseY + offsetY, x2: left + length, y2: baseY + offsetY });
    }
    return barriers;
  };

  // Slide the bouncers up or down until they no longer sit on top of a horizontal thorn bar.
  const horizontalBars = [
    ...makeCourse(level, width, height).filter((segment) => segment.y1 === segment.y2),
    ...makeMovingBars(level, width, height).map(sweptSegment),
  ];
  const overlapsBar = (candidate: Segment[]) =>
    candidate.some((bouncer) =>
      horizontalBars.some(
        (bar) =>
          Math.abs(bar.y1 - bouncer.y1) < 34 &&
          Math.min(bar.x2, bouncer.x2) - Math.max(bar.x1, bouncer.x1) > -10,
      ),
    );
  const lowest = usableBottom - 40;
  for (const shift of [0, 18, -18, 36, -36, 54, -54, 72, -72, 90, -90, 108, -108]) {
    const candidate = build(y + shift);
    const last = candidate[candidate.length - 1];
    if (candidate[0].y1 < usableTop + 36 || last.y1 > lowest) continue;
    if (!overlapsBar(candidate)) return candidate;
  }
  return build(y);
}

export function makeMovingBars(level: number, width: number, height: number): MovingBar[] {
  const { movingBarCount, movingBarSpeed } = getDifficultyProfile(level);
  if (movingBarCount === 0) return [];

  const course = makeCourse(level, width, height);
  const lanes: Array<{ minX: number; maxX: number; centerX: number }> = [{
    minX: 28,
    maxX: width - 28,
    centerX: width / 2,
  }];

  const scanSafeYs = (bands: Array<{ minY: number; maxY: number }>) => {
    const found: number[] = [];
    for (let y = 110; y <= height - 110; y += 18) {
      const blocked = bands.some((band) => y >= band.minY && y <= band.maxY);
      if (!blocked) found.push(y);
    }
    return found;
  };
  const courseBands = course.map((segment) => ({
    minY: Math.min(segment.y1, segment.y2) - STONE_RADIUS * 2,
    maxY: Math.max(segment.y1, segment.y2) + STONE_RADIUS * 2,
  }));
  const safeYs = scanSafeYs(courseBands);

  if (safeYs.length === 0) return [];

  const barLength = 88;
  const count = movingBarCount;
  const bars: MovingBar[] = [];
  const reserved: Segment[] = [...course];

  for (let index = 0; index < count; index += 1) {
    const lane = lanes[(level + index) % lanes.length];
    const direction = (level + index) % 2 === 0 ? 1 : -1;
    const maxTravel = Math.max(18, Math.min(40, (lane.maxX - lane.minX - barLength) / 2));
    const centerX = lane.centerX;
    const candidateY = safeYs[(level * 3 + index) % safeYs.length];

    const base = {
      x1: centerX - barLength / 2,
      y1: candidateY,
      x2: centerX + barLength / 2,
      y2: candidateY,
    };

    let chosenY = candidateY;
    let chosenBase = base;
    let found = false;

    for (let offset = 0; offset < safeYs.length; offset += 1) {
      const candidate = {
        x1: centerX - barLength / 2,
        y1: safeYs[(level * 3 + index + offset) % safeYs.length],
        x2: centerX + barLength / 2,
        y2: safeYs[(level * 3 + index + offset) % safeYs.length],
      };
      if (!segmentCollidesWithAny(candidate, reserved, 18)) {
        chosenBase = candidate;
        chosenY = candidate.y1;
        found = true;
        break;
      }
    }

    if (!found) continue;

    reserved.push(chosenBase);
    bars.push({
      id: `sweep-${level}-${index}`,
      segment: chosenBase,
      axis: 'x',
      direction: direction as -1 | 1,
      travel: maxTravel,
      speed: movingBarSpeed + ((level + index) % 3) * 0.12,
      phase: (level + index) * 0.8,
    });
  }

  return bars;
}

export function positionMovingBar(bar: MovingBar, time: number): Segment {
  const offset = Math.sin(time * bar.speed + bar.phase) * bar.travel * bar.direction;

  if (bar.axis === 'x') {
    return {
      x1: bar.segment.x1 + offset,
      y1: bar.segment.y1,
      x2: bar.segment.x2 + offset,
      y2: bar.segment.y2,
    };
  }

  return {
    x1: bar.segment.x1,
    y1: bar.segment.y1 + offset,
    x2: bar.segment.x2,
    y2: bar.segment.y2 + offset,
  };
}

export function renderedMovingBars(blueprints: MovingBar[], time: number) {
  return blueprints.map((bar) => positionMovingBar(bar, time));
}

export function makePortals(level: number, width: number, height: number): PortalPair[] {
  const { portalPairCount } = getDifficultyProfile(level);
  if (portalPairCount === 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const bounds: PlacementBounds = {
    minX: HOLE_RADIUS + 16,
    maxX: width - HOLE_RADIUS - 16,
    minY: usableTop + 50,
    maxY: usableBottom - 30,
  };
  // The ring (18) plus the tooth length (8) must clear every barrier, and portals need room for each other.
  const SPINE_CLEARANCE = HOLE_RADIUS + 10;
  const PORTAL_GAP = HOLE_RADIUS * 2 + 22;
  const fixedBars = [...makeCourse(level, width, height), ...makeBouncyBarriers(level, width, height)];
  const sweeps = makeMovingBars(level, width, height).map(sweptSegment);
  const placed: Point[] = [];
  const directEscapeLine: Segment = {
    x1: width / 2,
    y1: height - 57,
    x2: width / 2,
    y2: 51,
  };
  const DIRECT_SPINE_CLEARANCE = 44;
  const goalPoint = { x: width / 2, y: 51 };
  const canReachGoalDirectly = (candidate: Point) => {
    const shot: Segment = { x1: candidate.x, y1: candidate.y, x2: goalPoint.x, y2: goalPoint.y };
    return ![...fixedBars, ...sweeps].some((bar) => segmentDistance(shot, bar) <= STONE_RADIUS + 4);
  };

  const scoreFor = (sweepNeed: number) => (candidate: Point) =>
    Math.min(
      clearanceTo(candidate, fixedBars) - SPINE_CLEARANCE,
      segmentDistance(
        { x1: candidate.x, y1: candidate.y, x2: candidate.x, y2: candidate.y },
        directEscapeLine,
      ) - DIRECT_SPINE_CLEARANCE,
      canReachGoalDirectly(candidate) ? -60 : 0,
      sweeps.length > 0 ? clearanceTo(candidate, sweeps) - sweepNeed : Infinity,
      placed.reduce((nearest, other) => Math.min(nearest, Math.hypot(candidate.x - other.x, candidate.y - other.y)), Infinity) - PORTAL_GAP,
    );
  const place = (anchor: Point) => {
    // Keep clear of fixed bars always; keep clear of the moving bars' sweep as far as the layout allows.
    const tiers = [SPINE_CLEARANCE, HOLE_RADIUS, -Infinity];
    let point = anchor;
    for (const sweepNeed of tiers) {
      const score = scoreFor(sweepNeed);
      point = placeNear(anchor, score, bounds);
      if (score(point) >= 0) break;
    }
    placed.push(point);
    return point;
  };

  const pairs: PortalPair[] = [];
  for (let index = 0; index < portalPairCount; index += 1) {
    const yOffset = index * 74;
    pairs.push({
      id: `portal-${level}-${index}`,
      label: String.fromCharCode(65 + index),
      a: place({ x: width * (index === 0 ? 0.22 : 0.78), y: usableTop + 100 + yOffset }),
      b: place({ x: width * (index === 0 ? 0.78 : 0.22), y: usableBottom - 70 - yOffset }),
    });
  }

  return pairs;
}

export function isStoneColliding(point: Point, obstacles: Segment[], padding = 3) {
  return obstacles.some((line) => distanceToSegment(point, line) < STONE_RADIUS + padding);
}

export function bounceFromBarriers(point: Point, velocity: Point, barriers: Segment[]) {
  const barrier = barriers.find((line) => distanceToSegment(point, line) < STONE_RADIUS + 8);
  if (!barrier) return { point, velocity, bounced: false };

  const horizontal = Math.abs(barrier.x2 - barrier.x1) >= Math.abs(barrier.y2 - barrier.y1);
  const clearance = STONE_RADIUS + 10;
  if (horizontal) {
    const direction = point.y <= barrier.y1 ? -1 : 1;
    return {
      point: { x: point.x, y: barrier.y1 + direction * clearance },
      velocity: { x: velocity.x, y: velocity.y === 0 ? direction * 2.2 : -velocity.y },
      bounced: true,
    };
  }

  const direction = point.x <= barrier.x1 ? -1 : 1;
  return {
    point: { x: barrier.x1 + direction * clearance, y: point.y },
    velocity: { x: velocity.x === 0 ? direction * 2.2 : -velocity.x, y: velocity.y },
    bounced: true,
  };
}

type PortalEntry = {
  point: Point;
  portalLock: string | null;
  enteredPortalId: string | null;
};

export function resolvePortalEntry(
  point: Point,
  portals: PortalPair[],
  portalLock: string | null,
): PortalEntry {
  let nextLock = portalLock;
  if (nextLock) {
    const [lockedPortalId, lockedHole] = nextLock.split(':');
    const lockedPortal = portals.find((portal) => portal.id === lockedPortalId);
    const lockedPoint = lockedPortal?.[lockedHole === 'a' ? 'a' : 'b'];
    if (!lockedPoint || Math.hypot(point.x - lockedPoint.x, point.y - lockedPoint.y) > HOLE_RADIUS + STONE_RADIUS + 8) {
      nextLock = null;
    }
  }

  const enteredPortal = portals.find((portal) => {
    const nearA = Math.hypot(point.x - portal.a.x, point.y - portal.a.y) < HOLE_RADIUS + STONE_RADIUS;
    const nearB = Math.hypot(point.x - portal.b.x, point.y - portal.b.y) < HOLE_RADIUS + STONE_RADIUS;
    return (nearA && nextLock !== `${portal.id}:a`) || (nearB && nextLock !== `${portal.id}:b`);
  });

  if (!enteredPortal) {
    return { point, portalLock: nextLock, enteredPortalId: null };
  }

  const nearA = Math.hypot(point.x - enteredPortal.a.x, point.y - enteredPortal.a.y) < HOLE_RADIUS + STONE_RADIUS;
  const exit = nearA ? enteredPortal.b : enteredPortal.a;
  return {
    point: exit,
    portalLock: `${enteredPortal.id}:${nearA ? 'b' : 'a'}`,
    enteredPortalId: enteredPortal.id,
  };
}

export type PortalStep = PortalEntry & { collided: boolean };

/**
 * The collision check intentionally happens before teleporting. A portal exit
 * is a safe landing for this frame, so an obstacle at the exit cannot cause a
 * surprise hit immediately after a successful teleport.
 */
export function resolvePortalStep(
  point: Point,
  portals: PortalPair[],
  portalLock: string | null,
  obstacles: Segment[],
): PortalStep {
  const portalEntry = resolvePortalEntry(point, portals, portalLock);
  return {
    ...portalEntry,
    collided: isStoneColliding(point, obstacles),
  };
}