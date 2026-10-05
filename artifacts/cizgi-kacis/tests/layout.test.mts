import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOLE_RADIUS,
  isDirectEscapeBlocked,
  segmentHitsObstacle,
  distanceToSegment,
  distanceBetweenSegments,
  makeBouncyBarriers,
  makeCourse,
  makeMovingBars,
  makePortals,
} from '../game-logic.ts';
import { PORTAL_COLORS, buildStaticArt, goalArt, legendArt, mix, opToSvg, stoneArt, thornOps, type Palette } from '../lib/boardArt.ts';

const BOARDS = [
  { width: 360, height: 520 },
  { width: 360, height: 560 },
  { width: 390, height: 700 },
];

const palette: Palette = {
  obstacle: '#E8645A',
  stone: '#F28C66',
  stoneHighlight: '#F5C451',
  goal: '#5FD6B0',
  gridLine: '#223652',
  surface: '#111C2E',
  background: '#0B1220',
  border: '#2A3F5F',
};

function segmentsOverlap(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }, pad = 8) {
  const minX = Math.min(a.x1, a.x2, b.x1, b.x2) - pad;
  const maxX = Math.max(a.x1, a.x2, b.x1, b.x2) + pad;
  const minY = Math.min(a.y1, a.y2, b.y1, b.y2) - pad;
  const maxY = Math.max(a.y1, a.y2, b.y1, b.y2) + pad;

  const aXMin = Math.min(a.x1, a.x2) - pad;
  const aXMax = Math.max(a.x1, a.x2) + pad;
  const aYMin = Math.min(a.y1, a.y2) - pad;
  const aYMax = Math.max(a.y1, a.y2) + pad;
  const bXMin = Math.min(b.x1, b.x2) - pad;
  const bXMax = Math.max(b.x1, b.x2) + pad;
  const bYMin = Math.min(b.y1, b.y2) - pad;
  const bYMax = Math.max(b.y1, b.y2) + pad;

  return !(aXMax < bXMin || bXMax < aXMin || aYMax < bYMin || bYMax < aYMin) && !(maxX - minX <= 0 || maxY - minY <= 0);
}

test('static thorn bars and moving bars do not overlap each other', () => {
  for (const { width, height } of BOARDS) {
    for (let level = 1; level <= 25; level += 1) {
      const staticBars = makeCourse(level, width, height);
      const movingBars = makeMovingBars(level, width, height).map((bar) => ({
        x1: bar.segment.x1,
        y1: bar.segment.y1,
        x2: bar.segment.x2,
        y2: bar.segment.y2,
      }));

      for (const [index, first] of staticBars.entries()) {
        for (const second of staticBars.slice(index + 1)) {
          assert.ok(!segmentsOverlap(first, second, 6), `level ${level}: static thorn bars overlap (${JSON.stringify(first)} vs ${JSON.stringify(second)})`);
        }
      }

      for (const staticBar of staticBars) {
        for (const movingBar of movingBars) {
          assert.ok(!segmentsOverlap(staticBar, movingBar, 12), `level ${level}: moving bar overlaps a static thorn bar`);
        }
      }
    }
  }
});


test('continuous movement detects thin barriers between frames', () => {
  const thinBarrier = { x1: 100, y1: 100, x2: 100, y2: 220 };
  assert.equal(
    segmentHitsObstacle({ x: 80, y: 150 }, { x: 120, y: 150 }, thinBarrier, STONE_RADIUS + 3),
    true,
  );
  assert.equal(
    segmentHitsObstacle({ x: 80, y: 150 }, { x: 90, y: 150 }, thinBarrier, STONE_RADIUS + 3),
    false,
  );
});

test('direct escape validation is geometric, not hard-coded for vertical boards', () => {
  const origin = { x: 180, y: 463 };
  const goal = { x: 180, y: 51 };
  const blockingGate = { x1: 120, y1: 250, x2: 240, y2: 250 };
  const sideBarrier = { x1: 40, y1: 250, x2: 100, y2: 250 };
  assert.equal(isDirectEscapeBlocked(origin, goal, [blockingGate]), true);
  assert.equal(isDirectEscapeBlocked(origin, goal, [sideBarrier]), false);
});

