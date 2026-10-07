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

export type LevelKind = 'standard' | 'precision' | 'portals' | 'relax' | 'pencil' | 'eraser' | 'boss';

const FIXED_KINDS: Record<number, LevelKind> = {
  5: 'portals', 6: 'relax', 7: 'precision', 9: 'pencil', 10: 'precision', 11: 'portals',
  12: 'relax', 13: 'eraser', 14: 'pencil', 15: 'eraser', 16: 'boss',
};
const ENDLESS_KINDS: LevelKind[] = ['standard', 'precision', 'portals', 'pencil', 'eraser'];

/** Every few levels the page changes character so the run never feels like the same course twice. */
export function levelKind(level: number): LevelKind {
  const safe = Math.max(1, Math.floor(level));
  const fixed = FIXED_KINDS[safe];
  if (fixed) return fixed;
  if (safe <= 16) return 'standard';
  if (safe % 8 === 0) return 'boss';
  return ENDLESS_KINDS[(safe - 17) % ENDLESS_KINDS.length];
}

export type DifficultyProfile = {
  gapShrink: number;
  barrierCount: number;
  movingBarCount: number;
  movingBarSpeed: number;
  portalPairCount: number;
  bouncyBarrierCount: number;
};

export function getDifficultyProfile(level: number): DifficultyProfile {
  const safeLevel = Math.max(1, Math.floor(level));
  const base = baseProfile(safeLevel);
  switch (levelKind(safeLevel)) {
    case 'portals':
      return { ...base, barrierCount: Math.max(2, base.barrierCount - 2), movingBarCount: 0, bouncyBarrierCount: 0, portalPairCount: Math.min(3, base.portalPairCount + 1) };
    case 'precision':
      return { ...base, barrierCount: Math.min(12, base.barrierCount + 1), movingBarCount: 0, gapShrink: 16 };
    case 'relax':
      return { ...base, barrierCount: Math.max(2, base.barrierCount - 2), movingBarCount: 0, gapShrink: -8 };
    case 'eraser':
    case 'boss':
      return { ...base, movingBarCount: 0 };
    case 'pencil':
      return { ...base, movingBarCount: Math.min(base.movingBarCount, 1) };
    default:
      return base;
  }
}

