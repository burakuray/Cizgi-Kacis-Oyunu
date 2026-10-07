/**
 * New gameplay mechanics as pure, deterministic functions (no React / AsyncStorage) so they can be unit-tested.
 *
 * Time `t` everywhere is the game's "motion time": it only advances while the stone is flying, so every
 * moving hazard freezes while the player aims. That keeps the Eraser and the pencil fair and readable.
 */
import type { Point, Segment } from '../game-logic.ts';
import {
  MAX_SHOT_SPEED,
  STOP_SPEED,
  STONE_RADIUS,
  bounceFromBarriers,
  clamp,
  clearanceTo,
  distanceToSegment,
  levelKind,
  makeBouncyBarriers,
  makeCourse,
  makeMovingBars,
  makePortals,
  placeNear,
  shotRange,
  sweptSegment,
  wallLayout,
} from '../game-logic.ts';

/* ---------- seeded randomness ---------- */

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function usableBand(height: number) {
  return { top: Math.max(94, height * 0.14), bottom: height - 116 };
}

/* ---------- sticky ink, magnets, tear-sheet bars ---------- */

export type Puddle = { x: number; y: number; r: number };
export type Magnet = { x: number; y: number; r: number; strength: number; polarity: 1 | -1 };
export type TearBar = { id: string; segment: Segment };
export type Hazards = { puddles: Puddle[]; magnets: Magnet[]; tears: TearBar[] };

export const TEAR_SPEED = 4.4;
export const EMPTY_HAZARDS: Hazards = { puddles: [], magnets: [], tears: [] };

export function hazardCounts(level: number): { puddles: number; magnets: number; tears: number } {
  const kind = levelKind(level);
  const calm = kind === 'relax' || kind === 'eraser' || kind === 'boss';
  return {
    puddles: level >= 4 && !calm ? Math.min(2, 1 + Math.floor((level - 4) / 6)) : 0,
    magnets: level >= 8 && !calm ? Math.min(2, 1 + Math.floor((level - 8) / 6)) : 0,
    tears: level >= 10 && kind !== 'relax' ? Math.min(2, 1 + Math.floor((level - 10) / 5)) : 0,
  };
}

/** Places hazards in free space (clear of bars and portals), deterministically for a level and board size. */
export function makeHazards(level: number, width: number, height: number): Hazards {
  const counts = hazardCounts(level);
  if (counts.puddles + counts.magnets + counts.tears === 0) return EMPTY_HAZARDS;
  const { top, bottom } = usableBand(height);
  const random = rng(hashString(`hazards-${level}`));
  const bars = [...makeCourse(level, width, height), ...makeBouncyBarriers(level, width, height), ...makeMovingBars(level, width, height).map(sweptSegment)];
  const placed: Point[] = makePortals(level, width, height).flatMap((pair) => [pair.a, pair.b]);
  const bounds = { minX: 40, maxX: width - 40, minY: top + 56, maxY: bottom - 40 };
  const separation = (p: Point) => placed.reduce((nearest, other) => Math.min(nearest, Math.hypot(p.x - other.x, p.y - other.y)), Infinity) - 64;
  // Gaps are the way through each wall: hazards stay well away from the line across every gap.
  const gapLines: Segment[] = wallLayout(level, width, height).map((gap) => ({ x1: gap.x - gap.w / 2 - 20, y1: gap.y, x2: gap.x + gap.w / 2 + 20, y2: gap.y }));
  const claim = (anchor: Point, need: number) => {
    const point = placeNear(anchor, (c) => Math.min(clearanceTo(c, bars) - need, clearanceTo(c, gapLines) - (need + 42), separation(c)), bounds);
    placed.push(point);
    return point;
  };
  const span = bottom - top;

  const puddles: Puddle[] = [];
  for (let i = 0; i < counts.puddles; i += 1) {
    const p = claim({ x: width * (0.25 + 0.5 * random()), y: top + 120 + (span - 200) * random() }, 14);
    puddles.push({ x: p.x, y: p.y, r: 30 });
  }
  const magnets: Magnet[] = [];
  for (let i = 0; i < counts.magnets; i += 1) {
    const p = claim({ x: width * (0.2 + 0.6 * random()), y: top + 90 + (span - 180) * random() }, 30);
    magnets.push({ x: p.x, y: p.y, r: 104, strength: 0.11, polarity: random() < 0.5 ? 1 : -1 });
  }
  const tears: TearBar[] = [];
  for (let i = 0; i < counts.tears; i += 1) {
    const c = claim({ x: width * (0.2 + 0.6 * random()), y: top + 110 + (span - 230) * random() }, 24);
    tears.push({ id: `tear-${level}-${i}`, segment: { x1: c.x - 33, y1: c.y, x2: c.x + 33, y2: c.y } });
  }
  return { puddles, magnets, tears };
}

