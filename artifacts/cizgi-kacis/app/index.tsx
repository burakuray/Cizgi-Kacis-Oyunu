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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { formatCopy, chapterName as localizedChapterName, t } from '@/lib/i18n';
import { playSound, setSoundEnabled } from '@/lib/sound';
import {
  HOLE_RADIUS,
  STONE_RADIUS,
  bounceFromBarriers,
  clamp,
  distanceToSegment,
  makeCourse,
  makeBouncyBarriers,
  makeMovingBars,
  makePortals,
  renderedMovingBars,
  resolveLifeLoss,
  resolvePortalStep,
} from '@/game-logic';

type Point = { x: number; y: number };
type Phase = 'aiming' | 'moving' | 'hit' | 'complete' | 'demoted' | 'gameover';
type Completion = { stars: number; medal: string; score: number; riskBonus: number };

const BEST_LEVEL_KEY = '@cizgi-kacis/best-level';
const LEVEL_STARS_KEY = '@cizgi-kacis/level-stars';
const STREAK_KEY = '@cizgi-kacis/streak';
const DAILY_PROGRESS_KEY = '@cizgi-kacis/daily-progress';
const DAILY_DATE_KEY = '@cizgi-kacis/daily-date';
const SKINS_KEY = '@cizgi-kacis/stone-skins';
const SELECTED_SKIN_KEY = '@cizgi-kacis/selected-skin';
const BEST_SCORE_KEY = '@cizgi-kacis/best-score';
const SCORE_HISTORY_KEY = '@cizgi-kacis/score-history';
const SOUND_ENABLED_KEY = '@cizgi-kacis/sound-enabled';
const LEVEL_LIVES = 3;
const MAX_DRAG = 94;
const MIN_DRAG = 16;
const AIM_PAD_SIZE = 96;
const AIM_PAD_RADIUS = 38;

function formatLevel(level: number) {
  return String(level).padStart(2, '0');
}

function starsForAttempts(attempts: number) {
  if (attempts === 0) return 3;
  if (attempts <= 2) return 2;
  return 1;
}

function readJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function chapterForLevel(level: number) {
  return localizedChapterName(level);
}

function scoreForLevel(level: number, attempts: number, riskBonus: number) {
  return Math.max(100, level * 100 + Math.max(0, 300 - attempts * 90) + riskBonus);
}

