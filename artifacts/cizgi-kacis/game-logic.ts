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

export function makeCourse(level: number, width: number, height: number): Segment[] {
  const lines: Segment[] = [];
  const { barrierCount: count } = getDifficultyProfile(level);
  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const laneWidth = width / (count + 1);

  for (let index = 0; index < count; index += 1) {
    const x = laneWidth * (index + 1);
    const gap = Math.max(30, 62 - Math.floor(level / 3) * 5) + ((level + index * 13) % 3) * 11;
    const shift = (index % 2) * 24;
    const topLength = Math.max(44, (height - usableTop - usableBottom) / 2 + shift);
    const topY = usableTop + ((index * 37 + level * 19) % 55);
    const bottomY = Math.min(usableBottom - 22, topY + topLength + gap);
    lines.push({ x1: x, y1: usableTop, x2: x, y2: topY });
    lines.push({ x1: x, y1: bottomY, x2: x, y2: usableBottom });
  }

  if (level >= 3) {
    const y = usableTop + 100 + ((level * 23) % 60);
    lines.push({ x1: 26, y1: y, x2: width * 0.42, y2: y });
  }
  if (level >= 5) {
    const y = usableTop + 214 + ((level * 17) % 56);
    lines.push({ x1: width * 0.58, y1: y, x2: width - 26, y2: y });
  }
  if (level >= 7) {
    const y = usableTop + 158 + ((level * 29) % 52);
    lines.push({ x1: 26, y1: y, x2: width * 0.34, y2: y });
  }
  return lines;
}

export function makeBouncyBarriers(level: number, width: number, height: number): Segment[] {
  const { bouncyBarrierCount } = getDifficultyProfile(level);
  if (bouncyBarrierCount === 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const y = usableTop + 62 + ((level * 31) % Math.max(40, usableBottom - usableTop - 120));
  const barriers: Segment[] = [];
  for (let index = 0; index < bouncyBarrierCount; index += 1) {
    const length = width * (index === 0 ? 0.34 : 0.24);
    const left = index === 0 ? (level % 2 === 0 ? width * 0.1 : width * 0.56) : width * 0.18;
    const offsetY = index * 74;
    barriers.push({ x1: left, y1: y + offsetY, x2: left + length, y2: y + offsetY });
  }
  return barriers;
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

  const safeYs: number[] = [];
  for (let y = 110; y <= height - 110; y += 18) {
    const blocked = course.some((segment) => {
      const minY = Math.min(segment.y1, segment.y2) - STONE_RADIUS * 2;
      const maxY = Math.max(segment.y1, segment.y2) + STONE_RADIUS * 2;
      return y >= minY && y <= maxY;
    });
    if (!blocked) safeYs.push(y);
  }

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

export function makePortals(level: number, width: number, height: number): PortalPair[] {
  const { portalPairCount } = getDifficultyProfile(level);
  if (portalPairCount === 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const pairCount = portalPairCount;
  const pairs: PortalPair[] = [];

  for (let index = 0; index < pairCount; index += 1) {
    const yOffset = index * 74;
    pairs.push({
      id: `portal-${level}-${index}`,
      label: String.fromCharCode(65 + index),
      a: {
        x: width * (index === 0 ? 0.22 : 0.78),
        y: usableTop + 100 + yOffset,
      },
      b: {
        x: width * (index === 0 ? 0.78 : 0.22),
        y: usableBottom - 70 - yOffset,
      },
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