/** Sticky ink slows the stone; magnets bend its path (polarity -1 pushes it away). */
export function applyHazardForces(point: Point, velocity: Point, hazards: Hazards, delta: number): Point {
  let vx = velocity.x;
  let vy = velocity.y;
  for (const puddle of hazards.puddles) {
    if (Math.hypot(point.x - puddle.x, point.y - puddle.y) < puddle.r) {
      const drag = Math.pow(0.9, delta);
      vx *= drag;
      vy *= drag;
    }
  }
  for (const magnet of hazards.magnets) {
    const dx = magnet.x - point.x;
    const dy = magnet.y - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance < magnet.r && distance > 6) {
      const pull = magnet.polarity * magnet.strength * Math.pow(1 - distance / magnet.r, 2) * delta;
      vx += (dx / distance) * pull;
      vy += (dy / distance) * pull;
    }
  }
  return { x: vx, y: vy };
}

export type TearResult =
  | { kind: 'none' }
  | { kind: 'bounce'; id: string; point: Point; velocity: Point }
  | { kind: 'tear'; id: string; velocity: Point };

/** A tear-sheet bar bounces a slow stone like a spring, but a fast stone rips straight through it. */
export function resolveTear(point: Point, velocity: Point, tears: TearBar[], broken: ReadonlySet<string>): TearResult {
  for (const tear of tears) {
    if (broken.has(tear.id) || distanceToSegment(point, tear.segment) >= STONE_RADIUS + 2) continue;
    if (Math.hypot(velocity.x, velocity.y) >= TEAR_SPEED) {
      return { kind: 'tear', id: tear.id, velocity: { x: velocity.x * 0.72, y: velocity.y * 0.72 } };
    }
    const bounce = bounceFromBarriers(point, velocity, [tear.segment]);
    if (bounce.bounced) return { kind: 'bounce', id: tear.id, point: bounce.point, velocity: bounce.velocity };
  }
  return { kind: 'none' };
}

/* ---------- the Eraser (Silgi) ---------- */

export type EraserConfig = { cx: number; ampX: number; top: number; bottom: number; period: number; periodX: number; w: number; h: number; boss: boolean };
export type EraserRect = { cx: number; cy: number; w: number; h: number };
export const ERASE_MEMORY = 2.4;

export function eraserConfig(level: number, width: number, height: number): EraserConfig | null {
  const kind = levelKind(level);
  if (kind !== 'eraser' && kind !== 'boss') return null;
  const boss = kind === 'boss';
  const w = boss ? 150 : 118;
  const h = boss ? 52 : 44;
  const period = boss ? 5.4 : 7.6;
  const { top, bottom } = usableBand(height);
  return { cx: width / 2, ampX: Math.max(20, (width - w) / 2 - 12), top: top + h / 2, bottom: bottom - h / 2, period, periodX: period * 1.37, w, h, boss };
}

export function eraserRect(config: EraserConfig, t: number): EraserRect {
  const phase = (((t % config.period) + config.period) % config.period) / config.period;
  const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return {
    cx: config.cx + config.ampX * Math.sin((2 * Math.PI * t) / config.periodX),
    cy: config.top + (config.bottom - config.top) * triangle,
    w: config.w,
    h: config.h,
  };
}

