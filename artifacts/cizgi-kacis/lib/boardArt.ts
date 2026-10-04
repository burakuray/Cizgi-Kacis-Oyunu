/**
 * Board artwork as plain data. No React / react-native-svg imports so the same output can be
 * (a) rendered by `components/BoardArt.tsx`, (b) unit-tested, and (c) serialised to SVG for previews.
 */
import type { MovingBar, Point, PortalPair, Segment } from '../game-logic.ts';
import { HOLE_RADIUS, STONE_RADIUS } from '../game-logic.ts';

export type Palette = {
  obstacle: string;
  stone: string;
  stoneHighlight: string;
  goal: string;
  gridLine: string;
  surface: string;
  background: string;
  border: string;
};

export type Op =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; o?: number; cap?: 'round' | 'butt'; dash?: string }
  | { k: 'path'; d: string; fill?: string; stroke?: string; sw?: number; o?: number; cap?: 'round' | 'butt'; join?: 'round' | 'miter'; dash?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; o?: number; dash?: string }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; o?: number }
  | { k: 'text'; x: number; y: number; s: string; fill: string; size: number; weight?: string; o?: number };

export type GradStop = { o: number; c: string; a?: number };
export type Grad = { id: string; stops: GradStop[]; cx?: number; cy?: number; r?: number };
export type Art = { defs: Grad[]; ops: Op[] };

export const PORTAL_COLORS = ['#B79BFF', '#8FD3FF', '#FFD5A6'];
export const STONE_BOX = STONE_RADIUS * 2 + 14;

/* ---------- small helpers ---------- */

const f = (value: number) => String(Math.round(value * 100) / 100);

function rgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw.slice(0, 6);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * t).toString(16).padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`.toUpperCase();
}

export const lighten = (color: string, t: number) => mix(color, '#FFFFFF', t);
export const darken = (color: string, t: number) => mix(color, '#000000', t);

function frame(seg: Segment) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { len, ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len };
}

function line(seg: Segment, stroke: string, sw: number, extra: Partial<Extract<Op, { k: 'line' }>> = {}): Op {
  return { k: 'line', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, stroke, sw, cap: 'round', ...extra };
}

function spiral(cx: number, cy: number, r0: number, r1: number, turns: number, phase: number, dir: 1 | -1): string {
  const steps = 16;
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps;
    const angle = phase + dir * s * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * s;
    d += `${i === 0 ? 'M' : 'L'}${f(cx + Math.cos(angle) * r)} ${f(cy + Math.sin(angle) * r)}`;
  }
  return d;
}

/* ---------- barriers ---------- */

/** Barbed "thorn" bar: soft glow, zig-zag teeth on both sides, round-capped spine. */
export function thornOps(seg: Segment, color: string, toothColor: string = lighten(color, 0.14), spacing = 15): Op[] {
  const { len, ux, uy, nx, ny } = frame(seg);
  const count = Math.max(1, Math.floor(len / spacing));
  let d = '';
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const cx = seg.x1 + ux * len * t;
    const cy = seg.y1 + uy * len * t;
    const side = i % 2 === 0 ? 1 : -1;
    d += `M${f(cx - ux * 4.4)} ${f(cy - uy * 4.4)}L${f(cx + nx * side * 8 + ux * 2)} ${f(cy + ny * side * 8 + uy * 2)}L${f(cx + ux * 4.4)} ${f(cy + uy * 4.4)}Z`;
  }
  const shifted: Segment = { x1: seg.x1 - nx * 0.9, y1: seg.y1 - ny * 0.9, x2: seg.x2 - nx * 0.9, y2: seg.y2 - ny * 0.9 };
  return [
    line(seg, color, 12, { o: 0.14 }),
    { k: 'path', d, fill: toothColor },
    line(seg, color, 3.6),
    line(shifted, '#FFFFFF', 0.9, { o: 0.3 }),
  ];
}

export function movingBarOps(seg: Segment, p: Palette, compact = false): Op[] {
  const color = p.stoneHighlight;
  if (compact) return thornOps(seg, color, lighten(color, 0.1), 8);
  return [
    ...thornOps(seg, color, lighten(color, 0.1)),
    { k: 'circle', cx: seg.x1, cy: seg.y1, r: 4.4, fill: darken(color, 0.4), stroke: color, sw: 1.2 },
    { k: 'circle', cx: seg.x2, cy: seg.y2, r: 4.4, fill: darken(color, 0.4), stroke: color, sw: 1.2 },
  ];
}

/** Dashed rail that shows how far a moving bar travels, so its rhythm can be read before shooting. */
export function movingTrackOps(bar: MovingBar, p: Palette): Op[] {
  const seg = bar.segment;
  const cx = (seg.x1 + seg.x2) / 2;
  const cy = (seg.y1 + seg.y2) / 2;
  const horizontal = bar.axis === 'x';
  const a = horizontal ? { x: cx - bar.travel, y: cy } : { x: cx, y: cy - bar.travel };
  const b = horizontal ? { x: cx + bar.travel, y: cy } : { x: cx, y: cy + bar.travel };
  return [
    { k: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: p.stoneHighlight, sw: 1.4, o: 0.38, cap: 'round', dash: '2 6' },
    { k: 'circle', cx: a.x, cy: a.y, r: 2.4, fill: p.stoneHighlight, o: 0.5 },
    { k: 'circle', cx: b.x, cy: b.y, r: 2.4, fill: p.stoneHighlight, o: 0.5 },
  ];
}

export function bouncyOps(seg: Segment, p: Palette): Op[] {
  const { len, ux, uy, nx, ny } = frame(seg);
  const ops: Op[] = [
    line(seg, p.goal, 16, { o: 0.12 }),
    line(seg, darken(p.goal, 0.38), 10.5),
    line(seg, p.goal, 7.6),
    line({ x1: seg.x1 - nx * 1.6, y1: seg.y1 - ny * 1.6, x2: seg.x2 - nx * 1.6, y2: seg.y2 - ny * 1.6 }, '#FFFFFF', 1.5, { o: 0.5 }),
  ];
  const count = Math.max(1, Math.floor(len / 26));
  let d = '';
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const cx = seg.x1 + ux * len * t;
    const cy = seg.y1 + uy * len * t;
    const dir = i % 2 === 0 ? -1 : 1;
    d += `M${f(cx - ux * 3.6 - nx * dir * -1.4)} ${f(cy - uy * 3.6 - ny * dir * -1.4)}L${f(cx + nx * dir * 2.2)} ${f(cy + ny * dir * 2.2)}L${f(cx + ux * 3.6 - nx * dir * -1.4)} ${f(cy + uy * 3.6 - ny * dir * -1.4)}`;
  }
  ops.push({ k: 'path', d, stroke: darken(p.goal, 0.6), sw: 1.7, cap: 'round', join: 'round' });
  return ops;
}

/* ---------- portals, exit, start ---------- */

export function portalArt(pair: PortalPair, index: number, p: Palette): Art {
  const color = PORTAL_COLORS[index % PORTAL_COLORS.length];
  const gradId = `portal-glow-${index}`;
  const label = String.fromCharCode(65 + (index % 26));
  const ops: Op[] = [
    { k: 'line', x1: pair.a.x, y1: pair.a.y, x2: pair.b.x, y2: pair.b.y, stroke: color, sw: 1.4, o: 0.16, cap: 'round', dash: '1 7' },
  ];
  [pair.a, pair.b].forEach((end, side) => {
    ops.push(
      { k: 'circle', cx: end.x, cy: end.y, r: 32, fill: `url(#${gradId})` },
      { k: 'circle', cx: end.x, cy: end.y, r: HOLE_RADIUS, fill: p.background, stroke: color, sw: 2.4, o: 0.95 },
      { k: 'circle', cx: end.x, cy: end.y, r: HOLE_RADIUS - 5, stroke: color, sw: 1, o: 0.3 },
      { k: 'path', d: spiral(end.x, end.y, 2, 11.5, 0.85, 0, side === 0 ? 1 : -1), stroke: color, sw: 1.9, cap: 'round', join: 'round' },
      { k: 'path', d: spiral(end.x, end.y, 2, 11.5, 0.85, Math.PI, side === 0 ? 1 : -1), stroke: color, sw: 1.9, cap: 'round', join: 'round', o: 0.7 },
      { k: 'circle', cx: end.x, cy: end.y, r: 2, fill: color },
      { k: 'text', x: end.x, y: end.y - HOLE_RADIUS - 6, s: label, fill: color, size: 9, weight: '800' },
    );
  });
  return { defs: [{ id: gradId, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ o: 0, c: color, a: 0.42 }, { o: 1, c: color, a: 0 }] }], ops };
}

