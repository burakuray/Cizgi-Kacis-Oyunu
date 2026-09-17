export type Point = { x: number; y: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type MovingBar = {
  id: string;
  segment: Segment;
  axis: 'x' | 'y';
  travel: number;
  speed: number;
  phase: number;
};
export type PortalPair = { id: string; a: Point; b: Point; label: string };

export const STONE_RADIUS = 13;
export const HOLE_RADIUS = 18;

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
  const count = Math.min(2 + level, 9);
  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const laneWidth = width / (count + 1);

  for (let index = 0; index < count; index += 1) {
    const x = laneWidth * (index + 1);
    const gap = 48 + ((level + index * 13) % 3) * 17;
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
  return lines;
}

export function makeMovingBars(level: number, width: number, height: number): MovingBar[] {
  if (level < 2 || level % 4 === 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const middle = usableTop + (usableBottom - usableTop) * 0.52;
  const bars: MovingBar[] = [];

  if (level % 2 === 0) {
    bars.push({
      id: `sweep-${level}`,
      segment: { x1: width * 0.16, y1: middle, x2: width * 0.84, y2: middle },
      axis: 'y',
      travel: 22 + (level % 3) * 8,
      speed: 1.45,
      phase: level * 0.7,
    });
  } else {
    const x = width * (level % 3 === 0 ? 0.67 : 0.34);
    bars.push({
      id: `gate-${level}`,
      segment: { x1: x, y1: usableTop + 62, x2: x, y2: usableBottom - 30 },
      axis: 'x',
      travel: 20 + (level % 4) * 5,
      speed: 1.2,
      phase: level * 0.55,
    });
  }

  if (level >= 6 && level % 3 === 0) {
    const x = width * 0.5;
    bars.push({
      id: `center-${level}`,
      segment: { x1: x, y1: usableTop + 26, x2: x, y2: usableTop + 116 },
      axis: 'x',
      travel: 24,
      speed: 1.8,
      phase: level * 0.9,
    });
  }

  return bars;
}

export function positionMovingBar(bar: MovingBar, time: number): Segment {
  const offset = Math.sin(time * bar.speed + bar.phase) * bar.travel;
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
  if (level < 4 || level % 4 !== 0) return [];

  const usableTop = Math.max(94, height * 0.14);
  const usableBottom = height - 116;
  const pairCount = level >= 8 ? 2 : 1;
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