export function eraserHitsStone(rect: EraserRect, point: Point): boolean {
  const nx = clamp(point.x, rect.cx - rect.w / 2, rect.cx + rect.w / 2);
  const ny = clamp(point.y, rect.cy - rect.h / 2, rect.cy + rect.h / 2);
  return Math.hypot(point.x - nx, point.y - ny) < STONE_RADIUS - 3;
}

/** A bar is rubbed out when the Eraser passes over its midpoint, and is redrawn ERASE_MEMORY seconds later. */
export function erasedFlags(config: EraserConfig, t: number, bars: Segment[]): boolean[] {
  const rects: EraserRect[] = [];
  for (let k = 0; k * 0.12 <= ERASE_MEMORY; k += 1) {
    const time = t - k * 0.12;
    if (time < 0) break;
    rects.push(eraserRect(config, time));
  }
  return bars.map((bar) => {
    const mx = (bar.x1 + bar.x2) / 2;
    const my = (bar.y1 + bar.y2) / 2;
    return rects.some((r) => Math.abs(mx - r.cx) <= r.w / 2 + 14 && Math.abs(my - r.cy) <= r.h / 2 + 14);
  });
}

/* ---------- the Artist's pencil ---------- */

export type PencilPhase = 'telegraph' | 'draw' | 'hold' | 'erase';
export type PencilBar = { id: string; phase: PencilPhase; progress: number; solid: boolean; full: Segment; segment: Segment; tip: Point };
export const PENCIL_PERIOD = 5;
const PENCIL = { lead: 1.0, offset: 1.6, draw: 0.8, hold: 3.0, erase: 3.4 };

export function pencilEnabled(level: number): boolean {
  const kind = levelKind(level);
  return kind === 'pencil' || kind === 'boss';
}

/** The pencil sketches a bar after a dotted warning, lets it stand, then rubs it out. Never springs a surprise. */
export function pencilBars(level: number, width: number, height: number, t: number): PencilBar[] {
  if (!pencilEnabled(level)) return [];
  const { top, bottom } = usableBand(height);
  const first = Math.max(0, Math.floor((t - PENCIL.offset - PENCIL.erase) / PENCIL_PERIOD));
  const bars: PencilBar[] = [];
  for (let slot = first; slot <= first + 2; slot += 1) {
    const u = t - (slot * PENCIL_PERIOD + PENCIL.offset);
    if (u < -PENCIL.lead || u > PENCIL.erase) continue;
    const random = rng(hashString(`pencil-${level}-${slot}`));
    const length = 86;
    const x1 = 36 + (width - 72 - length) * random();
    const y1 = top + 70 + (bottom - top - 140) * random();
    const full: Segment = { x1, y1, x2: x1 + length, y2: y1 + (random() < 0.5 ? -1 : 1) * 24 * random() };
    let phase: PencilPhase = 'hold';
    let progress = 1;
    if (u < 0) {
      phase = 'telegraph';
      progress = 0;
    } else if (u < PENCIL.draw) {
      phase = 'draw';
      progress = u / PENCIL.draw;
    } else if (u > PENCIL.hold) {
      phase = 'erase';
    }
    const reach = phase === 'telegraph' ? 1 : progress;
    const segment: Segment = { x1: full.x1, y1: full.y1, x2: full.x1 + (full.x2 - full.x1) * reach, y2: full.y1 + (full.y2 - full.y1) * reach };
    bars.push({ id: `pencil-${level}-${slot}`, phase, progress, solid: phase === 'draw' || phase === 'hold' || (phase === 'erase' && u < PENCIL.hold + 0.2), full, segment, tip: { x: segment.x2, y: segment.y2 } });
  }
  return bars;
}

export function solidPencilSegments(bars: PencilBar[]): Segment[] {
  return bars.filter((bar) => bar.solid).map((bar) => bar.segment);
}

/* ---------- ink lines (the signature mechanic) ---------- */