function baseProfile(safeLevel: number): DifficultyProfile {
  return {
    gapShrink: 0,
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

export function clearanceTo(point: Point, segments: Segment[]) {
  return segments.reduce((nearest, segment) => Math.min(nearest, distanceToSegment(point, segment)), Infinity);
}

export type PlacementBounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Finds the spot closest to `anchor` whose `score` is >= 0 (searching outwards in rings).
 * Deterministic, so a level always looks the same. Falls back to the best score found.
 */
export function placeNear(anchor: Point, score: (point: Point) => number, bounds: PlacementBounds): Point {
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

/** Longest distance one shot can travel, as a fraction of the start-to-exit distance. Below 1 on purpose. */
export const SHOT_RANGE_FRACTION = 0.62;
export const MAX_SHOT_SPEED = 7.1;
export const STOP_SPEED = 0.08;

export function startPoint(width: number, height: number): Point {
  return { x: width / 2, y: height - 57 };
}

export function exitPoint(width: number): Point {
  return { x: width / 2, y: 51 };
}

/**
 * How far the strongest shot can travel. It is always shorter than the straight line from the start to the
 * exit, so EVERY page needs at least two shots, whatever the layout (bounces and ink lines only lose energy).
 */
export function shotRange(height: number): number {
  return SHOT_RANGE_FRACTION * (height - 108);
}

export type WallGap = { y: number; x: number; w: number };

/**
 * The page is built from full-width walls, each with one gap. Gaps alternate left/right, so the stone has to
 * travel sideways between walls and cannot simply fly straight up.
 */
export function wallLayout(level: number, width: number, height: number): WallGap[] {
  const usableTop = Math.max(94, height * 0.14);
  const yFirst = height - 178;
  const yLast = usableTop + 56;
  const span = Math.max(0, yFirst - yLast);
  const capacity = Math.max(2, Math.floor(span / 68) + 1);
  const kind = levelKind(level);
  // Every wall costs the player at least one extra shot, so cap it: tall screens get roomier chambers instead.
  let wanted = Math.min(4, 2 + Math.floor((level - 1) / 3));
  if (kind === 'relax') wanted -= 1;
  if (kind === 'portals') wanted = Math.max(wanted, 3);
  const count = clamp(wanted, 2, Math.min(4, capacity));
  const { gapShrink } = getDifficultyProfile(level);
  const gapWidth = Math.max(46, 86 - Math.floor(level * 1.5) - gapShrink);
  const random = (index: number, salt: number) => {
    const value = Math.sin(level * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
    return value - Math.floor(value);
  };
  const gaps: WallGap[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = yFirst - (span * index) / (count - 1);
    const side = (index + level) % 2 === 0 ? -1 : 1;
    const edge = 0.2 + random(index, 1) * 0.1;
    gaps.push({ y, x: side < 0 ? width * edge : width * (1 - edge), w: gapWidth });
  }
  return gaps;
}

export function makeCourse(level: number, width: number, height: number): Segment[] {
  const gaps = wallLayout(level, width, height);
  const lines: Segment[] = [];
  gaps.forEach((gap) => {
    lines.push({ x1: 0, y1: gap.y, x2: gap.x - gap.w / 2, y2: gap.y });
    lines.push({ x1: gap.x + gap.w / 2, y1: gap.y, x2: width, y2: gap.y });
  });

  // Short posts inside the roomier chambers make the sideways trip a little harder.
  const kind = levelKind(level);
  const chambers = gaps.length - 1;
  const wantedPosts = level >= 3 && kind !== 'relax' ? Math.min(3, 1 + Math.floor((level - 3) / 3)) : 0;
  for (let post = 0; post < Math.min(wantedPosts, chambers); post += 1) {
    const chamber = (level + post) % chambers;
    const low = gaps[chamber].y;
    const high = gaps[chamber + 1].y;
    const room = low - high - 72;
    if (room < 18) continue;
    const length = Math.min(44, room);
    const mid = (low + high) / 2;
    const noise = Math.sin(level * 5.17 + chamber * 3.31) * 0.5 + 0.5;
    const x = width * (0.38 + noise * 0.24);
    lines.push({ x1: x, y1: mid - length / 2, x2: x, y2: mid + length / 2 });
  }
  return lines;
}

/** The strip a moving bar sweeps over time, as one segment (used so other pieces keep clear of it). */
export function sweptSegment(bar: MovingBar): Segment {
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
  const build = (baseY: number, flip = false) => {
    const barriers: Segment[] = [];
    for (let index = 0; index < bouncyBarrierCount; index += 1) {
      const length = width * (index === 0 ? 0.34 : 0.24);
      const rightSide = index === 0 && level % 2 !== 0;
      const useRight = flip ? !rightSide : rightSide;
      const left = useRight ? width * 0.56 : index === 0 ? width * 0.1 : width * 0.18;
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
  const gapZones = wallLayout(level, width, height);
  const portalPoints = makePortals(level, width, height).flatMap((pair) => [pair.a, pair.b]);
  const posts = makeCourse(level, width, height).filter((segment) => segment.x1 === segment.x2);
  const overlapsBar = (candidate: Segment[]) =>
    candidate.some((bouncer) => {
      const onBar = horizontalBars.some(
        (bar) => Math.abs(bar.y1 - bouncer.y1) < 34 && Math.min(bar.x2, bouncer.x2) - Math.max(bar.x1, bouncer.x1) > -10,
      );
      if (onBar) return true;
      // never plug the exit of a wall's gap: stay 76px away vertically from any gap the bouncer lies over
      const pluggingGap = gapZones.some(
        (gap) => Math.abs(gap.y - bouncer.y1) < 76 && Math.min(bouncer.x2, gap.x + gap.w / 2 + 24) - Math.max(bouncer.x1, gap.x - gap.w / 2 - 24) > 0,
      );
      if (pluggingGap) return true;
      // keep clear of the portals and the short posts too (checked along the bouncer's length)
      for (let x = bouncer.x1; x <= bouncer.x2; x += 12) {
        const sample = { x, y: bouncer.y1 };
        if (portalPoints.some((point) => Math.hypot(sample.x - point.x, sample.y - point.y) < HOLE_RADIUS + 26)) return true;
        if (posts.some((post) => distanceToSegment(sample, post) < 30)) return true;
      }
      return false;
    });
  const lowest = usableBottom - 40;
  const shifts = [0];
  for (let step = 6; step <= 210; step += 6) shifts.push(step, -step);
  for (const shift of shifts) {
    for (const flip of [false, true]) {
      const candidate = build(y + shift, flip);
      const last = candidate[candidate.length - 1];
      if (candidate[0].y1 < usableTop + 36 || last.y1 > lowest) continue;
      if (!overlapsBar(candidate)) return candidate;
    }
  }
  return [];
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

  for (let index = 0; index < count; index += 1) {
    const lane = lanes[(level + index) % lanes.length];
    const y = safeYs[(level * 3 + index) % safeYs.length];
    const direction = (level + index) % 2 === 0 ? 1 : -1;
    const maxTravel = Math.max(18, Math.min(40, (lane.maxX - lane.minX - barLength) / 2));
    const centerX = lane.centerX;

    bars.push({
      id: `sweep-${level}-${index}`,
      segment: { x1: centerX - barLength / 2, y1: y, x2: centerX + barLength / 2, y2: y },
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

/**
 * Portals are shortcuts, not obstacles: each pair is a ONE-WAY jump from an entrance (a) to an exit (b).
 * The entrance sits in a chamber on the far side from that wall's gap, and the exit is straight above it in
 * the chamber beyond the wall, in line with the next gap, so a stone that enters and keeps going straight
 * flies out and through the next gap. Pairs are only added while the whole page still needs more than one
 * shot: the straight start-to-exit distance minus every jump must stay above the shot range.
 */
export function makePortals(level: number, width: number, height: number): PortalPair[] {
  const { portalPairCount } = getDifficultyProfile(level);
  if (portalPairCount === 0) return [];
  const gaps = wallLayout(level, width, height);
  const origin = startPoint(width, height);
  const goal = exitPoint(width);
  const budget = Math.hypot(goal.x - origin.x, goal.y - origin.y) - shotRange(height) * 1.18;
  const topLimit = Math.max(94, height * 0.14) - 6;
  let spent = 0;
  const pairs: PortalPair[] = [];

  for (let wall = 0; wall < gaps.length && pairs.length < portalPairCount; wall += 1) {
    const gap = gaps[wall];
    const belowY = wall === 0 ? (origin.y + gap.y) / 2 : (gaps[wall - 1].y + gap.y) / 2;
    const aboveY = wall === gaps.length - 1 ? Math.max(topLimit + 24, gap.y - 56) : (gap.y + gaps[wall + 1].y) / 2;
    const x = gap.x < width / 2 ? width * 0.78 : width * 0.22;
    const a = { x, y: belowY };
    const b = { x, y: aboveY };
    const jump = Math.hypot(a.x - b.x, a.y - b.y);
    if (spent + jump > budget) continue;
    spent += jump;
    pairs.push({ id: `portal-${level}-${pairs.length}`, label: String.fromCharCode(65 + pairs.length), a, b });
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
    return nearA && nextLock !== `${portal.id}:a`;
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