import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import type { MovingBar, Point, PortalPair, Segment } from '@/game-logic';
import {
  type Art,
  LEGEND_SIZE,
  type LegendKind,
  type Op,
  type Palette,
  STONE_BOX,
  aimOps,
  buildStaticArt,
  ghostOps,
  legendArt,
  movingBarOps,
  stoneArt,
  trailOps,
} from '@/lib/boardArt';

function renderOp(op: Op, key: string) {
  switch (op.k) {
    case 'line':
      return <Line key={key} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.stroke} strokeWidth={op.sw} strokeLinecap={op.cap ?? 'butt'} strokeDasharray={op.dash} opacity={op.o} />;
    case 'path':
      return <Path key={key} d={op.d} fill={op.fill ?? 'none'} stroke={op.stroke} strokeWidth={op.sw} strokeLinecap={op.cap} strokeLinejoin={op.join} strokeDasharray={op.dash} opacity={op.o} />;
    case 'circle':
      return <Circle key={key} cx={op.cx} cy={op.cy} r={op.r} fill={op.fill ?? 'none'} stroke={op.stroke} strokeWidth={op.sw} strokeDasharray={op.dash} opacity={op.o} />;
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

function renderDefs(art: Art) {
  if (art.defs.length === 0) return null;
  return (
    <Defs>
      {art.defs.map((grad) => (
        <RadialGradient key={grad.id} id={grad.id} cx={grad.cx ?? 0.5} cy={grad.cy ?? 0.5} r={grad.r ?? 0.5}>
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
  chapterId?: string;
  level?: number;
  stoneColor: string;
  trail: Point[];
  ghost: Point[];
  /** Aim guide, only while the player is dragging. */
  aim: { from: Point; to: Point } | null;
};

/**
 * One SVG for the whole board. The static layer (paper, barriers, portals, exit) is built once per level;
 * only the moving bars, trail and aim guide are rebuilt per frame. It never receives touches.
 */
export function BoardArt(props: BoardArtProps) {
  const { width, height, palette, exitLabel, course, bouncy, portals, movingBlueprints, goal, origin, chapterId, level } = props;
  const paletteKey = Object.values(palette).join('|');
  const staticArt = useMemo(
    () => buildStaticArt({ width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel, chapterId, level }, palette),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, course, bouncy, portals, movingBlueprints, goal, origin, exitLabel, chapterId, level, paletteKey],
  );
  const dynamic: Op[] = [
    ...(props.ghost.length > 1 ? ghostOps(props.ghost, palette.obstacle) : []),
    ...props.movingBars.flatMap((bar) => movingBarOps(bar, palette)),
    ...(props.aim ? aimOps(props.aim.from, props.aim.to, palette.stoneHighlight) : []),
    ...trailOps(props.trail, props.stoneColor),
  ];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {renderDefs(staticArt)}
        {staticArt.ops.map((op, index) => renderOp(op, `s${index}`))}
        {dynamic.map((op, index) => renderOp(op, `d${index}`))}
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