/** One short correction per shot: the pool refills when the next shot is launched, never while flying. */
export const INK_MAX = 40;
export const INK_REFILL_PER_SECOND = 0;
export const INK_LINE_LIFETIME = 1.2;
export const INK_LINE_MAX_LENGTH = 72;
export const INK_LINE_MIN_LENGTH = 20;
export const INK_COST_PER_PIXEL = 0.55;

export type InkLine = { segment: Segment; born: number };

/** Turns a finger drag into a bounce line, clipped to the maximum length and to what the ink pool can afford. */
export function planInkLine(from: Point, to: Point, pool: number): { segment: Segment; cost: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < INK_LINE_MIN_LENGTH) return null;
  const affordable = pool / INK_COST_PER_PIXEL;
  const used = Math.min(length, INK_LINE_MAX_LENGTH, affordable);
  if (used < INK_LINE_MIN_LENGTH) return null;
  return {
    segment: { x1: from.x, y1: from.y, x2: from.x + (dx / length) * used, y2: from.y + (dy / length) * used },
    cost: used * INK_COST_PER_PIXEL,
  };
}

export function activeInkLines(lines: InkLine[], t: number): InkLine[] {
  return lines.filter((line) => t - line.born >= 0 && t - line.born < INK_LINE_LIFETIME);
}

export function refillInk(pool: number, seconds: number): number {
  return Math.min(INK_MAX, pool + INK_REFILL_PER_SECOND * seconds);
}

/* ---------- daily rule, surprise page, bonus page ---------- */

export type DailyRule = 'slick' | 'mirror' | 'night';
const DAILY_RULES: DailyRule[] = ['slick', 'mirror', 'night'];

export function dailyRuleFor(date: string): DailyRule {
  return DAILY_RULES[hashString(`rule-${date}`) % DAILY_RULES.length];
}

/** The surprise page is a level the player has already reached, replayed under the day's special rule. */
export function surpriseLevelFor(date: string, bestLevel: number): number {
  const top = Math.max(3, bestLevel);
  return clamp(3 + (hashString(`level-${date}`) % Math.max(1, top - 2)), 3, top);
}

/**
 * Per-frame friction. It is derived from the board height so the strongest shot always stops short of the exit
 * (see `shotRange`), which guarantees every page needs at least two shots. Slick pages glide ~2.5x as far.
 */
export function frictionFor(rule: DailyRule | null, boardHeight = 520): number {
  const base = 1 - (MAX_SHOT_SPEED - STOP_SPEED) / shotRange(boardHeight);
  return rule === 'slick' ? 1 - (1 - base) * 0.4 : base;
}

export const SURPRISE_INK = 30;
export const BONUS_INK = 20;
export const PERFECT_STREAK_FOR_BONUS = 3;
export const FAIL_STREAK_FOR_ASSIST = 3;

export function flipX(width: number, point: Point): Point {
  return { x: width - point.x, y: point.y };
}

export function flipSegment(width: number, segment: Segment): Segment {
  return { x1: width - segment.x1, y1: segment.y1, x2: width - segment.x2, y2: segment.y2 };
}

/* ---------- variable rewards ---------- */

export type Drop = { kind: 'ink'; amount: number } | { kind: 'skin'; id: string } | { kind: 'card'; id: string };
export const RARE_SKINS = ['galaxy', 'ember'];

/** ~22% base chance that grows with every miss, so a drop always arrives eventually (pity timer). */
export function rollDrop(seed: string, ownedSkins: string[], ownedCards: string[], allCards: string[], misses: number): Drop | null {
  const random = rng(hashString(`drop-${seed}`));
  if (random() > Math.min(1, 0.22 + 0.1 * misses)) return null;
  const pick = random();
  const amount = 10 + Math.floor(random() * 15);
  if (pick < 0.5) return { kind: 'ink', amount };
  if (pick < 0.78) {
    const skin = RARE_SKINS.find((id) => !ownedSkins.includes(id));
    return skin ? { kind: 'skin', id: skin } : { kind: 'ink', amount };
  }
  const card = allCards.find((id) => !ownedCards.includes(id));
  return card ? { kind: 'card', id: card } : { kind: 'ink', amount };
}

