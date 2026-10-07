import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOLE_RADIUS,
  distanceToSegment,
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

test('story scenes are finite for every chapter and progress value', async () => {
  const { sceneArt } = await import('../lib/scenes.ts');
  const { CHAPTERS } = await import('../lib/story.ts');
  for (const chapter of CHAPTERS) {
    for (const kind of ['open', 'end'] as const) {
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const art = sceneArt(chapter.id, kind, p, palette);
        assert.ok(art.ops.length > 3);
        for (const op of art.ops) assert.ok(!/NaN|undefined|Infinity/.test(opToSvg(op)), `${chapter.id}/${kind}@${p.toFixed(2)}`);
      }
    }
  }
});
