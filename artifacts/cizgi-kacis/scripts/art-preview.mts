/**
 * Renders the board artwork to SVG using the exact same builders the app uses.
 * Usage: node --experimental-strip-types scripts/art-preview.mts [level] [outDir]
 * Convert to PNG with any SVG tool, e.g. `rsvg-convert board.svg -o board.png`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  makeBouncyBarriers,
  makeCourse,
  makeMovingBars,
  makePortals,
  positionMovingBar,
  STONE_RADIUS,
} from '../game-logic.ts';
import {
  type LegendKind,
  LEGEND_SIZE,
  type Palette,
  aimOps,
  artToSvgInner,
  buildStaticArt,
  ghostOps,
  legendArt,
  movingBarOps,
  stoneArt,
  trailOps,
} from '../lib/boardArt.ts';

const level = Number(process.argv[2] ?? 10);
const outDir = process.argv[3] ?? '/tmp/art';
const width = 360;
const height = 520;

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

const course = makeCourse(level, width, height);
const bouncy = makeBouncyBarriers(level, width, height);
const portals = makePortals(level, width, height);
const movingBlueprints = makeMovingBars(level, width, height);
const origin = { x: width / 2, y: height - 57 };
const goal = { x: width / 2, y: 51 };

const staticArt = buildStaticArt({ width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel: 'ÇIKIŞ' }, palette);
const moving = movingBlueprints.flatMap((bar) => movingBarOps(positionMovingBar(bar, 1.3), palette));
const trail = Array.from({ length: 14 }, (_, i) => ({ x: origin.x + i * 3, y: origin.y - i * 17 }));
const ghost = Array.from({ length: 12 }, (_, i) => ({ x: origin.x - 40 - i * 4, y: origin.y - 10 - i * 14 }));
const aim = aimOps(origin, { x: origin.x + 30, y: origin.y - 75 }, palette.stoneHighlight);
const stone = stoneArt(palette.stone);

const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" rx="22" fill="${palette.surface}"/>
${artToSvgInner(staticArt)}
${ghostOps(ghost, palette.obstacle).map((op) => artToSvgInner({ defs: [], ops: [op] })).join('')}
${artToSvgInner({ defs: [], ops: moving })}
${artToSvgInner({ defs: [], ops: aim })}
${artToSvgInner({ defs: [], ops: trailOps(trail, palette.stone) })}
<g transform="translate(${origin.x} ${origin.y})">${artToSvgInner(stone)}</g>
</svg>`;

const kinds: LegendKind[] = ['thorn', 'moving', 'bouncy', 'portal', 'exit'];
const glyphs = kinds
  .map((kind, i) => `<g transform="translate(${20 + i * 92} 150) scale(2.4)">${artToSvgInner(legendArt(kind, palette))}</g><text x="${20 + i * 92 + 34}" y="212" fill="#9FB3C8" font-size="12" text-anchor="middle" font-family="Helvetica">${kind}</text>`)
  .join('');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240">
<rect width="480" height="240" fill="${palette.surface}"/>
<g transform="translate(70 70) scale(3)">${artToSvgInner(stone)}</g>
<text x="70" y="128" fill="#9FB3C8" font-size="12" text-anchor="middle" font-family="Helvetica">Nokta (r=${STONE_RADIUS}) ×3</text>
${glyphs.replace(/translate\(\d+ 150\)/g, (m) => m)}
</svg>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/board.svg`, board);
writeFileSync(`${outDir}/sheet.svg`, sheet);
console.log(`level ${level}: ${course.length} thorn bars, ${bouncy.length} bouncers, ${portals.length} portal pairs, ${movingBlueprints.length} moving bars -> ${outDir}`);
void LEGEND_SIZE;
