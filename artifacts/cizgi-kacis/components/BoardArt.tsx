import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { MovingBar, Point, PortalPair, Segment } from '@/game-logic';
import type { EraserRect, Hazards, PencilBar, Stain } from '@/lib/mechanics';
import {
  type Art,
  LEGEND_SIZE,
  type LegendKind,
  type Op,
  type Palette,
  STONE_BOX,
  aimOps,
  buildStaticArt,
  eraserOps,
  ghostBarOps,
  ghostOps,
  hintPathOps,
  inkLineOps,
  legendArt,
  movingBarOps,
  nightArt,
  opAnchor,
  pencilGlyph,
  pencilOps,
  stainOps,
  stoneArt,
  tearOps,
  thornOps,
  trailOps,
} from '@/lib/boardArt';
import { INK_LINE_LIFETIME } from '@/lib/mechanics';

export function renderOp(op: Op, key: string) {
  switch (op.k) {
    case 'line':
      return <Line key={key} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.stroke} strokeWidth={op.sw} strokeLinecap={op.cap ?? 'butt'} strokeDasharray={op.dash} opacity={op.o} />;
    case 'path':
      return <Path key={key} d={op.d} fill={op.fill ?? 'none'} stroke={op.stroke} strokeWidth={op.sw} strokeLinecap={op.cap} strokeLinejoin={op.join} strokeDasharray={op.dash} opacity={op.o} />;
    case 'circle':
      return <Circle key={key} cx={op.cx} cy={op.cy} r={op.r} fill={op.fill ?? 'none'} stroke={op.stroke} strokeWidth={op.sw} strokeDasharray={op.dash} opacity={op.o} />;
    case 'rect':
      return <Rect key={key} x={op.x} y={op.y} width={op.w} height={op.h} rx={op.rx} fill={op.fill} opacity={op.o} />;
    case 'ellipse':
      return <Ellipse key={key} cx={op.cx} cy={op.cy} rx={op.rx} ry={op.ry} fill={op.fill ?? 'none'} opacity={op.o} />;
    case 'text':
      return (
        <SvgText key={key} x={op.x} y={op.y} fill={op.fill} fontSize={op.size} fontWeight={op.weight ?? '700'} textAnchor="middle" opacity={op.o}>
          {op.s}
        </SvgText>
      );
  }
}

export function renderDefs(art: Art) {
  if (art.defs.length === 0) return null;
  return (
    <Defs>
      {art.defs.map((grad) => (
        <RadialGradient key={grad.id} id={grad.id} cx={grad.cx ?? 0.5} cy={grad.cy ?? 0.5} r={grad.r ?? 0.5} gradientUnits={grad.units === 'user' ? 'userSpaceOnUse' : 'objectBoundingBox'}>
          {grad.stops.map((stop, index) => (
            <Stop key={index} offset={stop.o} stopColor={stop.c} stopOpacity={stop.a ?? 1} />
          ))}
        </RadialGradient>
      ))}
    </Defs>
  );
}

type BoardArtProps = {
  width: number;
  height: number;
  palette: Palette;
  exitLabel: string;
  course: Segment[];
  bouncy: Segment[];
  portals: PortalPair[];
  movingBlueprints: MovingBar[];
  /** Moving bars at their current position (changes every frame). */
  movingBars: Segment[];
  goal: Point;
  origin: Point;
  stoneColor: string;
  trail: Point[];
  ghost: Point[];
  /** Aim guide, only while the player is dragging. */
  aim: { from: Point; to: Point } | null;
  hazards: Hazards;
  brokenTears: ReadonlySet<string>;
  /** Present on Eraser pages: the course is then drawn per frame so bars can be rubbed out. */
  eraser: { rect: EraserRect; erased: boolean[] } | null;
  pencil: PencilBar[];
  inkLines: Array<{ segment: Segment; age: number }>;
  stains: Stain[];
  /** Night page: the lantern centre. */
  night: Point | null;
  hintPath: Point[];
  /** 0..1 level-intro progress ("the Artist draws the page"); 1 = fully drawn. */
  reveal: number;
};

/**
 * One SVG for the whole board. The static layer (paper, barriers, portals, exit) is built once per level;
 * only the moving parts (bars, Eraser, pencil, ink lines, trail, aim) are rebuilt per frame. It never receives touches.
 */