test('levels 3+ never leave a clean one-launch path from the stone to the exit', () => {
  for (const { width, height } of BOARDS) {
    const origin = { x: width / 2, y: height - 57 };
    const goal = { x: width / 2, y: 51 };
    for (let level = 3; level <= 40; level += 1) {
      const obstacles = [
        ...makeCourse(level, width, height),
        ...makeBouncyBarriers(level, width, height),
        ...makeMovingBars(level, width, height).map((bar) => ({
          x1: bar.segment.x1 - bar.travel,
          y1: bar.segment.y1,
          x2: bar.segment.x2 + bar.travel,
          y2: bar.segment.y2,
        })),
      ];
      assert.ok(
        isDirectEscapeBlocked(origin, goal, obstacles),
        `level ${level} ${width}x${height}: direct start-to-exit path is still open`,
      );
    }
  }
});

test('portals are useful shortcuts: reachable entry, forward exit, real obstacle bypass', () => {
  for (const { width, height } of BOARDS) {
    const start = { x: width / 2, y: height - 57 };
    const goal = { x: width / 2, y: 51 };
    for (let level = 4; level <= 40; level += 1) {
      const obstacles = [
        ...makeCourse(level, width, height),
        ...makeBouncyBarriers(level, width, height),
        ...makeMovingBars(level, width, height).map((bar) => ({
          x1: bar.segment.x1 - bar.travel,
          y1: bar.segment.y1,
          x2: bar.segment.x2 + bar.travel,
          y2: bar.segment.y2,
        })),
      ];

      for (const pair of makePortals(level, width, height)) {
        const progress = pair.a.y - pair.b.y;
        const span = { x1: pair.a.x, y1: pair.a.y, x2: pair.b.x, y2: pair.b.y };
        const bypassed = obstacles.filter(
          (obstacle) => distanceBetweenSegments(span, obstacle) <= 13 + 8,
        ).length;

        assert.ok(
          !isDirectEscapeBlocked(start, pair.a, obstacles),
          `level ${level}: portal ${pair.id} entry is not directly reachable from start`,
        );
        assert.ok(
          progress >= Math.max(100, height * 0.20),
          `level ${level}: portal ${pair.id} does not move the player forward`,
        );
        assert.ok(
          Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y) >= Math.max(140, height * 0.30),
          `level ${level}: portal ${pair.id} endpoints are too close`,
        );
        assert.ok(
          isDirectEscapeBlocked(pair.b, goal, obstacles),
          `level ${level}: portal ${pair.id} exit makes the level an instant win`,
        );
        assert.ok(
          bypassed >= 1,
          `level ${level}: portal ${pair.id} does not bypass an obstacle`,
        );
      }
    }
  }
});


test('portal endpoints stay away from the direct start-to-exit spine', () => {
  for (const { width, height } of BOARDS) {
    const spine = { x1: width / 2, y1: height - 57, x2: width / 2, y2: 51 };
    for (let level = 4; level <= 40; level += 1) {
      for (const pair of makePortals(level, width, height)) {
        for (const point of [pair.a, pair.b]) {
          assert.ok(
            distanceToSegment(point, spine) >= 43,
            `level ${level}: portal ${pair.id} is too close to the direct escape spine`,
          );
        }
      }
    }
  }
});

test('portal teleports cannot be followed by a clean direct shot to the exit', () => {
  for (const { width, height } of BOARDS) {
    const goal = { x: width / 2, y: 51 };
    for (let level = 4; level <= 40; level += 1) {
      const obstacles = [
        ...makeCourse(level, width, height),
        ...makeBouncyBarriers(level, width, height),
        ...makeMovingBars(level, width, height).map((bar) => ({
          x1: bar.segment.x1 - bar.travel,
          y1: bar.segment.y1,
          x2: bar.segment.x2 + bar.travel,
          y2: bar.segment.y2,
        })),
      ];
      for (const pair of makePortals(level, width, height)) {
        for (const point of [pair.a, pair.b]) {
          assert.ok(
            isDirectEscapeBlocked(point, goal, obstacles),
            `level ${level}: portal ${pair.id} can lead directly to the exit after teleport`,
          );
        }
      }
    }
  }
});