export function goalArt(goal: Point, label: string, p: Palette): Art {
  const { x, y } = goal;
  return {
    defs: [
      { id: 'goal-glow', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ o: 0, c: p.goal, a: 0.5 }, { o: 1, c: p.goal, a: 0 }] },
      { id: 'goal-core', cx: 0.38, cy: 0.32, r: 0.8, stops: [{ o: 0, c: lighten(p.goal, 0.65) }, { o: 1, c: p.goal }] },
    ],
    ops: [
      { k: 'circle', cx: x, cy: y, r: 52, fill: 'url(#goal-glow)' },
      { k: 'circle', cx: x, cy: y, r: 28, stroke: p.goal, sw: 1.4, o: 0.55, dash: '3 5' },
      { k: 'circle', cx: x, cy: y, r: 21, fill: p.background, stroke: p.goal, sw: 3, o: 0.96 },
      { k: 'circle', cx: x, cy: y, r: 15, fill: 'url(#goal-core)' },
      { k: 'path', d: `M${f(x - 3.4)} ${f(y + 7)}L${f(x - 3.4)} ${f(y - 7)}`, stroke: p.background, sw: 1.9, cap: 'round' },
      { k: 'path', d: `M${f(x - 3.4)} ${f(y - 7)}L${f(x + 6.4)} ${f(y - 3.6)}L${f(x - 3.4)} ${f(y - 0.2)}Z`, fill: p.background },
      { k: 'text', x, y: y + 43, s: label, fill: p.goal, size: 8.5, weight: '800' },
    ],
  };
}

export function startOps(origin: Point, p: Palette): Op[] {
  return [
    { k: 'circle', cx: origin.x, cy: origin.y, r: 21, stroke: p.stone, sw: 1.4, o: 0.5, dash: '2 4' },
    { k: 'circle', cx: origin.x, cy: origin.y, r: 15, fill: p.stone, o: 0.07 },
  ];
}

/** Notebook paper: ruled lines, a margin and ring-binder punch holes. */
export function paperOps(width: number, height: number, p: Palette): Op[] {
  const ops: Op[] = [];
  for (let y = 30; y < height; y += 28) {
    ops.push({ k: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: p.gridLine, sw: 1, o: 0.55 });
  }
  ops.push({ k: 'line', x1: 30, y1: 0, x2: 30, y2: height, stroke: p.gridLine, sw: 1, o: 0.8 });
  const holes = 6;
  for (let i = 1; i <= holes; i += 1) {
    ops.push({ k: 'circle', cx: 11, cy: (height * i) / (holes + 1), r: 3.8, fill: p.background, stroke: p.border, sw: 1, o: 0.75 });
  }
  return ops;
}

/* ---------- composed layers ---------- */

export type StaticInput = {
  width: number;
  height: number;
  course: Segment[];
  bouncy: Segment[];
  portals: PortalPair[];
  movingBlueprints: MovingBar[];
  goal: Point;
  origin: Point;
  exitLabel: string;
};

/** Everything that does not move during a level. Build once per level, not once per frame. */
export function buildStaticArt(input: StaticInput, p: Palette): Art {
  const defs: Grad[] = [];
  const ops: Op[] = [...paperOps(input.width, input.height, p), ...startOps(input.origin, p)];
  input.movingBlueprints.forEach((bar) => ops.push(...movingTrackOps(bar, p)));
  input.portals.forEach((pair, index) => {
    const art = portalArt(pair, index, p);
    defs.push(...art.defs);
    ops.push(...art.ops);
  });
  const goal = goalArt(input.goal, input.exitLabel, p);
  defs.push(...goal.defs);
  ops.push(...goal.ops);
  input.course.forEach((seg) => ops.push(...thornOps(seg, p.obstacle)));
  input.bouncy.forEach((seg) => ops.push(...bouncyOps(seg, p)));
  return { defs, ops };
}

