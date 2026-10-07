/**
 * Animated story scenes for the chapter cards, as pure functions of progress `p` (0..1).
 * They return the same drawing ops as the board art, so they render and test the same way.
 */
import { type Art, type Op, type Palette, PORTAL_COLORS, lighten, pencilGlyph } from './boardArt.ts';

export const SCENE_SIZE = { width: 300, height: 96 };
const { width: W } = SCENE_SIZE;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);

function dot(x: number, y: number, color: string, scale = 1): Op[] {
  return [
    { k: 'circle', cx: x, cy: y, r: 11 * scale, fill: color },
    { k: 'circle', cx: x - 3.4 * scale, cy: y - 1 * scale, r: 1.8 * scale, fill: '#0B1220' },
    { k: 'circle', cx: x + 3.4 * scale, cy: y - 1 * scale, r: 1.8 * scale, fill: '#0B1220' },
  ];
}

function ruled(p: Palette): Op[] {
  return [28, 52, 76].map((y) => ({ k: 'line' as const, x1: 0, y1: y, x2: W, y2: y, stroke: p.gridLine, sw: 1, o: 0.6 }));
}

function eraserBlock(x: number, y: number, w: number): Op[] {
  return [
    { k: 'rect', x: x - 5, y: y - 5, w: w + 10, h: 38, rx: 12, fill: '#FF6F91', o: 0.18 },
    { k: 'rect', x, y, w, h: 28, rx: 9, fill: '#F7B4C4' },
    { k: 'rect', x: x + w * 0.62, y, w: w * 0.38, h: 28, rx: 9, fill: '#4D6FD3' },
  ];
}

export function sceneArt(chapterId: string, kind: 'open' | 'end', p: number, palette: Palette): Art {
  const t = clamp01(p);
  const ops: Op[] = [...ruled(palette)];
  const stone = palette.stone;

  if (kind === 'end' && chapterId === 'first-trace') {
    // The Eraser's shadow creeps in from the page corner while Dot looks over its shoulder.
    const x = W + 30 - ease(t) * (W * 0.62);
    ops.push({ k: 'circle', cx: x + 30, cy: 52, r: 70 + t * 30, fill: '#000000', o: 0.14 + t * 0.12 });
    ops.push(...eraserBlock(x, 36, 78));
    ops.push(...dot(70, 52, stone));
    if (t > 0.5) ops.push({ k: 'text', x: 70, y: 28, s: '!', fill: palette.stoneHighlight, size: 20, weight: '800' });
  } else if (kind === 'end' && chapterId === 'thorn-garden') {
    // Spiral binding holes light up one after another along the page edge.
    for (let i = 0; i < 6; i += 1) {
      const lit = clamp01((t - i * 0.12) / 0.2);
      const x = 36 + i * 46;
      ops.push({ k: 'circle', cx: x, cy: 52, r: 13, fill: palette.background, stroke: PORTAL_COLORS[i % 3], sw: 2, o: 0.25 + 0.75 * lit });
      ops.push({ k: 'circle', cx: x, cy: 52, r: 3 + 4 * lit, fill: PORTAL_COLORS[i % 3], o: 0.8 * lit });
    }
    ops.push(...dot(36 + clamp01(t) * 230, 82, stone, 0.7));
  } else if (kind === 'end' && chapterId === 'portal-room') {
    // A dark ink storm gathers; lightning flickers.
    [[90, 26, 22], [124, 20, 28], [160, 26, 24], [196, 22, 26], [230, 28, 20]].forEach(([cx, cy, r]) => {
      ops.push({ k: 'circle', cx, cy, r: r * (0.7 + 0.3 * ease(t)), fill: '#2A2145', o: 0.95 });
    });
    for (let i = 0; i < 9; i += 1) {
      const x = 70 + i * 20;
      const y = 46 + ((t * 120 + i * 13) % 44);
      ops.push({ k: 'line', x1: x, y1: y, x2: x - 3, y2: y + 9, stroke: '#8FD3FF', sw: 1.6, o: 0.6, cap: 'round' });
    }
    if (Math.sin(t * 22) > 0.55) ops.push({ k: 'path', d: 'M150 36L140 58L152 58L142 86', stroke: '#F5C451', sw: 3, cap: 'round', join: 'round' });
    ops.push(...dot(40, 80, stone, 0.6));
  } else if (kind === 'end' && chapterId === 'storm-corridor') {
    // A pencil tip glows in the storm while a huge pink shadow grows behind.
    ops.push({ k: 'circle', cx: W + 20, cy: 56, r: 24 + ease(t) * 76, fill: '#FF6F91', o: 0.22 });
    ops.push({ k: 'circle', cx: 120, cy: 64, r: 22 + Math.sin(t * 14) * 4, fill: palette.stoneHighlight, o: 0.18 });
    ops.push(...pencilGlyph({ x: 112, y: 70 }, 1.1));
    ops.push(...dot(52, 64, stone, 0.9));
  } else if (kind === 'end' && chapterId === 'erasers-shadow') {
    // The Artist's pencil draws the final line; sparks fly at the end.
    const reach = 30 + ease(t) * 230;
    ops.push({ k: 'path', d: `M30 70Q${(30 + reach) / 2} ${50 - 14 * Math.sin(t * 3)} ${reach} 62`, stroke: palette.goal, sw: 3.4, cap: 'round' });
    ops.push(...pencilGlyph({ x: reach, y: 62 }, 1));
    if (t > 0.75) {
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2 + t * 4;
        ops.push({ k: 'circle', cx: reach + Math.cos(a) * 24, cy: 54 + Math.sin(a) * 18, r: 2.2, fill: palette.stoneHighlight, o: 0.9 });
      }
    }
    ops.push(...dot(30, 70, stone, 0.8));
  } else {
    // Generic: the Artist's pencil underlines the chapter name.
    const reach = 40 + ease(t) * 220;
    ops.push({ k: 'line', x1: 40, y1: 62, x2: reach, y2: 62, stroke: palette.goal, sw: 3, cap: 'round' });
    ops.push(...pencilGlyph({ x: reach, y: 62 }, 0.9));
    ops.push(...dot(60, 40, stone, 0.85));
  }
  return { defs: [], ops };
}

export const SCENE_HIGHLIGHT = (color: string) => lighten(color, 0.3);