export default function GameScreen() {
  const colors = useColors();
  const router = useRouter();
  const { level: routeLevel } = useLocalSearchParams<{ level?: string }>();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState({ width: Dimensions.get('window').width - 32, height: 480 });
  const [level, setLevel] = useState(1);
  const [bestLevel, setBestLevel] = useState(1);
  const [bestScore, setBestScore] = useState(0);
  const [runScore, setRunScore] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const [levelAttempts, setLevelAttempts] = useState(0);
  const [lives, setLives] = useState(LEVEL_LIVES);
  const [levelStars, setLevelStars] = useState<Record<string, number>>({});
  const [streak, setStreak] = useState(0);
  const [dailyProgress, setDailyProgress] = useState(0);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [riskBonus, setRiskBonus] = useState(0);
  const [stoneSkin, setStoneSkin] = useState('coral');
  const [unlockedSkins, setUnlockedSkins] = useState<string[]>(['coral']);
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
  const [burstPoint, setBurstPoint] = useState<Point | null>(null);
  const [trail, setTrail] = useState<Point[]>([]);
  const [showIntro, setShowIntro] = useState(true);
  const stoneRef = useRef(stone);
  const velocityRef = useRef(velocity);
  const phaseRef = useRef(phase);
  const aimRef = useRef(aim);
  const joystickRef = useRef(joystick);
  const joystickAnchorRef = useRef(joystickAnchor);
  const portalLockRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const motionTimeRef = useRef(0);
  const riskBonusRef = useRef(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const burstScale = useRef(new Animated.Value(0.35)).current;
  const burstOpacity = useRef(new Animated.Value(1)).current;
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introScale = useRef(new Animated.Value(0.94)).current;

  const course = useMemo(() => makeCourse(level, board.width, board.height), [level, board.height, board.width]);
  const bouncyBarriers = useMemo(() => makeBouncyBarriers(level, board.width, board.height), [level, board.height, board.width]);
  const movingBarBlueprints = useMemo(
    () => makeMovingBars(level, board.width, board.height),
    [level, board.height, board.width],
  );
  const movingBars = useMemo(
    () => renderedMovingBars(movingBarBlueprints, motionTime),
    [movingBarBlueprints, motionTime],
  );
  const portals = useMemo(() => makePortals(level, board.width, board.height), [level, board.height, board.width]);
  const origin = useMemo(() => ({ x: board.width / 2, y: board.height - 57 }), [board.width, board.height]);
  const goal = useMemo(() => ({ x: board.width / 2, y: 51 }), [board.width]);
  const [launchPoint, setLaunchPoint] = useState<Point>(origin);
  const launchPointRef = useRef(launchPoint);

  const chapter = chapterForLevel(level);

  useEffect(() => {
    const requestedLevel = Number(routeLevel);
    if (Number.isInteger(requestedLevel) && requestedLevel > 0 && requestedLevel <= bestLevel) {
      setLevel(requestedLevel);
    }
  }, [bestLevel, routeLevel]);

  useEffect(() => {
    setShowIntro(true);
    introOpacity.setValue(0);
    introScale.setValue(0.94);
    Animated.parallel([
      Animated.timing(introOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(introScale, { toValue: 1, damping: 14, stiffness: 180, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => setShowIntro(false), 950);
    return () => clearTimeout(timer);
  }, [introOpacity, introScale, level]);

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
    Promise.all([
      AsyncStorage.getItem(BEST_LEVEL_KEY),
      AsyncStorage.getItem(LEVEL_STARS_KEY),
      AsyncStorage.getItem(STREAK_KEY),
      AsyncStorage.getItem(DAILY_PROGRESS_KEY),
      AsyncStorage.getItem(DAILY_DATE_KEY),
      AsyncStorage.getItem(SKINS_KEY),
      AsyncStorage.getItem(SELECTED_SKIN_KEY),
      AsyncStorage.getItem(BEST_SCORE_KEY),
      AsyncStorage.getItem(SOUND_ENABLED_KEY),
    ]).then(([storedBest, storedStars, storedStreak, storedDaily, storedDailyDate, storedSkins, storedSelectedSkin, storedBestScore, storedSound]) => {
      if (storedBest) setBestLevel(Math.max(1, Number(storedBest)));
      setBestScore(Math.max(0, Number(storedBestScore ?? 0)));
      const enabled = storedSound !== 'false';
      setSoundEnabledState(enabled);
      setSoundEnabled(enabled);
      setLevelStars(readJson<Record<string, number>>(storedStars, {}));
      setStreak(Math.max(0, Number(storedStreak ?? 0)));
      const today = new Date().toISOString().slice(0, 10);
      const isToday = storedDailyDate === today;
      const savedSkins = readJson<string[]>(storedSkins, ['coral']);
      setDailyProgress(isToday ? Math.min(3, Math.max(0, Number(storedDaily ?? 0))) : 0);
      setUnlockedSkins(savedSkins.includes('coral') ? savedSkins : ['coral', ...savedSkins]);
      setStoneSkin(storedSelectedSkin && savedSkins.includes(storedSelectedSkin) ? storedSelectedSkin : savedSkins[0] ?? 'coral');
      if (!isToday) {
        void AsyncStorage.multiSet([[DAILY_DATE_KEY, today], [DAILY_PROGRESS_KEY, '0']]);
      }
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
    portalLockRef.current = null;
    setTrail([]);
    riskBonusRef.current = 0;
    setRiskBonus(0);
    setAim({ x: origin.x, y: origin.y - 75 });
  }, [board.height, board.width, origin]);

  const setGamePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const finishAttempt = useCallback(async (success: boolean, impactPoint?: Point) => {
    setGamePhase(success ? 'complete' : 'hit');
    setFlash(true);
    if (!success) {
      void playSound('hit');
      setBurstPoint(impactPoint ?? stoneRef.current);
      burstScale.setValue(0.35);
      burstOpacity.setValue(1);
      Animated.parallel([
        Animated.timing(burstScale, { toValue: 1.5, duration: 360, useNativeDriver: true }),
        Animated.timing(burstOpacity, { toValue: 0, duration: 360, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setBurstPoint(null);
      });
    }
    await Haptics.notificationAsync(
      success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
    if (!success) {
      const nextLevelAttempts = levelAttempts + 1;
      const lifeLoss = resolveLifeLoss(level, lives, LEVEL_LIVES);
      setAttempts((current) => current + 1);
      setLevelAttempts(nextLevelAttempts);
      setLives(lifeLoss.lives);

      if (lifeLoss.outcome === 'retry') {
        resetStone();
      } else if (lifeLoss.outcome === 'demoted') {
        setLevel(lifeLoss.level);
        setLevelAttempts(0);
        resetStone();
        setGamePhase('demoted');
      } else {
        setGamePhase('gameover');
      }
    } else {
      void playSound('success');
      const stars = starsForAttempts(levelAttempts);
      const medal = levelAttempts === 0 ? 'Kusursuz atış' : stars === 2 ? 'Temiz geçiş' : 'Bölüm tamamlandı';
      const score = scoreForLevel(level, levelAttempts, riskBonusRef.current);
      const nextBestScore = Math.max(bestScore, score);
      setRunScore((current) => current + score);
      const nextStars = { ...levelStars, [String(level)]: Math.max(levelStars[String(level)] ?? 0, stars) };
      const nextStreak = streak + 1;
      const nextDailyProgress = Math.min(3, dailyProgress + 1);
      const nextSkins = Array.from(new Set([
        ...unlockedSkins,
        ...(nextStreak >= 3 ? ['mint'] : []),
        ...(nextStreak >= 6 ? ['gold'] : []),
      ]));
      setCompletion({ stars, medal, score, riskBonus: riskBonusRef.current });
      setBestScore(nextBestScore);
      setLevelStars(nextStars);
      setStreak(nextStreak);
      setDailyProgress(nextDailyProgress);
      setUnlockedSkins(nextSkins);
      const storedHistory = await AsyncStorage.getItem(SCORE_HISTORY_KEY);
      const scoreHistory = readJson<Array<{ level: number; score: number; stars: number; date: string }>>(storedHistory, []);
      scoreHistory.push({ level, score, stars, date: new Date().toISOString().slice(0, 10) });
      const topScores = scoreHistory.sort((left, right) => right.score - left.score).slice(0, 20);
      await Promise.all([
        AsyncStorage.setItem(LEVEL_STARS_KEY, JSON.stringify(nextStars)),
        AsyncStorage.setItem(STREAK_KEY, String(nextStreak)),
        AsyncStorage.setItem(DAILY_PROGRESS_KEY, String(nextDailyProgress)),
        AsyncStorage.setItem(SKINS_KEY, JSON.stringify(nextSkins)),
        AsyncStorage.setItem(BEST_SCORE_KEY, String(nextBestScore)),
        AsyncStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(topScores)),
      ]);
    }
    setTimeout(() => setFlash(false), 260);
  }, [bestScore, burstOpacity, burstScale, dailyProgress, level, levelAttempts, levelStars, lives, resetStone, setGamePhase, streak, unlockedSkins]);

  useEffect(() => {
    if (phase !== 'moving') {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      return;
    }

    const startedAt = Date.now() - motionTimeRef.current * 1000;
    let previous = Date.now();
    const tick = () => {
      const now = Date.now();
      const delta = Math.min(34, now - previous) / 16.67;
      previous = now;
      const elapsed = (now - startedAt) / 1000;
      motionTimeRef.current = elapsed;
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
      const activeMovingBars = renderedMovingBars(movingBarBlueprints, elapsed);
      const bounce = bounceFromBarriers(next, nextVelocity, bouncyBarriers);
      if (bounce.bounced) {
        next.x = bounce.point.x;
        next.y = bounce.point.y;
        nextVelocity = bounce.velocity;
        velocityRef.current = nextVelocity;
        setVelocity(nextVelocity);
        setStone(next);
        setTrail((currentTrail) => [...currentTrail.slice(-17), next]);
        void playSound('portal');
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      const nearestObstacle = [...course, ...bouncyBarriers, ...activeMovingBars].reduce(
        (nearest, segment) => Math.min(nearest, distanceToSegment(next, segment)),
        Number.POSITIVE_INFINITY,
      );
      const currentRiskBonus = Math.max(0, Math.round((48 - nearestObstacle) * 4));
      if (currentRiskBonus > riskBonusRef.current) {
        riskBonusRef.current = currentRiskBonus;
        setRiskBonus(currentRiskBonus);
      }
      const portalStep = resolvePortalStep(next, portals, portalLockRef.current, [...course, ...bouncyBarriers, ...activeMovingBars]);
      const collided = portalStep.collided;
      const reachedGoal = Math.hypot(next.x - goal.x, next.y - goal.y) < 26;

      if (collided) {
        finishAttempt(false, next);
        return;
      }
      if (reachedGoal) {
        finishAttempt(true);
        return;
      }

      portalLockRef.current = portalStep.portalLock;
      if (portalStep.enteredPortalId) {
        next.x = portalStep.point.x;
        next.y = portalStep.point.y;
        void playSound('portal');
        void Haptics.selectionAsync();
      }

      stoneRef.current = next;
      setStone(next);
      setTrail((currentTrail) => [...currentTrail.slice(-17), next]);
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
  }, [board.height, board.width, bouncyBarriers, course, finishAttempt, goal, movingBarBlueprints, phase, portals]);

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
    setTrail([start]);
    void playSound('launch');
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
    onStartShouldSetPanResponder: () => phaseRef.current === 'aiming' && !showIntro,
    onMoveShouldSetPanResponder: () => phaseRef.current === 'aiming' && !showIntro,
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
  }), [launch, showIntro, startAim, updateJoystick]);

  const nextLevel = useCallback(async () => {
    const next = level + 1;
    setLevel(next);
    setLives(LEVEL_LIVES);
    if (next > bestLevel) {
      setBestLevel(next);
      await AsyncStorage.setItem(BEST_LEVEL_KEY, String(next));
    }
    setLevelAttempts(0);
    setCompletion(null);
    resetStone();
    setGamePhase('aiming');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [bestLevel, level, resetStone, setGamePhase]);

  const retry = useCallback(() => {
    resetStone();
    setGamePhase('aiming');
  }, [resetStone, setGamePhase]);

  const continueAfterDemotion = useCallback(() => {
    setGamePhase('aiming');
  }, [setGamePhase]);

  const restartRun = useCallback(() => {
    setLevel(1);
    setLives(LEVEL_LIVES);
    setLevelAttempts(0);
    setAttempts(0);
    setRunScore(0);
    setCompletion(null);
    setShowHelp(true);
    resetStone();
    setGamePhase('aiming');
  }, [resetStone, setGamePhase]);

  const progress = clamp(Math.hypot(aim.x - launchPoint.x, aim.y - launchPoint.y) / MAX_DRAG, 0, 1);
  const boardInsetTop = Math.max(18, insets.top * 0.18);
  const stoneColor = stoneSkin === 'mint' ? colors.goal : stoneSkin === 'gold' ? colors.stoneHighlight : colors.stone;
  const chapterAccent = level >= 9 ? colors.stoneHighlight : level >= 5 ? colors.goal : colors.obstacle;
  const chapterStart = level >= 9 ? 9 : level >= 5 ? 5 : level >= 3 ? 3 : 1;
  const chapterProgress = Math.min(4, Math.max(1, level - chapterStart + 1));
  const starsCollected = Object.values(levelStars).reduce((total, stars) => total + stars, 0);
  const cycleSkin = () => {
    const currentIndex = unlockedSkins.indexOf(stoneSkin);
    const nextSkin = unlockedSkins[(currentIndex + 1) % unlockedSkins.length] ?? 'coral';
    setStoneSkin(nextSkin);
    void AsyncStorage.setItem(SELECTED_SKIN_KEY, nextSkin);
  };
  const toggleSound = () => {
    const nextEnabled = !soundEnabled;
    setSoundEnabledState(nextEnabled);
    setSoundEnabled(nextEnabled);
    void AsyncStorage.setItem(SOUND_ENABLED_KEY, String(nextEnabled));
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.gameBackground, paddingTop: boardInsetTop }]}>
      <View style={styles.header}>
        <View>
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { backgroundColor: stoneColor }]} />
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{t('gameName')}</Text>
          </View>
          <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/map')} style={styles.headerIcon} accessibilityLabel="Bölüm haritası">
            <Feather name="map" size={16} color={colors.ink} />
          </Pressable>
          <Pressable onPress={() => router.push('/leaderboard')} style={styles.headerIcon} accessibilityLabel="Skor tablosu">
            <Feather name="bar-chart-2" size={16} color={colors.ink} />
          </Pressable>
          <Pressable onPress={toggleSound} style={styles.headerIcon} accessibilityLabel={soundEnabled ? t('soundOn') : t('soundOff')}>
            <Feather name={soundEnabled ? 'volume-2' : 'volume-x'} size={16} color={soundEnabled ? colors.stoneHighlight : colors.mutedForeground} />
          </Pressable>
          <View style={[styles.levelPill, { backgroundColor: colors.gameSurface }]}>
            <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>{t('section')}</Text>
            <Text style={[styles.levelValue, { color: colors.goal }]}>{formatLevel(level)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Feather name="target" size={15} color={colors.stone} />
          <Text style={[styles.statText, { color: colors.ink }]}>{attempts} {t('attempts')}</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="award" size={15} color={colors.goal} />
          <Text style={[styles.statText, { color: colors.ink }]}>{t('best')} {formatLevel(bestLevel)}</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="zap" size={14} color={colors.stoneHighlight} />
          <Text style={[styles.statText, { color: colors.ink }]}>{streak} {t('streak')}</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="bar-chart-2" size={14} color={chapterAccent} />
          <Text style={[styles.statText, { color: colors.ink }]}>{bestScore} {t('score')}</Text>
        </View>
        <View style={styles.statusHint}>
          <View style={[styles.statusDot, { backgroundColor: phase === 'moving' ? stoneColor : colors.goal }]} />
          <Text style={[styles.tip, { color: colors.mutedForeground }]}>
            {phase === 'moving' ? t('moving') : t('drag')}
          </Text>
        </View>
      </View>
      <View style={styles.livesRow}>
        <Text style={[styles.livesLabel, { color: colors.mutedForeground }]}>{t('lives')}</Text>
        <View style={styles.hearts}>
          {Array.from({ length: LEVEL_LIVES }).map((_, index) => (
            <Feather
              key={`life-${index}`}
              name="heart"
              size={14}
              color={index < lives ? colors.obstacle : colors.border}
              fill={index < lives ? colors.obstacle : 'transparent'}
            />
          ))}
        </View>
        <Text style={[styles.livesCount, { color: colors.ink }]}>{lives}/{LEVEL_LIVES}</Text>
      </View>
      <View style={styles.chapterProgressRow}>
        <Text style={[styles.chapterProgressLabel, { color: chapterAccent }]}>{chapter}</Text>
        <View style={[styles.chapterProgressTrack, { backgroundColor: colors.gameSurfaceRaised }]}>
          <View style={[styles.chapterProgressFill, { width: `${chapterProgress * 25}%`, backgroundColor: chapterAccent }]} />
        </View>
        <Text style={[styles.chapterProgressCount, { color: colors.mutedForeground }]}>{chapterProgress}/4 · {starsCollected} {t('stars')}</Text>
      </View>

      <View
        style={[styles.board, { backgroundColor: colors.gameSurface, borderColor: chapterAccent }]}
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
        {showIntro && (
          <Animated.View
            pointerEvents="none"
            style={[styles.chapterIntro, { opacity: introOpacity, transform: [{ scale: introScale }] }]}
          >
            <Feather name="aperture" size={18} color={colors.stoneHighlight} />
            <Text style={[styles.chapterKicker, { color: colors.stoneHighlight }]}>{t('newScene')}</Text>
            <Text style={[styles.chapterTitle, { color: colors.ink }]}>{chapter}</Text>
            <Text style={[styles.chapterNumber, { color: colors.mutedForeground }]}>{t('chapter')} {formatLevel(level)}</Text>
          </Animated.View>
        )}
        <View style={[styles.goal, { left: goal.x - 18, top: goal.y - 18, borderColor: colors.goal }]}>
        </View>
        <Text style={[styles.goalText, { left: goal.x - 25, top: goal.y + 25, color: colors.goal }]}>{t('exit')}</Text>


          {trail.length > 1 && trail.slice(1).map((point, index) => {
            const previous = trail[index];
            const length = Math.hypot(point.x - previous.x, point.y - previous.y);
            return (
              <View
                key={`trail-${index}`}
                pointerEvents="none"
                style={[
                  styles.trail,
                  {
                    width: Math.max(2, length),
                    left: previous.x,
                    top: previous.y - 1,
                    opacity: ((index + 1) / trail.length) * 0.42,
                    backgroundColor: stoneColor,
                    transform: [{ rotate: `${Math.atan2(point.y - previous.y, point.x - previous.x)}rad` }],
                  },
                ]}
              />
            );
          })}
        {course.map((line, index) => {
          const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
          const spikeCount = Math.max(1, Math.floor(length / 22));
          return (
            <React.Fragment key={`line-${index}`}>
              <View
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
              {Array.from({ length: spikeCount }).map((_, spikeIndex) => {
                const progress = (spikeIndex + 0.5) / spikeCount;
                return (
                  <View
                    key={`line-${index}-spike-${spikeIndex}`}
                    style={[
                      styles.spike,
                      {
                        borderBottomColor: colors.obstacle,
                        left: line.x1 + (line.x2 - line.x1) * progress - 5,
                        top: line.y1 + (line.y2 - line.y1) * progress - 9,
                        transform: [{ rotate: `${angle}rad` }],
                      },
                    ]}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
        {movingBars.map((line, index) => {
          const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
          const spikeCount = Math.max(1, Math.floor(length / 20));
          return (
            <React.Fragment key={`moving-line-${movingBarBlueprints[index]?.id ?? index}`}>
              <View
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
              {Array.from({ length: spikeCount }).map((_, spikeIndex) => {
                const progress = (spikeIndex + 0.5) / spikeCount;
                return (
                  <View
                    key={`moving-line-${index}-spike-${spikeIndex}`}
                    style={[
                      styles.spike,
                      {
                        borderBottomColor: colors.stoneHighlight,
                        left: line.x1 + (line.x2 - line.x1) * progress - 5,
                        top: line.y1 + (line.y2 - line.y1) * progress - 9,
                        transform: [{ rotate: `${angle}rad` }],
                      },
                    ]}
                  />
                );
              })}
            </React.Fragment>
          );
        })}

        {bouncyBarriers.map((line, index) => {
          const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
          return (
            <React.Fragment key={`bouncy-line-${index}`}>
              <View
                style={[
                  styles.obstacle,
                  styles.bouncyObstacle,
                  {
                    backgroundColor: colors.goal,
                    borderColor: colors.stoneHighlight,
                    width: length,
                    left: line.x1,
                    top: line.y1 - 4,
                    transform: [{ rotate: `${angle}rad` }],
                  },
                ]}
              />
              <Feather
                name="chevrons-left"
                size={16}
                color={colors.gameBackground}
                style={{ position: 'absolute', left: line.x1 + length / 2 - 8, top: line.y1 - 8, transform: [{ rotate: `${angle}rad` }] }}
              />
            </React.Fragment>
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
            <View
              pointerEvents="none"
              style={[
                styles.powerGauge,
                {
                  left: clamp(launchPoint.x + 24, 12, board.width - 72),
                  top: clamp(launchPoint.y - 72, 18, board.height - 92),
                  backgroundColor: `${colors.gameSurfaceRaised}F2`,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.powerGaugeHeader}>
                <Feather name="zap" size={12} color={stoneColor} />
                <Text style={[styles.powerGaugeLabel, { color: colors.mutedForeground }]}>{t('power')}</Text>
              </View>
              <View style={styles.powerSegments}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <View
                    key={`power-segment-${index}`}
                    style={[
                      styles.powerSegment,
                      { backgroundColor: progress >= (index + 1) / 5 ? stoneColor : colors.border },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.powerValue, { color: stoneColor }]}>{Math.round(progress * 100)}</Text>
            </View>
            {showHelp && (
              <View style={[styles.helpBubble, { backgroundColor: colors.gameSurfaceRaised }]}>
                <Feather name="move" size={16} color={colors.stoneHighlight} />
                <Text style={[styles.helpText, { color: colors.ink }]}>{t('help')}</Text>
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
                      backgroundColor: stoneColor,
                      left: AIM_PAD_SIZE / 2 - 16 + joystick.x,
                      top: AIM_PAD_SIZE / 2 - 16 + joystick.y,
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Feather name="crosshair" size={15} color={colors.gameBackground} />
                </View>
                <Text style={[styles.aimPadLabel, { color: colors.mutedForeground }]} pointerEvents="none">{t('direction')}</Text>
              </View>
            )}
          </>
        )}

        <Animated.View
          style={[
            styles.stone,
            { left: stone.x - STONE_RADIUS, top: stone.y - STONE_RADIUS, backgroundColor: stoneColor, transform: [{ scale: pulse }] },
          ]}
        />

        {burstPoint && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.burst,
              { left: burstPoint.x, top: burstPoint.y, opacity: burstOpacity, transform: [{ scale: burstScale }] },
            ]}
          >
            {[
              [-24, -10, 10], [-12, -25, 8], [5, -28, 12], [22, -12, 9],
              [25, 8, 11], [10, 23, 8], [-10, 25, 12], [-27, 10, 8],
            ].map(([left, top, size], index) => (
              <View
                key={`burst-bubble-${index}`}
                style={[
                  styles.burstBubble,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    left,
                    top,
                    borderColor: colors.stoneHighlight,
                    backgroundColor: `${colors.obstacle}CC`,
                  },
                ]}
              />
            ))}
          </Animated.View>
        )}

        {flash && <View style={[styles.flash, { backgroundColor: colors.obstacle }]} />}

        {phase === 'hit' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.obstacle}22` }]}>
              <Feather name="rotate-ccw" size={20} color={colors.obstacle} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('hitTitle')}</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>{t('hitCopy')}</Text>
            <Text style={[styles.livesMessage, { color: colors.stoneHighlight }]}>{formatCopy('livesLeft', { count: String(lives) })}</Text>
            <Pressable
              testID="retry-button"
              onPress={retry}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.stone, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="rotate-cw" size={16} color={colors.gameBackground} />
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('retry')}</Text>
            </Pressable>
          </View>
        )}

        {phase === 'demoted' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.stoneHighlight}22` }]}>
              <Feather name="corner-left-up" size={20} color={colors.stoneHighlight} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('demotedTitle')}</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>
              {formatCopy('demotedCopy', { level: formatLevel(level) })}
            </Text>
            <Pressable
              onPress={continueAfterDemotion}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.stone, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('continue')}</Text>
              <Feather name="arrow-right" size={17} color={colors.gameBackground} />
            </Pressable>
          </View>
        )}

        {phase === 'gameover' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.obstacle}22` }]}>
              <Feather name="rotate-ccw" size={20} color={colors.obstacle} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('gameOverTitle')}</Text>
            <Text style={[styles.scoreText, { color: colors.goal }]}>{runScore} {t('score')}</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>
              {t('gameOverCopy')}
            </Text>
            <Pressable
              onPress={restartRun}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="refresh-cw" size={16} color={colors.gameBackground} />
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('restart')}</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/leaderboard')} style={styles.secondaryAction}>
              <Text style={[styles.secondaryActionText, { color: colors.mutedForeground }]}>{t('leaderboard')}</Text>
            </Pressable>
          </View>
        )}

        {phase === 'complete' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.goal}22` }]}>
              <Feather name="check" size={21} color={colors.goal} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('successTitle')}</Text>
            <View style={styles.starsRow}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Feather
                  key={`star-${index}`}
                  name="star"
                  size={22}
                  color={index < (completion?.stars ?? 0) ? colors.stoneHighlight : colors.border}
                  fill={index < (completion?.stars ?? 0) ? colors.stoneHighlight : 'transparent'}
                />
              ))}
            </View>
            <Text style={[styles.medalText, { color: colors.stoneHighlight }]}>{completion?.medal ?? t('completed')}</Text>
            <Text style={[styles.scoreText, { color: colors.goal }]}>{completion?.score ?? 0} {t('score')}</Text>
            {(completion?.riskBonus ?? 0) > 0 && (
              <Text style={[styles.riskText, { color: colors.stoneHighlight }]}>+{completion?.riskBonus} risk bonusu</Text>
            )}
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>{formatCopy('nextCopy', { chapter: chapterForLevel(level + 1) })}</Text>
            <Pressable
              testID="next-level-button"
              onPress={nextLevel}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('next')}</Text>
              <Feather name="arrow-right" size={17} color={colors.gameBackground} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.legend}>
          <Feather name="minus" size={14} color={colors.obstacle} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('obstacle')}</Text>
          <Feather name="flag" size={12} color={colors.goal} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('goal')}</Text>
          {movingBars.length > 0 && (
            <>
              <Feather name="move" size={12} color={colors.stone} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('movingObstacle')}</Text>
            </>
          )}
          {portals.length > 0 && (
            <>
              <Feather name="corner-up-left" size={12} color={colors.stoneHighlight} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('portal')}</Text>
            </>
          )}
        </View>
        {unlockedSkins.length > 1 && (
          <Pressable onPress={cycleSkin} style={styles.skinButton} accessibilityRole="button">
            <Feather name="droplet" size={12} color={stoneColor} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('style')}</Text>
          </Pressable>
        )}
        <Text style={[styles.footerHint, { color: colors.mutedForeground }]}>
          {t('daily')} {dailyProgress}/3 · {portals.length > 0 ? t('portal') : movingBars.length > 0 ? t('movingObstacle') : t('drag')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17253A' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandMark: { width: 8, height: 8, borderRadius: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 2.1, fontWeight: '800' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 5 },
  levelPill: { borderRadius: 14, minWidth: 68, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2A3B50' },
  levelLabel: { fontSize: 9, letterSpacing: 1.3, fontWeight: '700' },
  levelValue: { fontSize: 21, fontWeight: '800', marginTop: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingBottom: 11 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12, fontWeight: '600' },
  livesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 },
  livesLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  hearts: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  livesCount: { fontSize: 10, fontWeight: '800' },
  statusHint: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  tip: { flex: 1, textAlign: 'right', fontSize: 11 },
  chapterProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10 },
  chapterProgressLabel: { fontSize: 10, fontWeight: '800', minWidth: 84 },
  chapterProgressTrack: { flex: 1, height: 4, borderRadius: 4, overflow: 'hidden' },
  chapterProgressFill: { height: '100%', borderRadius: 4 },
  chapterProgressCount: { fontSize: 9, fontWeight: '700' },
  board: { flex: 1, minHeight: 460, borderRadius: 18, borderWidth: 1, overflow: 'hidden', position: 'relative', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  chapterIntro: { position: 'absolute', zIndex: 20, top: '40%', alignSelf: 'center', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 24, borderRadius: 16, backgroundColor: '#17253AE8' },
  chapterKicker: { fontSize: 9, fontWeight: '800', letterSpacing: 2, marginTop: 8 },
  chapterTitle: { fontSize: 23, fontWeight: '800', marginTop: 5 },
  chapterNumber: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 5 },
  goal: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  goalText: { position: 'absolute', fontSize: 9, letterSpacing: 1.1, fontWeight: '800' },
  obstacle: { height: 5, position: 'absolute', borderRadius: 3, transformOrigin: 'left center' },
  movingObstacle: { height: 7, borderWidth: 1 },
  bouncyObstacle: { height: 9, borderWidth: 2, borderRadius: 5 },
  spike: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', position: 'absolute' },
  stone: { width: STONE_RADIUS * 2, height: STONE_RADIUS * 2, borderRadius: STONE_RADIUS, position: 'absolute', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  trail: { height: 2, position: 'absolute', borderRadius: 2, transformOrigin: 'left center' },
  burst: { position: 'absolute', width: 1, height: 1, zIndex: 10 },
  burstBubble: { position: 'absolute', borderWidth: 2 },
  hole: { width: HOLE_RADIUS * 2, height: HOLE_RADIUS * 2, position: 'absolute', borderRadius: HOLE_RADIUS, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  holeLabel: { position: 'absolute', top: 1, right: 5, fontSize: 8, fontWeight: '700' },
  aimGuide: { height: 2, position: 'absolute', transformOrigin: 'left center', borderRadius: 2 },
  aimPad: { width: AIM_PAD_SIZE, height: AIM_PAD_SIZE, position: 'absolute', borderRadius: AIM_PAD_SIZE / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  aimPadRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 1, opacity: 0.45 },
  aimKnob: { width: 32, height: 32, borderRadius: 16, position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  aimPadLabel: { position: 'absolute', bottom: 7, fontSize: 8, letterSpacing: 1.2, fontWeight: '700' },
  powerGauge: { position: 'absolute', width: 48, height: 72, borderRadius: 14, borderWidth: 1, alignItems: 'center', paddingTop: 8, zIndex: 8 },
  powerGaugeHeader: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  powerGaugeLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  powerSegments: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 27, marginTop: 6 },
  powerSegment: { width: 5, height: 20, borderRadius: 3 },
  powerValue: { fontSize: 10, fontWeight: '800', marginTop: 4 },
  helpBubble: { position: 'absolute', top: '47%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  helpText: { fontSize: 12, fontWeight: '600' },
  flash: { ...StyleSheet.absoluteFill, opacity: 0.08 },
  resultCard: { position: 'absolute', left: 22, right: 22, top: '35%', borderRadius: 20, padding: 19, alignItems: 'center' },
  resultIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  resultTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  starsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  medalText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 7, textTransform: 'uppercase' },
  scoreText: { fontSize: 17, fontWeight: '800', marginTop: 8 },
  riskText: { fontSize: 11, fontWeight: '800', marginTop: 3 },
  resultCopy: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6, maxWidth: 235 },
  livesMessage: { fontSize: 11, fontWeight: '800', marginTop: 10 },
  secondaryAction: { paddingVertical: 9, paddingHorizontal: 14, marginTop: 4 },
  secondaryActionText: { fontSize: 11, fontWeight: '700' },
  resultButton: { marginTop: 16, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultButtonText: { fontSize: 13, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 11, paddingBottom: 10 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  skinButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  legendText: { fontSize: 10, fontWeight: '600' },
  footerHint: { fontSize: 10, textAlign: 'right', flexShrink: 1, marginLeft: 10 },
});