export function trailOps(points: Point[], color: string): Op[] {
  const ops: Op[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const t = i / (points.length - 1);
    ops.push({ k: 'line', x1: points[i - 1].x, y1: points[i - 1].y, x2: points[i].x, y2: points[i].y, stroke: color, sw: 1.5 + 3 * t, o: 0.1 + 0.5 * t, cap: 'round' });
  }
  return ops;
}

/** Faint dashed copy of the last failed attempt, ending in an impact cross. */
export function ghostOps(points: Point[], color: string): Op[] {
  if (points.length < 2) return [];
  const d = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${f(pt.x)} ${f(pt.y)}`).join('');
  const end = points[points.length - 1];
  return [
    { k: 'path', d, stroke: color, sw: 2, o: 0.4, cap: 'round', join: 'round', dash: '3 6' },
    { k: 'line', x1: end.x - 4.5, y1: end.y - 4.5, x2: end.x + 4.5, y2: end.y + 4.5, stroke: color, sw: 2, o: 0.65, cap: 'round' },
    { k: 'line', x1: end.x - 4.5, y1: end.y + 4.5, x2: end.x + 4.5, y2: end.y - 4.5, stroke: color, sw: 2, o: 0.65, cap: 'round' },
  ];
}

/** Dotted aim guide with an arrow head and a fading projection beyond the drag point. */
export function aimOps(from: Point, to: Point, color: string): Op[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return [];
  const ux = dx / len;
  const uy = dy / len;
  const ops: Op[] = [];
  for (let d = 16; d < len - 8; d += 9) {
    ops.push({ k: 'circle', cx: from.x + ux * d, cy: from.y + uy * d, r: 1.8, fill: color, o: 0.3 + 0.6 * (d / len) });
  }
  const reach = Math.min(len * 0.6, 90);
  for (let d = len + 12; d < len + reach; d += 11) {
    ops.push({ k: 'circle', cx: from.x + ux * d, cy: from.y + uy * d, r: 1.4, fill: color, o: 0.32 * (1 - (d - len) / reach) });
  }
  const nx = -uy;
  const ny = ux;
  ops.push({
    k: 'path',
    d: `M${f(to.x)} ${f(to.y)}L${f(to.x - ux * 10 + nx * 5.5)} ${f(to.y - uy * 10 + ny * 5.5)}L${f(to.x - ux * 10 - nx * 5.5)} ${f(to.y - uy * 10 - ny * 5.5)}Z`,
    fill: color,
    o: 0.95,
  });
  return ops;
}

/* ---------- the stone ("Nokta") ---------- */

export function stoneArt(color: string): Art {
  const r = STONE_RADIUS;
  return {
    defs: [{ id: 'stone-body', cx: 0.36, cy: 0.3, r: 0.78, stops: [{ o: 0, c: lighten(color, 0.62) }, { o: 0.5, c: color }, { o: 1, c: darken(color, 0.4) }] }],
    ops: [
      { k: 'ellipse', cx: 0, cy: r * 0.86, rx: r * 0.86, ry: r * 0.3, fill: '#000000', o: 0.3 },
      { k: 'circle', cx: 0, cy: 0, r, fill: 'url(#stone-body)' },
      { k: 'circle', cx: 0, cy: 0, r, stroke: darken(color, 0.5), sw: 1, o: 0.55 },
      { k: 'ellipse', cx: -r * 0.34, cy: -r * 0.44, rx: r * 0.3, ry: r * 0.17, fill: '#FFFFFF', o: 0.5 },
      { k: 'circle', cx: -r * 0.27, cy: r * 0.04, r: r * 0.15, fill: '#0B1220' },
      { k: 'circle', cx: r * 0.27, cy: r * 0.04, r: r * 0.15, fill: '#0B1220' },
      { k: 'circle', cx: -r * 0.3, cy: -r * 0.01, r: r * 0.05, fill: '#FFFFFF' },
      { k: 'circle', cx: r * 0.24, cy: -r * 0.01, r: r * 0.05, fill: '#FFFFFF' },
    ],
  };
}

/* ---------- footer legend glyphs ---------- */

export type LegendKind = 'thorn' | 'moving' | 'bouncy' | 'portal' | 'exit';
export const LEGEND_SIZE = { width: 28, height: 18 };

export function legendArt(kind: LegendKind, p: Palette): Art {
  const bar: Segment = { x1: 4, y1: 9, x2: 24, y2: 9 };
  if (kind === 'thorn') return { defs: [], ops: thornOps(bar, p.obstacle, undefined, 8) };
  if (kind === 'moving') return { defs: [], ops: movingBarOps(bar, p, true) };
  if (kind === 'bouncy') return { defs: [], ops: bouncyOps(bar, p) };
  const color = kind === 'portal' ? PORTAL_COLORS[0] : p.goal;
  const ops: Op[] = [{ k: 'circle', cx: 14, cy: 9, r: 7, fill: p.background, stroke: color, sw: 2 }];
  if (kind === 'portal') ops.push({ k: 'path', d: spiral(14, 9, 1.4, 4.6, 0.85, 0, 1), stroke: color, sw: 1.5, cap: 'round' });
  else ops.push({ k: 'circle', cx: 14, cy: 9, r: 3.4, fill: color });
  return { defs: [], ops };
}

/* ---------- SVG serialisation (tests + previews) ---------- */

function attrs(pairs: Array<[string, string | number | undefined]>) {
  return pairs
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join(' ');
}

export function opToSvg(op: Op): string {
  switch (op.k) {
    case 'line':
      return `<line ${attrs([['x1', f(op.x1)], ['y1', f(op.y1)], ['x2', f(op.x2)], ['y2', f(op.y2)], ['stroke', op.stroke], ['stroke-width', op.sw], ['stroke-linecap', op.cap ?? 'butt'], ['stroke-dasharray', op.dash], ['opacity', op.o]])}/>`;
    case 'path':
      return `<path ${attrs([['d', op.d], ['fill', op.fill ?? 'none'], ['stroke', op.stroke], ['stroke-width', op.sw], ['stroke-linecap', op.cap], ['stroke-linejoin', op.join], ['stroke-dasharray', op.dash], ['opacity', op.o]])}/>`;
    case 'circle':
      return `<circle ${attrs([['cx', f(op.cx)], ['cy', f(op.cy)], ['r', f(op.r)], ['fill', op.fill ?? 'none'], ['stroke', op.stroke], ['stroke-width', op.sw], ['stroke-dasharray', op.dash], ['opacity', op.o]])}/>`;
    case 'ellipse':
      return `<ellipse ${attrs([['cx', f(op.cx)], ['cy', f(op.cy)], ['rx', f(op.rx)], ['ry', f(op.ry)], ['fill', op.fill ?? 'none'], ['opacity', op.o]])}/>`;
    case 'text':
      return `<text ${attrs([['x', f(op.x)], ['y', f(op.y)], ['fill', op.fill], ['font-size', op.size], ['font-weight', op.weight ?? '700'], ['text-anchor', 'middle'], ['font-family', 'Helvetica, Arial, sans-serif'], ['opacity', op.o]])}>${op.s}</text>`;
  }
}

export function defsToSvg(defs: Grad[]): string {
  if (defs.length === 0) return '';
  const body = defs
    .map((grad) => {
      const stops = grad.stops.map((s) => `<stop offset="${s.o}" stop-color="${s.c}" stop-opacity="${s.a ?? 1}"/>`).join('');
      return `<radialGradient id="${grad.id}" cx="${grad.cx ?? 0.5}" cy="${grad.cy ?? 0.5}" r="${grad.r ?? 0.5}">${stops}</radialGradient>`;
    })
    .join('');
  return `<defs>${body}</defs>`;
}

export function artToSvgInner(art: Art): string {
  return defsToSvg(art.defs) + art.ops.map(opToSvg).join('');
}