/* ---------- near miss, stains, trail, prediction ---------- */

export const COLLISION_DISTANCE = STONE_RADIUS + 3;
export const NEAR_MISS_BAND = 7;

/** Grazing a barrier without touching it: the moment the game slows down and cheers. */
export function isNearMiss(clearance: number, speed: number): boolean {
  return clearance > COLLISION_DISTANCE && clearance <= COLLISION_DISTANCE + NEAR_MISS_BAND && speed >= 3;
}

export type Stain = { x: number; y: number; r: number; seed: number };

export function makeStain(point: Point, index: number): Stain {
  const seed = hashString(`stain-${Math.round(point.x)}-${Math.round(point.y)}-${index}`);
  return { x: point.x, y: point.y, r: 13 + (seed % 9), seed };
}

export function compressTrail(points: Point[], width: number, height: number, max = 36): number[][] {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.ceil(points.length / max));
  const picked = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  return picked.map((p) => [Math.round((p.x / width) * 1000), Math.round((p.y / height) * 1000)]);
}

export function expandTrail(normalised: number[][], width: number, height: number): Point[] {
  return normalised.map(([x, y]) => ({ x: (x / 1000) * width, y: (y / 1000) * height }));
}

/** Straight-line preview used as a hint after repeated failures; stops at the first barrier it would touch. */
export function predictPath(from: Point, to: Point, obstacles: Segment[], maxLength = 260): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [from];
  const ux = dx / length;
  const uy = dy / length;
  const points: Point[] = [from];
  for (let d = 8; d <= maxLength; d += 8) {
    const p = { x: from.x + ux * d, y: from.y + uy * d };
    points.push(p);
    if (obstacles.some((segment) => distanceToSegment(p, segment) < COLLISION_DISTANCE)) break;
  }
  return points;
}

/* ---------- reflection off a segment at any angle ---------- */

/**
 * Elastic-ish bounce off the nearest of `segments`, at any angle. (`bounceFromBarriers` in game-logic only
 * understands horizontal and vertical walls, which is not enough for lines the player draws.)
 */
export function reflectFromSegments(point: Point, velocity: Point, segments: Segment[], damping = 0.96): { bounced: boolean; point: Point; velocity: Point } {
  let best: { distance: number; closest: Point } | null = null;
  for (const segment of segments) {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const lengthSquared = dx * dx + dy * dy || 1;
    const t = clamp(((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared, 0, 1);
    const closest = { x: segment.x1 + dx * t, y: segment.y1 + dy * t };
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y);
    if (distance < STONE_RADIUS + 8 && (!best || distance < best.distance)) best = { distance, closest };
  }
  if (!best) return { bounced: false, point, velocity };
  let nx = point.x - best.closest.x;
  let ny = point.y - best.closest.y;
  const length = Math.hypot(nx, ny);
  if (length < 1e-6) {
    nx = -velocity.y;
    ny = velocity.x;
  } else {
    nx /= length;
    ny /= length;
  }
  const normalLength = Math.hypot(nx, ny) || 1;
  nx /= normalLength;
  ny /= normalLength;
  const approaching = velocity.x * nx + velocity.y * ny < 0;
  const dot = velocity.x * nx + velocity.y * ny;
  const out = { x: best.closest.x + nx * (STONE_RADIUS + 10), y: best.closest.y + ny * (STONE_RADIUS + 10) };
  if (!approaching) return { bounced: true, point: out, velocity };
  return { bounced: true, point: out, velocity: { x: (velocity.x - 2 * dot * nx) * damping, y: (velocity.y - 2 * dot * ny) * damping } };
}

export function flipHazards(width: number, hazards: Hazards): Hazards {
  return {
    puddles: hazards.puddles.map((p) => ({ ...p, x: width - p.x })),
    magnets: hazards.magnets.map((m) => ({ ...m, x: width - m.x })),
    tears: hazards.tears.map((t) => ({ ...t, segment: flipSegment(width, t.segment) })),
  };
}
