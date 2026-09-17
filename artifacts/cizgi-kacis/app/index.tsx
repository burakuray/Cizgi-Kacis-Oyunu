import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type Point = { x: number; y: number };
type Segment = { x1: number; y1: number; x2: number; y2: number };
type MovingBar = {
  id: string;
  segment: Segment;
  axis: 'x' | 'y';
  travel: number;
  speed: number;
  phase: number;
};
type PortalPair = { id: string; a: Point; b: Point; label: string };
type Phase = 'aiming' | 'moving' | 'hit' | 'complete';

const BEST_LEVEL_KEY = '@cizgi-kacis/best-level';
const STONE_RADIUS = 13;
const MAX_DRAG = 94;
const MIN_DRAG = 16;
const AIM_PAD_SIZE = 96;
const AIM_PAD_RADIUS = 38;
const HOLE_RADIUS = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceToSegment(point: Point, segment: Segment) {
  const vx = segment.x2 - segment.x1;
  const vy = segment.y2 - segment.y1;
  const wx = point.x - segment.x1;
  const wy = point.y - segment.y1;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : clamp((wx * vx + wy * vy) / length, 0, 1);
  const nearest = { x: segment.x1 + t * vx, y: segment.y1 + t * vy };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

function makeCourse(level: number, width: number, height: number): Segment[] {
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

function makeMovingBars(level: number, width: number, height: number): MovingBar[] {
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

function positionMovingBar(bar: MovingBar, time: number): Segment {
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

function makePortals(level: number, width: number, height: number): PortalPair[] {
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

function formatLevel(level: number) {
  return String(level).padStart(2, '0');
}

export default function GameScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState({ width: Dimensions.get('window').width - 32, height: 480 });
  const [level, setLevel] = useState(1);
  const [bestLevel, setBestLevel] = useState(1);
  const [attempts, setAttempts] = useState(0);
  const [phase, setPhase] = useState<Phase>('aiming');
  const [stone, setStone] = useState<Point>({ x: board.width / 2, y: board.height - 57 });
  const [aim, setAim] = useState<Point>({ x: board.width / 2, y: board.height - 132 });
  const [joystick, setJoystick] = useState<Point>({ x: 0, y: 0 });
  const [joystickAnchor, setJoystickAnchor] = useState<Point>({ x: board.width / 2, y: board.height / 2 });
  const [joystickVisible, setJoystickVisible] = useState(false);
  const [motionTime, setMotionTime] = useState(0);
  const [velocity, setVelocity] = useState<Point>({ x: 0, y: 0 });
  const [showHelp, setShowHelp] = useState(true);
  const [flash, setFlash] = useState(false);
  const stoneRef = useRef(stone);
  const velocityRef = useRef(velocity);
  const phaseRef = useRef(phase);
  const aimRef = useRef(aim);
  const joystickRef = useRef(joystick);
  const joystickAnchorRef = useRef(joystickAnchor);
  const portalLockRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  const course = useMemo(() => makeCourse(level, board.width, board.height), [level, board.height, board.width]);
  const movingBarBlueprints = useMemo(
    () => makeMovingBars(level, board.width, board.height),
    [level, board.height, board.width],
  );
  const movingBars = useMemo(
    () => movingBarBlueprints.map((bar) => positionMovingBar(bar, motionTime)),
    [movingBarBlueprints, motionTime],
  );
  const portals = useMemo(() => makePortals(level, board.width, board.height), [level, board.height, board.width]);
  const origin = useMemo(() => ({ x: board.width / 2, y: board.height - 57 }), [board.width, board.height]);
  const goal = useMemo(() => ({ x: board.width / 2, y: 51 }), [board.width]);
  const [launchPoint, setLaunchPoint] = useState<Point>(origin);
  const launchPointRef = useRef(launchPoint);

  useEffect(() => {
    stoneRef.current = stone;
  }, [stone]);

  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    launchPointRef.current = launchPoint;
  }, [launchPoint]);

  useEffect(() => {
    AsyncStorage.getItem(BEST_LEVEL_KEY).then((stored) => {
      if (stored) setBestLevel(Math.max(1, Number(stored)));
    });
  }, []);

  const resetStone = useCallback(() => {
    stoneRef.current = origin;
    velocityRef.current = { x: 0, y: 0 };
    launchPointRef.current = origin;
    setStone(origin);
    setVelocity({ x: 0, y: 0 });
    setLaunchPoint(origin);
    joystickRef.current = { x: 0, y: 0 };
    joystickAnchorRef.current = { x: board.width / 2, y: board.height / 2 };
    setJoystick({ x: 0, y: 0 });
    setJoystickAnchor(joystickAnchorRef.current);
    setJoystickVisible(false);
    setMotionTime(0);
    portalLockRef.current = null;
    setAim({ x: origin.x, y: origin.y - 75 });
  }, [board.height, board.width, origin]);

  const setGamePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const finishAttempt = useCallback(async (success: boolean) => {
    setGamePhase(success ? 'complete' : 'hit');
    setFlash(true);
    await Haptics.notificationAsync(
      success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
    if (!success) {
      setAttempts((current) => current + 1);
      resetStone();
    }
    setTimeout(() => setFlash(false), 260);
  }, [resetStone, setGamePhase]);

  useEffect(() => {
    if (phase !== 'moving') {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      return;
    }

    const startedAt = Date.now();
    let previous = Date.now();
    const tick = () => {
      const now = Date.now();
      const delta = Math.min(34, now - previous) / 16.67;
      previous = now;
      const elapsed = (now - startedAt) / 1000;
      setMotionTime(elapsed);
      const current = stoneRef.current;
      const rawNext = {
        x: current.x + velocityRef.current.x * delta,
        y: current.y + velocityRef.current.y * delta,
      };
      const friction = Math.pow(0.992, delta);
      let nextVelocity = {
        x: velocityRef.current.x * friction,
        y: velocityRef.current.y * friction,
      };
      const hitHorizontalEdge = rawNext.x < STONE_RADIUS || rawNext.x > board.width - STONE_RADIUS;
      const hitVerticalEdge = rawNext.y < STONE_RADIUS || rawNext.y > board.height - STONE_RADIUS;
      const next = {
        x: clamp(rawNext.x, STONE_RADIUS, board.width - STONE_RADIUS),
        y: clamp(rawNext.y, STONE_RADIUS, board.height - STONE_RADIUS),
      };
      if (hitHorizontalEdge) {
        nextVelocity = { ...nextVelocity, x: -nextVelocity.x };
      }
      if (hitVerticalEdge) {
        nextVelocity = { ...nextVelocity, y: -nextVelocity.y };
      }
      velocityRef.current = nextVelocity;
      const activeMovingBars = movingBarBlueprints.map((bar) => positionMovingBar(bar, elapsed));
      const collided = [...course, ...activeMovingBars].some((line) => distanceToSegment(next, line) < STONE_RADIUS + 3);
      const reachedGoal = Math.hypot(next.x - goal.x, next.y - goal.y) < 26;

      if (collided) {
        finishAttempt(false);
        return;
      }
      if (reachedGoal) {
        finishAttempt(true);
        return;
      }

      if (portalLockRef.current) {
        const [lockedPortalId, lockedHole] = portalLockRef.current.split(':');
        const lockedPortal = portals.find((portal) => portal.id === lockedPortalId);
        const lockedPoint = lockedPortal?.[lockedHole === 'a' ? 'a' : 'b'];
        if (!lockedPoint || Math.hypot(next.x - lockedPoint.x, next.y - lockedPoint.y) > HOLE_RADIUS + STONE_RADIUS + 8) {
          portalLockRef.current = null;
        }
      }

      const enteredPortal = portals.find((portal) => {
        const nearA = Math.hypot(next.x - portal.a.x, next.y - portal.a.y) < HOLE_RADIUS + STONE_RADIUS;
        const nearB = Math.hypot(next.x - portal.b.x, next.y - portal.b.y) < HOLE_RADIUS + STONE_RADIUS;
        return (nearA && portalLockRef.current !== `${portal.id}:a`)
          || (nearB && portalLockRef.current !== `${portal.id}:b`);
      });
      if (enteredPortal) {
        const nearA = Math.hypot(next.x - enteredPortal.a.x, next.y - enteredPortal.a.y) < HOLE_RADIUS + STONE_RADIUS;
        next.x = nearA ? enteredPortal.b.x : enteredPortal.a.x;
        next.y = nearA ? enteredPortal.b.y : enteredPortal.a.y;
        portalLockRef.current = `${enteredPortal.id}:${nearA ? 'b' : 'a'}`;
        void Haptics.selectionAsync();
      }

      stoneRef.current = next;
      setStone(next);
      if (Math.hypot(nextVelocity.x, nextVelocity.y) < 0.08) {
        const restingAim = { x: next.x, y: next.y - 75 };
        velocityRef.current = { x: 0, y: 0 };
        launchPointRef.current = next;
        aimRef.current = restingAim;
        setVelocity({ x: 0, y: 0 });
        setLaunchPoint(next);
        setAim(restingAim);
        setJoystickVisible(false);
        setGamePhase('aiming');
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [board.height, board.width, course, finishAttempt, goal, movingBarBlueprints, phase, portals]);

  useEffect(() => {
    if (phase !== 'complete') return;
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 180, useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [phase, pulse]);

  const launch = useCallback(async () => {
    if (phaseRef.current !== 'aiming') return;
    const start = launchPointRef.current;
    const dx = aimRef.current.x - start.x;
    const dy = aimRef.current.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_DRAG) return;
    const strength = clamp(length / MAX_DRAG, 0.25, 1);
    const speed = 7.1 * strength;
    const nextVelocity = { x: (dx / length) * speed, y: (dy / length) * speed };
    velocityRef.current = nextVelocity;
    setVelocity(nextVelocity);
    setGamePhase('moving');
    setShowHelp(false);
    setMotionTime(0);
    portalLockRef.current = null;
    joystickRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
    setJoystickVisible(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [setGamePhase]);

  const updateJoystick = useCallback((x: number, y: number) => {
    const anchor = joystickAnchorRef.current;
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    const distance = Math.hypot(dx, dy);
    const limited = Math.min(distance, AIM_PAD_RADIUS);
    const offset = distance === 0
      ? { x: 0, y: 0 }
      : { x: (dx / distance) * limited, y: (dy / distance) * limited };
    const start = launchPointRef.current;
    const aimDistance = MAX_DRAG * (limited / AIM_PAD_RADIUS);
    const next = distance === 0
      ? start
      : { x: start.x + (dx / distance) * aimDistance, y: start.y + (dy / distance) * aimDistance };
    joystickRef.current = offset;
    aimRef.current = next;
    setJoystick(offset);
    setAim(next);
  }, []);

  const startAim = useCallback((x: number, y: number) => {
    const anchor = {
      x: clamp(x, AIM_PAD_SIZE / 2 + 8, board.width - AIM_PAD_SIZE / 2 - 8),
      y: clamp(y, AIM_PAD_SIZE / 2 + 8, board.height - AIM_PAD_SIZE / 2 - 8),
    };
    joystickAnchorRef.current = anchor;
    setJoystickAnchor(anchor);
    joystickRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
    setJoystickVisible(true);
    aimRef.current = launchPointRef.current;
    setAim(launchPointRef.current);
  }, [board.height, board.width]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => phaseRef.current === 'aiming',
    onMoveShouldSetPanResponder: () => phaseRef.current === 'aiming',
    onPanResponderGrant: (event) => {
      if (phaseRef.current === 'aiming') {
        startAim(event.nativeEvent.locationX, event.nativeEvent.locationY);
      }
    },
    onPanResponderMove: (event) => {
      if (phaseRef.current === 'aiming') {
        updateJoystick(event.nativeEvent.locationX, event.nativeEvent.locationY);
      }
    },
    onPanResponderRelease: launch,
    onPanResponderTerminate: launch,
  }), [launch, startAim, updateJoystick]);

  const nextLevel = useCallback(async () => {
    const next = level + 1;
    setLevel(next);
    if (next > bestLevel) {
      setBestLevel(next);
      await AsyncStorage.setItem(BEST_LEVEL_KEY, String(next));
    }
    resetStone();
    setGamePhase('aiming');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [bestLevel, level, resetStone, setGamePhase]);

  const retry = useCallback(() => {
    resetStone();
    setGamePhase('aiming');
  }, [resetStone, setGamePhase]);

  const progress = clamp(Math.hypot(aim.x - launchPoint.x, aim.y - launchPoint.y) / MAX_DRAG, 0, 1);
  const boardInsetTop = Math.max(18, insets.top * 0.18);

  return (
    <View style={[styles.screen, { backgroundColor: colors.gameBackground, paddingTop: boardInsetTop }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>ÇİZGİ KAÇIŞ</Text>
          <Text style={[styles.title, { color: colors.ink }]}>Sakin ol. İyi at.</Text>
        </View>
        <View style={[styles.levelPill, { backgroundColor: colors.gameSurface }]}>
          <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>BÖLÜM</Text>
          <Text style={[styles.levelValue, { color: colors.goal }]}>{formatLevel(level)}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Feather name="target" size={15} color={colors.stone} />
          <Text style={[styles.statText, { color: colors.ink }]}>{attempts} atış</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="award" size={15} color={colors.goal} />
          <Text style={[styles.statText, { color: colors.ink }]}>en iyi {formatLevel(bestLevel)}</Text>
        </View>
        <Text style={[styles.tip, { color: colors.mutedForeground }]}>çizgiye değme</Text>
      </View>

      <View
        style={[styles.board, { backgroundColor: colors.gameSurface, borderColor: colors.border }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0 && (width !== board.width || height !== board.height)) {
            setBoard({ width, height });
            const nextOrigin = { x: width / 2, y: height - 57 };
            setStone(nextOrigin);
            stoneRef.current = nextOrigin;
            setLaunchPoint(nextOrigin);
            launchPointRef.current = nextOrigin;
            setAim({ x: nextOrigin.x, y: nextOrigin.y - 75 });
            aimRef.current = { x: nextOrigin.x, y: nextOrigin.y - 75 };
            setJoystick({ x: 0, y: 0 });
            joystickRef.current = { x: 0, y: 0 };
            setJoystickAnchor({ x: width / 2, y: height / 2 });
            joystickAnchorRef.current = { x: width / 2, y: height / 2 };
            setJoystickVisible(false);
          }
        }}
        {...responder.panHandlers}
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <View key={`v-${index}`} style={[styles.gridVertical, { left: (board.width / 8) * (index + 1), backgroundColor: colors.gridLine }]} />
        ))}
        {Array.from({ length: 10 }).map((_, index) => (
          <View key={`h-${index}`} style={[styles.gridHorizontal, { top: (board.height / 10) * (index + 1), backgroundColor: colors.gridLine }]} />
        ))}

        <View style={[styles.goal, { left: goal.x - 18, top: goal.y - 18, borderColor: colors.goal }]}>
          <View style={[styles.goalCore, { backgroundColor: colors.goal }]} />
        </View>
        <Text style={[styles.goalText, { left: goal.x - 25, top: goal.y + 25, color: colors.goal }]}>ÇIKIŞ</Text>

        {course.map((line, index) => {
          const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
          return (
            <View
              key={`line-${index}`}
              style={[
                styles.obstacle,
                {
                  backgroundColor: colors.obstacle,
                  width: length,
                  left: line.x1,
                  top: line.y1 - 2,
                  transform: [{ rotate: `${angle}rad` }],
                },
              ]}
            />
          );
        })}
        {movingBars.map((line, index) => {
          const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
          return (
            <View
              key={`moving-line-${movingBarBlueprints[index]?.id ?? index}`}
              style={[
                styles.obstacle,
                styles.movingObstacle,
                {
                  backgroundColor: colors.obstacle,
                  borderColor: colors.stoneHighlight,
                  width: length,
                  left: line.x1,
                  top: line.y1 - 3,
                  transform: [{ rotate: `${angle}rad` }],
                },
              ]}
            />
          );
        })}

        {portals.map((portal) => (
          <React.Fragment key={portal.id}>
            {[{ point: portal.a, side: 'a' }, { point: portal.b, side: 'b' }].map(({ point, side }) => (
              <View
                key={`${portal.id}-${side}`}
                style={[
                  styles.hole,
                  {
                    left: point.x - HOLE_RADIUS,
                    top: point.y - HOLE_RADIUS,
                    borderColor: colors.stoneHighlight,
                    backgroundColor: `${colors.gameBackground}D9`,
                  },
                ]}
              >
                <View style={[styles.holeCore, { backgroundColor: colors.stone }]} />
                <Text style={[styles.holeLabel, { color: colors.stoneHighlight }]}>{portal.label}</Text>
              </View>
            ))}
          </React.Fragment>
        ))}

        {phase === 'aiming' && (
          <>
            <View
              style={[
                styles.aimGuide,
                {
                  backgroundColor: colors.stoneHighlight,
                  width: Math.max(1, Math.hypot(aim.x - launchPoint.x, aim.y - launchPoint.y)),
                  left: launchPoint.x,
                  top: launchPoint.y - 1,
                  transform: [{ rotate: `${Math.atan2(aim.y - launchPoint.y, aim.x - launchPoint.x)}rad` }],
                  opacity: 0.36 + progress * 0.5,
                },
              ]}
            />
            <View style={[styles.powerTrack, { backgroundColor: colors.gameSurfaceRaised }]}>
              <View style={[styles.powerFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.stone }]} />
            </View>
            {showHelp && (
              <View style={[styles.helpBubble, { backgroundColor: colors.gameSurfaceRaised }]}>
                <Feather name="move" size={16} color={colors.stoneHighlight} />
                <Text style={[styles.helpText, { color: colors.ink }]}>Ekranda istediğin yere dokun, sürükle ve bırak</Text>
              </View>
            )}
            {joystickVisible && (
              <View
                testID="aim-joystick"
                style={[
                  styles.aimPad,
                  {
                    left: joystickAnchor.x - AIM_PAD_SIZE / 2,
                    top: joystickAnchor.y - AIM_PAD_SIZE / 2,
                    backgroundColor: `${colors.gameSurfaceRaised}E8`,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={[styles.aimPadRing, { borderColor: colors.mutedForeground }]} pointerEvents="none" />
                <View
                  style={[
                    styles.aimKnob,
                    {
                      backgroundColor: colors.stone,
                      left: AIM_PAD_SIZE / 2 - 16 + joystick.x,
                      top: AIM_PAD_SIZE / 2 - 16 + joystick.y,
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Feather name="crosshair" size={15} color={colors.gameBackground} />
                </View>
                <Text style={[styles.aimPadLabel, { color: colors.mutedForeground }]} pointerEvents="none">YÖN</Text>
              </View>
            )}
          </>
        )}

        <Animated.View
          style={[
            styles.stone,
            { left: stone.x - STONE_RADIUS, top: stone.y - STONE_RADIUS, backgroundColor: colors.stone, transform: [{ scale: pulse }] },
          ]}
        >
          <View style={[styles.stoneShine, { backgroundColor: colors.stoneHighlight }]} />
        </Animated.View>

        {flash && <View style={[styles.flash, { backgroundColor: colors.obstacle }]} />}

        {phase === 'hit' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.obstacle}22` }]}>
              <Feather name="rotate-ccw" size={20} color={colors.obstacle} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>Çizgiye değdin</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>Taş başlangıca döndü. Biraz daha dikkatli bir açı dene.</Text>
            <Pressable
              testID="retry-button"
              onPress={retry}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.stone, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="rotate-cw" size={16} color={colors.gameBackground} />
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>Yeniden dene</Text>
            </Pressable>
          </View>
        )}

        {phase === 'complete' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.goal}22` }]}>
              <Feather name="check" size={21} color={colors.goal} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>Temiz geçiş</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>Yeni bölümde çizgiler daha sık. Hazır mısın?</Text>
            <Pressable
              testID="next-level-button"
              onPress={nextLevel}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>Sonraki bölüm</Text>
              <Feather name="arrow-right" size={17} color={colors.gameBackground} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: colors.obstacle }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>engel</Text>
          <View style={[styles.legendDot, { backgroundColor: colors.goal }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>çıkış</Text>
          {movingBars.length > 0 && (
            <>
              <Feather name="move" size={12} color={colors.stone} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>hareketli</Text>
            </>
          )}
          {portals.length > 0 && (
            <>
              <View style={[styles.legendDot, { backgroundColor: colors.stoneHighlight }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>geçit</Text>
            </>
          )}
        </View>
        <Text style={[styles.footerHint, { color: colors.mutedForeground }]}>
          {portals.length > 0 ? 'Aynı harfli delikler eşleşir' : movingBars.length > 0 ? 'Kırmızı çubuklar hareketli' : 'Yolunu önceden gör'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 14 },
  eyebrow: { fontSize: 11, letterSpacing: 2.2, fontWeight: '700' },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '700', marginTop: 4, letterSpacing: -0.5 },
  levelPill: { borderRadius: 16, minWidth: 65, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center' },
  levelLabel: { fontSize: 9, letterSpacing: 1.3, fontWeight: '700' },
  levelValue: { fontSize: 20, fontWeight: '700', marginTop: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 13 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12, fontWeight: '600' },
  tip: { flex: 1, textAlign: 'right', fontSize: 11 },
  board: { flex: 1, minHeight: 430, borderRadius: 24, borderWidth: 1, overflow: 'hidden', position: 'relative' },
  gridVertical: { width: 1, position: 'absolute', top: 0, bottom: 0, opacity: 0.55 },
  gridHorizontal: { height: 1, position: 'absolute', left: 0, right: 0, opacity: 0.55 },
  goal: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  goalCore: { width: 9, height: 9, borderRadius: 5 },
  goalText: { position: 'absolute', fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  obstacle: { height: 4, position: 'absolute', borderRadius: 4, transformOrigin: 'left center' },
  movingObstacle: { height: 6, borderWidth: 1 },
  stone: { width: STONE_RADIUS * 2, height: STONE_RADIUS * 2, borderRadius: STONE_RADIUS, position: 'absolute', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  stoneShine: { width: 5, height: 5, borderRadius: 3, position: 'absolute', top: 4, left: 5, opacity: 0.9 },
  hole: { width: HOLE_RADIUS * 2, height: HOLE_RADIUS * 2, position: 'absolute', borderRadius: HOLE_RADIUS, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  holeCore: { width: 7, height: 7, borderRadius: 4 },
  holeLabel: { position: 'absolute', top: 1, right: 5, fontSize: 8, fontWeight: '700' },
  aimGuide: { height: 2, position: 'absolute', transformOrigin: 'left center', borderRadius: 2 },
  aimPad: { width: AIM_PAD_SIZE, height: AIM_PAD_SIZE, position: 'absolute', borderRadius: AIM_PAD_SIZE / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  aimPadRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 1, opacity: 0.45 },
  aimKnob: { width: 32, height: 32, borderRadius: 16, position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  aimPadLabel: { position: 'absolute', bottom: 7, fontSize: 8, letterSpacing: 1.2, fontWeight: '700' },
  powerTrack: { position: 'absolute', left: 18, right: 18, bottom: 18, height: 5, borderRadius: 5, overflow: 'hidden' },
  powerFill: { height: '100%', borderRadius: 5 },
  helpBubble: { position: 'absolute', top: '47%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  helpText: { fontSize: 12, fontWeight: '600' },
  flash: { ...StyleSheet.absoluteFill, opacity: 0.08 },
  resultCard: { position: 'absolute', left: 22, right: 22, top: '35%', borderRadius: 20, padding: 19, alignItems: 'center' },
  resultIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  resultTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  resultCopy: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6, maxWidth: 235 },
  resultButton: { marginTop: 16, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultButtonText: { fontSize: 13, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 12 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 4 },
  legendText: { fontSize: 11 },
  footerHint: { fontSize: 11 },
});