test('portals in the story levels no longer sit on top of thorn bars or bouncers', () => {
  for (const { width, height } of BOARDS) {
    for (let level = 4; level <= 12; level += 1) {
      const bars = [...makeCourse(level, width, height), ...makeBouncyBarriers(level, width, height)];
      for (const pair of makePortals(level, width, height)) {
        for (const point of [pair.a, pair.b]) {
          const clearance = Math.min(...bars.map((bar) => distanceToSegment(point, bar)));
          assert.ok(clearance >= HOLE_RADIUS - 0.5, `level ${level} ${width}x${height}: portal ${pair.id} is only ${clearance.toFixed(1)}px from a barrier`);
        }
      }
    }
  }
});

test('portal endpoints never overlap each other and stay on the board', () => {
  for (const { width, height } of BOARDS) {
    for (let level = 4; level <= 40; level += 1) {
      const points = makePortals(level, width, height).flatMap((pair) => [pair.a, pair.b]);
      points.forEach((point, index) => {
        assert.ok(point.x >= HOLE_RADIUS && point.x <= width - HOLE_RADIUS, `level ${level}: portal x off board`);
        assert.ok(point.y > 60 && point.y < height - 60, `level ${level}: portal y off board`);
        points.slice(index + 1).forEach((other) => {
          assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= HOLE_RADIUS * 2, `level ${level}: two portals overlap`);
        });
      });
    }
  }
});

test('bouncers avoid horizontal thorn bars in the story levels (almost always)', () => {
  let overlaps = 0;
  let total = 0;
  for (const { width, height } of BOARDS) {
    for (let level = 3; level <= 16; level += 1) {
      const horizontals = makeCourse(level, width, height).filter((bar) => bar.y1 === bar.y2);
      for (const bouncer of makeBouncyBarriers(level, width, height)) {
        total += 1;
        if (horizontals.some((bar) => Math.abs(bar.y1 - bouncer.y1) < 20 && Math.min(bar.x2, bouncer.x2) - Math.max(bar.x1, bouncer.x1) > 0)) overlaps += 1;
      }
    }
  }
  assert.ok(overlaps / total < 0.1, `${overlaps}/${total} bouncers still lie on a thorn bar`);
});

test('layout stays deterministic after the placement change', () => {
  for (const { width, height } of BOARDS) {
    assert.deepEqual(makePortals(9, width, height), makePortals(9, width, height));
    assert.deepEqual(makeBouncyBarriers(9, width, height), makeBouncyBarriers(9, width, height));
    assert.deepEqual(makeMovingBars(9, width, height), makeMovingBars(9, width, height));
  }
});

test('board art is finite, complete and serialises to valid SVG for every level', () => {
  for (let level = 1; level <= 40; level += 1) {
    const width = 360;
    const height = 520;
    const art = buildStaticArt(
      {
        width,
        height,
        course: makeCourse(level, width, height),
        bouncy: makeBouncyBarriers(level, width, height),
        portals: makePortals(level, width, height),
        movingBlueprints: makeMovingBars(level, width, height),
        goal: { x: width / 2, y: 51 },
        origin: { x: width / 2, y: height - 57 },
        exitLabel: 'ÇIKIŞ',
      },
      palette,
    );
    assert.ok(art.ops.length > 20);
    for (const op of art.ops) {
      const svg = opToSvg(op);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `level ${level}: bad op ${svg}`);
    }
    const ids = new Set(art.defs.map((def) => def.id));
    for (const op of art.ops) {
      const svg = opToSvg(op);
      const ref = /url\(#([^)]+)\)/.exec(svg);
      if (ref) assert.ok(ids.has(ref[1]), `level ${level}: gradient ${ref[1]} is not defined`);
    }
  }
});

test('art helpers: colour mixing, stone, goal, legend and portal palette', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(PORTAL_COLORS.length, 3);
  const stone = stoneArt(palette.stone);
  assert.ok(stone.defs.some((def) => def.id === 'stone-body'));
  assert.ok(goalArt({ x: 10, y: 10 }, 'EXIT', palette).ops.some((op) => op.k === 'text' && op.s === 'EXIT'));
  for (const kind of ['thorn', 'moving', 'bouncy', 'portal', 'exit'] as const) {
    assert.ok(legendArt(kind, palette).ops.length > 0, kind);
  }
  assert.ok(thornOps({ x1: 0, y1: 0, x2: 0, y2: 90 }, palette.obstacle).some((op) => op.k === 'path'));
});
