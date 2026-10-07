/**
 * Renders the board artwork to SVG using the exact same builders the app uses.
 * Usage: node --experimental-strip-types scripts/art-preview.mts [level] [outDir] [time] [night]
 * Convert to PNG with any SVG tool, e.g. `rsvg-convert board.svg -o board.png`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { levelKind, makeBouncyBarriers, makeCourse, makeMovingBars, makePortals, positionMovingBar, STONE_RADIUS } from '../game-logic.ts';
import {
  type LegendKind, LEGEND_SIZE, type Palette, aimOps, artToSvgInner, buildStaticArt, eraserOps, ghostBarOps, ghostOps, hintPathOps,
  inkLineOps, legendArt, movingBarOps, nightArt, pencilOps, stainOps, stoneArt, tearOps, thornOps, trailOps,
} from '../lib/boardArt.ts';
import { INK_LINE_LIFETIME, eraserConfig, eraserRect, erasedFlags, makeHazards, makeStain, pencilBars, predictPath } from '../lib/mechanics.ts';

const level = Number(process.argv[2] ?? 10);
const outDir = process.argv[3] ?? '/tmp/art';
const time = Number(process.argv[4] ?? 2.4);
const night = process.argv[5] === 'night';
const width = 360;
const height = 520;

const palette: Palette = {
  obstacle: '#E8645A', stone: '#F28C66', stoneHighlight: '#F5C451', goal: '#5FD6B0',
  gridLine: '#223652', surface: '#111C2E', background: '#0B1220', border: '#2A3F5F',
};

const course = makeCourse(level, width, height);
const bouncy = makeBouncyBarriers(level, width, height);
const portals = makePortals(level, width, height);
const movingBlueprints = makeMovingBars(level, width, height);
const hazards = makeHazards(level, width, height);
const eraser = eraserConfig(level, width, height);
const origin = { x: width / 2, y: height - 57 };
const goal = { x: width / 2, y: 51 };

const staticArt = buildStaticArt({ width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel: 'ÇIKIŞ', hazards, hideCourse: eraser !== null }, palette);
const dyn: string[] = [];
const add = (ops: Parameters<typeof artToSvgInner>[0]['ops']) => dyn.push(artToSvgInner({ defs: [], ops }));
add(stainOps(makeStain({ x: 150, y: 330 }, 1), palette.stone));
add(ghostOps(Array.from({ length: 12 }, (_, i) => ({ x: origin.x - 40 - i * 4, y: origin.y - 10 - i * 14 })), palette.obstacle));
hazards.tears.forEach((tear, i) => add(tearOps(tear, i === 1)));
pencilBars(level, width, height, time).forEach((bar) => add(pencilOps(bar)));
if (eraser) {
  const erased = erasedFlags(eraser, time, course);
  course.forEach((seg, i) => add(erased[i] ? ghostBarOps(seg, palette.obstacle) : thornOps(seg, palette.obstacle)));
  add(eraserOps(eraserRect(eraser, time)));
}
movingBlueprints.forEach((bar) => add(movingBarOps(positionMovingBar(bar, 1.3), palette)));
add(inkLineOps({ x1: 120, y1: 400, x2: 215, y2: 372 }, 0.4, INK_LINE_LIFETIME, palette.stone));
add(hintPathOps(predictPath(origin, { x: origin.x + 30, y: origin.y - 75 }, [...course, ...bouncy]), palette.stoneHighlight));
add(aimOps(origin, { x: origin.x + 30, y: origin.y - 75 }, palette.stoneHighlight));
add(trailOps(Array.from({ length: 14 }, (_, i) => ({ x: origin.x + i * 3, y: origin.y - i * 17 })), palette.stone));
const stone = stoneArt(palette.stone);
const nightLayer = night ? artToSvgInner(nightArt({ x: origin.x + 20, y: origin.y - 120 }, width, height, palette.background)) : '';

const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" rx="22" fill="${palette.surface}"/>
${artToSvgInner(staticArt)}${dyn.join('')}${nightLayer}
<g transform="translate(${origin.x + 20} ${origin.y - 120})">${artToSvgInner(stone)}</g>
</svg>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/board.svg`, board);
console.log(`level ${level} (${levelKind(level)}): ${course.length} thorn bars, ${bouncy.length} bouncers, ${portals.length} portals, ${movingBlueprints.length} moving, ${hazards.puddles.length} puddles, ${hazards.magnets.length} magnets, ${hazards.tears.length} tears, eraser ${eraser ? 'yes' : 'no'}`);
void LEGEND_SIZE; void STONE_RADIUS; void ({} as LegendKind); void legendArt;