export function BoardArt(props: BoardArtProps) {
  const { width, height, palette, exitLabel, course, bouncy, portals, movingBlueprints, goal, origin, hazards, reveal } = props;
  const hideCourse = props.eraser !== null;
  const paletteKey = Object.values(palette).join('|');
  const staticArt = useMemo(
    () => buildStaticArt({ width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel, hazards, hideCourse }, palette),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel, hazards, hideCourse, paletteKey],
  );

  const revealFrom = staticArt.revealFrom ?? 0;
  const revealable = staticArt.ops.length - revealFrom;
  const shown = reveal >= 1 ? staticArt.ops.length : revealFrom + Math.ceil(revealable * Math.max(0, reveal));
  const visibleStatic = staticArt.ops.slice(0, shown);
  const drawing = reveal < 1;
  let pen: Op[] = [];
  if (drawing) {
    for (let i = shown - 1; i >= revealFrom; i -= 1) {
      const anchor = opAnchor(staticArt.ops[i]);
      if (anchor) {
        pen = pencilGlyph(anchor, 0.9);
        break;
      }
    }
  }

  const dynamic: Op[] = [];
  props.stains.forEach((stain) => dynamic.push(...stainOps(stain, props.stoneColor)));
  if (!drawing) {
    if (props.ghost.length > 1) dynamic.push(...ghostOps(props.ghost, palette.obstacle));
    hazards.tears.forEach((tear) => dynamic.push(...tearOps(tear, props.brokenTears.has(tear.id))));
    props.pencil.forEach((bar) => dynamic.push(...pencilOps(bar)));
    if (props.eraser) {
      course.forEach((seg, index) => {
        dynamic.push(...(props.eraser?.erased[index] ? ghostBarOps(seg, palette.obstacle) : thornOps(seg, palette.obstacle)));
      });
    }
    props.movingBars.forEach((bar) => dynamic.push(...movingBarOps(bar, palette)));
    props.inkLines.forEach((line) => dynamic.push(...inkLineOps(line.segment, line.age, INK_LINE_LIFETIME, props.stoneColor)));
    if (props.eraser) dynamic.push(...eraserOps(props.eraser.rect));
    if (props.hintPath.length > 2) dynamic.push(...hintPathOps(props.hintPath, palette.stoneHighlight));
    if (props.aim) dynamic.push(...aimOps(props.aim.from, props.aim.to, palette.stoneHighlight));
    dynamic.push(...trailOps(props.trail, props.stoneColor));
  }
  const night = props.night && !drawing ? nightArt(props.night, width, height, palette.background) : null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {renderDefs({ defs: [...staticArt.defs, ...(night?.defs ?? [])], ops: [] })}
        {visibleStatic.map((op, index) => renderOp(op, `s${index}`))}
        {dynamic.map((op, index) => renderOp(op, `d${index}`))}
        {pen.map((op, index) => renderOp(op, `p${index}`))}
        {night?.ops.map((op, index) => renderOp(op, `n${index}`))}
      </Svg>
    </View>
  );
}

/** The stone ("Nokta"), drawn centred in a STONE_BOX square. */
export function StoneSprite({ color }: { color: string }) {
  const art = useMemo(() => stoneArt(color), [color]);
  const half = STONE_BOX / 2;
  return (
    <Svg width={STONE_BOX} height={STONE_BOX} viewBox={`${-half} ${-half} ${STONE_BOX} ${STONE_BOX}`}>
      {renderDefs(art)}
      {art.ops.map((op, index) => renderOp(op, `o${index}`))}
    </Svg>
  );
}

/** Small icon used by the footer legend; drawn with the same builders as the board. */
export function LegendGlyph({ kind, palette }: { kind: LegendKind; palette: Palette }) {
  const paletteKey = Object.values(palette).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const art = useMemo(() => legendArt(kind, palette), [kind, paletteKey]);
  return (
    <Svg width={LEGEND_SIZE.width} height={LEGEND_SIZE.height} viewBox={`0 0 ${LEGEND_SIZE.width} ${LEGEND_SIZE.height}`}>
      {art.ops.map((op, index) => renderOp(op, `l${index}`))}
    </Svg>
  );
}
