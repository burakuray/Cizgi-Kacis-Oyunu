import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import { BoardArt, LegendGlyph, StoneSprite } from '@/components/BoardArt';
import { StoryCard } from '@/components/StoryCard';
import { type CopyKey, L, formatCopy, pickWord, skinName, t } from '@/lib/i18n';
import {
  DAILY_BONUS_INK,
  DAILY_TARGET,
  type ClearResult,
  type Progress,
  REVIVE_COST,
  type Skin,
  applyClear,
  applySurpriseClear,
  dailyFor,
  defaultProgress,
  hasSeenStory,
  localDate,
  markStorySeen,
  nextSkinGoal,
  selectSkin,
  setCurrentLevel,
  skinColor,
  spendInk,
  surpriseAvailable,
  totalStars,
  touchDay,
} from '@/lib/progress';
import { type Palette, STONE_BOX } from '@/lib/boardArt';
import { loadProgress, saveProgress } from '@/lib/progressStore';
import { syncScore } from '@/lib/leaderboardSync';
import {
  type DailyRule,
  FAIL_STREAK_FOR_ASSIST,
  INK_MAX,
  PERFECT_STREAK_FOR_BONUS,
  type Stain,
  activeInkLines,
  applyHazardForces,
  compressTrail,
  dailyRuleFor,
  erasedFlags,
  eraserConfig,
  eraserHitsStone,
  eraserRect,
  flipHazards,
  flipSegment,
  flipX,
  frictionFor,
  hashString,
  isNearMiss,
  makeHazards,
  makeStain,
  pencilBars,
  planInkLine,
  predictPath,
  reflectFromSegments,
  refillInk,
  resolveTear,
  solidPencilSegments,
  surpriseLevelFor,
  type InkLine,
} from '@/lib/mechanics';
import { type Chapter, chapterById, chapterForLevel, levelsUntilChapterEnd } from '@/lib/story';
import { playSound, setSoundEnabled } from '@/lib/sound';
import {
  STONE_RADIUS,
  bounceFromBarriers,
  type LifeLossResult,
  clamp,
  distanceToSegment,
  type LevelKind,
  getDifficultyProfile,
  levelKind,
  makeCourse,
  makeBouncyBarriers,
  makeMovingBars,
  makePortals,
  renderedMovingBars,
  resolveLifeLoss,
  resolvePortalStep,
} from '@/game-logic';

type Point = { x: number; y: number };
type Phase = 'aiming' | 'moving' | 'hit' | 'complete' | 'demoted' | 'gameover' | 'revive';
type Completion = ClearResult & { medal: string; riskBonus: number };
type StoryState = { kind: 'open' | 'end'; chapter: Chapter };
type PlayMode = { kind: 'surprise' | 'bonus'; rule: DailyRule; level: number };
type Callout = { id: number; text: string; x: number; y: number; color: string };

const SOUND_ENABLED_KEY = '@cizgi-kacis/sound-enabled';
const LEVEL_LIVES = 3;
const MAX_DRAG = 94;
const MIN_DRAG = 16;
const AIM_PAD_SIZE = 96;
const AIM_PAD_RADIUS = 38;

function formatLevel(level: number) {
  return String(level).padStart(2, '0');
}

function skinNudge(goal: { skin: Skin; current: number; target: number }) {
  const name = skinName(goal.skin.id);
  const count = String(goal.target - goal.current);
  const requirement = goal.skin.requirement;
  if (requirement.type === 'stars') return formatCopy('nudgeStars', { name, count });
  if (requirement.type === 'perfect') return formatCopy('nudgePerfect', { name, count });
  if (requirement.type === 'dayStreak') return formatCopy('nudgeDays', { name, count });
  if (requirement.type === 'chapter') {
    const chapter = chapterById(requirement.chapterId);
    return formatCopy('nudgeChapter', { name, chapter: chapter ? L(chapter.name) : '' });
  }
  return null;
}

/** After two failed shots on the same level, rotate through tips that match what is on screen. */
function failureHint(level: number, failures: number): string | null {
  if (failures < 2) return null;
  const profile = getDifficultyProfile(level);
  const keys: CopyKey[] = ['hintGeneric'];
  if (profile.movingBarCount > 0) keys.push('hintMoving');
  if (profile.portalPairCount > 0) keys.push('hintPortal');
  if (profile.bouncyBarrierCount > 0) keys.push('hintBouncy');
  return t(keys[(failures - 2) % keys.length]);
}

export default function GameScreen() {
  const colors = useColors();
  const goalColor = colors.goal;
  const obstacleColor = colors.obstacle;
  const router = useRouter();
  const { level: routeLevel, t: routeStamp, surprise: routeSurprise } = useLocalSearchParams<{ level?: string; t?: string; surprise?: string }>();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState({ width: Dimensions.get('window').width - 32, height: 480 });
  const [level, setLevel] = useState(1);
  const [runScore, setRunScore] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [, setAttempts] = useState(0);
  const [levelAttempts, setLevelAttempts] = useState(0);
  const [lives, setLives] = useState(LEVEL_LIVES);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [riskBonus, setRiskBonus] = useState(0);
  const [progress, setProgress] = useState<Progress>(defaultProgress);
  const [loaded, setLoaded] = useState(false);
  const [storyCard, setStoryCard] = useState<StoryState | null>(null);
  const [welcome, setWelcome] = useState<{ streak: number; broken: boolean } | null>(null);
  const [ghost, setGhost] = useState<Point[]>([]);
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
  const [showIntro, setShowIntro] = useState(false);
  const [mode, setMode] = useState<PlayMode | null>(null);
  const [reveal, setReveal] = useState(1);
  const [stains, setStains] = useState<Stain[]>([]);
  const [brokenTears, setBrokenTears] = useState<ReadonlySet<string>>(new Set());
  const [inkPool, setInkPool] = useState(INK_MAX);
  const [inkPreview, setInkPreview] = useState<{ from: Point; to: Point } | null>(null);
  const [drawnOnce, setDrawnOnce] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [assist, setAssist] = useState(false);
  const [bonusOffer, setBonusOffer] = useState(false);
  const [worldRank, setWorldRank] = useState<{ rank: number; total: number; climbed: number } | null>(null);
  const [rankInvite, setRankInvite] = useState(false);
  const [surpriseResult, setSurpriseResult] = useState<{ kind: 'surprise' | 'bonus'; ink: number } | null>(null);
  const progressRef = useRef<Progress>(progress);
  const pendingLossRef = useRef<LifeLossResult | null>(null);
  const trailRef = useRef<Point[]>([]);
  const appliedRouteRef = useRef<string | null>(null);
  const modeRef = useRef<PlayMode | null>(null);
  const startModeRef = useRef<((kind: 'surprise' | 'bonus', returnTo?: number) => void) | null>(null);
  const savedLevelRef = useRef(1);
  const inkPoolRef = useRef(INK_MAX);
  const inkLinesRef = useRef<InkLine[]>([]);
  const inkDrawRef = useRef<{ from: Point; to: Point } | null>(null);
  const inkUsedRef = useRef(false);
  const brokenTearsRef = useRef<ReadonlySet<string>>(new Set());
  const fullTrailRef = useRef<Point[]>([]);
  const slowUntilRef = useRef(0);
  const lastNearMissRef = useRef(0);
  const failStreakRef = useRef(0);
  const perfectStreakRef = useRef(0);
  const stainCountRef = useRef(0);
  const syncTokenRef = useRef(0);
  const calloutIdRef = useRef(0);
  const calloutAnim = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
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

  const commit = useCallback((next: Progress) => {
    progressRef.current = next;
    setProgress(next);
    void saveProgress(next);
  }, []);

  const rule: DailyRule | null = mode?.rule ?? null;
  const mirror = rule === 'mirror';
  const course = useMemo(() => {
    const base = makeCourse(level, board.width, board.height);
    return mirror ? base.map((segment) => flipSegment(board.width, segment)) : base;
  }, [level, board.height, board.width, mirror]);
  const bouncyBarriers = useMemo(() => {
    const base = makeBouncyBarriers(level, board.width, board.height);
    return mirror ? base.map((segment) => flipSegment(board.width, segment)) : base;
  }, [level, board.height, board.width, mirror]);
  const movingBarBlueprints = useMemo(() => {
    const base = makeMovingBars(level, board.width, board.height);
    return mirror ? base.map((bar) => ({ ...bar, segment: flipSegment(board.width, bar.segment) })) : base;
  }, [level, board.height, board.width, mirror]);
  const movingBars = useMemo(
    () => renderedMovingBars(movingBarBlueprints, motionTime),
    [movingBarBlueprints, motionTime],
  );
  const portals = useMemo(() => {
    const base = makePortals(level, board.width, board.height);
    return mirror ? base.map((pair) => ({ ...pair, a: flipX(board.width, pair.a), b: flipX(board.width, pair.b) })) : base;
  }, [level, board.height, board.width, mirror]);
  const hazards = useMemo(() => {
    const base = makeHazards(level, board.width, board.height);
    return mirror ? flipHazards(board.width, base) : base;
  }, [level, board.height, board.width, mirror]);
  const eraserCfg = useMemo(() => eraserConfig(level, board.width, board.height), [level, board.height, board.width]);
  const playKind = levelKind(level);
  const relaxPage = playKind === 'relax' || mode !== null;
  const origin = useMemo(() => ({ x: board.width / 2, y: board.height - 57 }), [board.width, board.height]);
  const goal = useMemo(() => ({ x: board.width / 2, y: 51 }), [board.width]);
  const [launchPoint, setLaunchPoint] = useState<Point>(origin);
  const launchPointRef = useRef(launchPoint);

  const chapter = chapterForLevel(level);
  const chapterTitle = L(chapter.name);

  useEffect(() => {
    if (!loaded) return;
    const stamp = `${routeLevel ?? ''}:${routeStamp ?? ''}:${routeSurprise ?? ''}`;
    if (appliedRouteRef.current === stamp) return;
    appliedRouteRef.current = stamp;
    if (routeSurprise === '1') {
      startModeRef.current?.('surprise');
      return;
    }
    const requestedLevel = Number(routeLevel);
    if (Number.isInteger(requestedLevel) && requestedLevel > 0 && requestedLevel <= progressRef.current.bestLevel) {
      if (modeRef.current) {
        setMode(null);
        setSurpriseResult(null);
      }
      setBonusOffer(false);
      setLevel(requestedLevel);
      setLives(LEVEL_LIVES);
      setLevelAttempts(0);
      setCompletion(null);
      setGhost([]);
      commit(setCurrentLevel(progressRef.current, requestedLevel));
    }
  }, [commit, loaded, routeLevel, routeStamp, routeSurprise]);

  useEffect(() => {
    if (!loaded) return;
    setStains([]);
    setCallout(null);
    const current = chapterForLevel(level);
    if (!mode && level === current.start && !hasSeenStory(progressRef.current, 'open', current.id)) {
      setShowIntro(false);
      setReveal(1);
      setStoryCard({ kind: 'open', chapter: current });
      return;
    }
    // "The Artist draws the page": the pencil sketches the level before Dot wakes up.
    setShowIntro(true);
    setReveal(0);
    introOpacity.setValue(0);
    introScale.setValue(0.94);
    Animated.parallel([
      Animated.timing(introOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(introScale, { toValue: 1, damping: 14, stiffness: 180, useNativeDriver: true }),
    ]).start();
    const startedAt = Date.now();
    let frame = 0;
    const stepReveal = () => {
      const p = Math.min(1, (Date.now() - startedAt) / 1300);
      setReveal(p);
      if (p < 1) frame = requestAnimationFrame(stepReveal);
    };
    frame = requestAnimationFrame(stepReveal);
    const timer = setTimeout(() => setShowIntro(false), 1400);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      setReveal(1);
    };
  }, [introOpacity, introScale, level, loaded, mode]);

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
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    launchPointRef.current = launchPoint;
  }, [launchPoint]);

  useEffect(() => {
    trailRef.current = trail;
  }, [trail]);

  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => setWelcome(null), 3600);
    return () => clearTimeout(timer);
  }, [welcome]);

  useEffect(() => {
    let active = true;
    Promise.all([loadProgress(), AsyncStorage.getItem(SOUND_ENABLED_KEY)]).then(([stored, storedSound]) => {
      if (!active) return;
      const enabled = storedSound !== 'false';
      setSoundEnabledState(enabled);
      setSoundEnabled(enabled);
      const touched = touchDay(stored, localDate());
      commit(touched.progress);
      void syncScore(touched.progress); // silently uploads the total if a ranking account exists
      if (!Number.isInteger(Number(routeLevel)) || Number(routeLevel) < 1) {
        setLevel(touched.progress.currentLevel);
      }
      if (touched.firstVisitToday && stored.lastPlayedDate !== null) {
        setWelcome({ streak: touched.progress.dayStreak, broken: touched.streakBroken });
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Every attempt starts the hazard clocks and the ink pool from zero, so rhythms are learnable.
    motionTimeRef.current = 0;
    setMotionTime(0);
    inkPoolRef.current = INK_MAX;
    setInkPool(INK_MAX);
    inkLinesRef.current = [];
    inkUsedRef.current = false;
    inkDrawRef.current = null;
    setInkPreview(null);
    brokenTearsRef.current = new Set();
    setBrokenTears(brokenTearsRef.current);
    fullTrailRef.current = [];
    slowUntilRef.current = 0;
  }, [board.height, board.width, origin]);

  const showCallout = useCallback((text: string, at: Point, color: string) => {
    calloutIdRef.current += 1;
    setCallout({ id: calloutIdRef.current, text, x: clamp(at.x, 70, board.width - 70), y: clamp(at.y - 34, 46, board.height - 70), color });
    calloutAnim.setValue(0);
    Animated.sequence([
      Animated.spring(calloutAnim, { toValue: 1, damping: 9, stiffness: 260, useNativeDriver: true }),
      Animated.delay(520),
      Animated.timing(calloutAnim, { toValue: 2, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [board.height, board.width, calloutAnim]);

  const shakeBoard = useCallback((strength = 5) => {
    shake.setValue(0);
    Animated.sequence([-1, 1, -0.7, 0.5, 0].map((m) => Animated.timing(shake, { toValue: m * strength, duration: 38, useNativeDriver: true }))).start();
  }, [shake]);

  const setGamePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const applyLoss = useCallback((loss: LifeLossResult) => {
    setLives(loss.lives);
    if (loss.outcome === 'demoted') {
      setLevel(loss.level);
      setLevelAttempts(0);
      setGhost([]);
      resetStone();
      commit(setCurrentLevel(progressRef.current, loss.level));
      setGamePhase('demoted');
    } else {
      setGamePhase('gameover');
    }
  }, [commit, resetStone, setGamePhase]);

  const finishAttempt = useCallback(async (success: boolean, impactPoint?: Point) => {
    const relax = levelKind(level) === 'relax' || modeRef.current !== null;
    setFlash(true);
    if (!success) {
      const at = impactPoint ?? stoneRef.current;
      void playSound('hit');
      setBurstPoint(at);
      burstScale.setValue(0.35);
      burstOpacity.setValue(1);
      Animated.parallel([
        Animated.timing(burstScale, { toValue: 1.5, duration: 360, useNativeDriver: true }),
        Animated.timing(burstOpacity, { toValue: 0, duration: 360, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setBurstPoint(null);
      });
      shakeBoard(6);
      stainCountRef.current += 1;
      setStains((current) => [...current.slice(-5), makeStain(at, stainCountRef.current)]);
      showCallout(pickWord('onoHit', stainCountRef.current + level), at, obstacleColor);
      // Hit-stop: hold the impact frame for a moment before the result appears.
      await new Promise((resolve) => setTimeout(resolve, 80));
      setGamePhase('hit');
    } else {
      setGamePhase('complete');
    }
    await Haptics.notificationAsync(
      success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
    if (!success) {
      failStreakRef.current += 1;
      perfectStreakRef.current = 0;
      if (failStreakRef.current >= FAIL_STREAK_FOR_ASSIST) setAssist(true);
      const lifeLoss = resolveLifeLoss(level, lives, LEVEL_LIVES);
      setAttempts((current) => current + 1);
      setLevelAttempts(levelAttempts + 1);
      setGhost(trailRef.current);
      if (relax || lifeLoss.outcome === 'retry') {
        if (!relax) setLives(lifeLoss.lives);
        resetStone();
      } else if (progressRef.current.ink >= REVIVE_COST) {
        // Instead of punishing the player right away, offer to spend ink for one more life.
        pendingLossRef.current = lifeLoss;
        setLives(0);
        setGamePhase('revive');
      } else {
        applyLoss(lifeLoss);
      }
    } else {
      void playSound('success');
      failStreakRef.current = 0;
      setAssist(false);
      showCallout(pickWord('onoGoal', level), goal, goalColor);
      const playing = modeRef.current;
      if (playing) {
        const outcome = applySurpriseClear(progressRef.current, playing.kind, localDate());
        commit(outcome.progress);
        setSurpriseResult({ kind: playing.kind, ink: outcome.inkEarned });
      } else {
        const { progress: nextProgress, result } = applyClear(progressRef.current, {
          level,
          failedAttempts: relax ? Math.min(levelAttempts, 2) : levelAttempts,
          riskBonus: riskBonusRef.current,
          today: localDate(),
          pure: !inkUsedRef.current,
          trail: compressTrail(fullTrailRef.current, board.width, board.height),
        });
        const medal = result.stars === 3 ? t('medalPerfect') : result.stars === 2 ? t('medalClean') : t('medalDone');
        setRunScore((current) => current + result.score);
        setCompletion({ ...result, medal, riskBonus: riskBonusRef.current });
        setGhost([]);
        commit(nextProgress);
        // Upload the new total and show the player where they stand. A late answer for an older level is ignored.
        syncTokenRef.current += 1;
        const token = syncTokenRef.current;
        setWorldRank(null);
        setRankInvite(false);
        void syncScore(nextProgress).then((outcome) => {
          if (token !== syncTokenRef.current) return;
          if (outcome.status === 'ok') {
            setWorldRank({
              rank: outcome.result.rank,
              total: outcome.result.total,
              climbed: outcome.previousRank !== null ? Math.max(0, outcome.previousRank - outcome.result.rank) : 0,
            });
          } else if (outcome.status === 'no-account') {
            setRankInvite(true);
          }
        });
        if (result.stars === 3) {
          perfectStreakRef.current += 1;
          if (perfectStreakRef.current >= PERFECT_STREAK_FOR_BONUS && !result.chapterCompleted) {
            perfectStreakRef.current = 0;
            setBonusOffer(true);
          }
        } else {
          perfectStreakRef.current = 0;
        }
      }
    }
    setTimeout(() => setFlash(false), 260);
  }, [applyLoss, board.height, board.width, burstOpacity, burstScale, commit, goal, goalColor, level, levelAttempts, lives, obstacleColor, resetStone, setGamePhase, shakeBoard, showCallout]);

  useEffect(() => {
    if (phase !== 'moving') {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      return;
    }

    const baseFriction = frictionFor(modeRef.current?.rule ?? null, board.height);
    let previous = Date.now();
    const tick = () => {
      const now = Date.now();
      const slow = now < slowUntilRef.current ? 0.35 : 1; // near-miss slow motion slows the world, not just the stone
      const rawMs = Math.min(34, now - previous);
      previous = now;
      const delta = (rawMs / 16.67) * slow;
      const elapsed = motionTimeRef.current + (rawMs / 1000) * slow;
      motionTimeRef.current = elapsed;
      setMotionTime(elapsed);
      inkPoolRef.current = refillInk(inkPoolRef.current, (rawMs / 1000) * slow);
      setInkPool(Math.round(inkPoolRef.current));

      const current = stoneRef.current;
      const rawNext = {
        x: current.x + velocityRef.current.x * delta,
        y: current.y + velocityRef.current.y * delta,
      };
      const friction = Math.pow(baseFriction, delta);
      let nextVelocity = applyHazardForces(
        current,
        { x: velocityRef.current.x * friction, y: velocityRef.current.y * friction },
        hazards,
        delta,
      );
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

      // What is solid right now: the Eraser rubs bars out, the pencil sketches new ones, moving bars swing.
      const activeMovingBars = renderedMovingBars(movingBarBlueprints, elapsed);
      const erased = eraserCfg ? erasedFlags(eraserCfg, elapsed, course) : null;
      const standingCourse = erased ? course.filter((_, index) => !erased[index]) : course;
      const pencilNow = solidPencilSegments(pencilBars(level, board.width, board.height, elapsed));
      const inkSegments = activeInkLines(inkLinesRef.current, elapsed).map((line) => line.segment);
      const solid = [...standingCourse, ...bouncyBarriers, ...activeMovingBars, ...pencilNow];

      const advance = (bounced: Point, velocity: Point) => {
        // A bounce can push the stone a few pixels past the edge of the page; keep it inside.
        const point = { x: clamp(bounced.x, STONE_RADIUS, board.width - STONE_RADIUS), y: clamp(bounced.y, STONE_RADIUS, board.height - STONE_RADIUS) };
        stoneRef.current = point;
        velocityRef.current = velocity;
        setVelocity(velocity);
        setStone(point);
        if (fullTrailRef.current.length < 600) fullTrailRef.current.push(point);
        setTrail((currentTrail) => [...currentTrail.slice(-17), point]);
        void playSound('portal');
        frameRef.current = requestAnimationFrame(tick);
      };

      // Springs: lines the player drew, bouncers, and slow hits on a tear-sheet bar.
      const inkBounce = reflectFromSegments(next, nextVelocity, inkSegments);
      if (inkBounce.bounced) {
        advance(inkBounce.point, inkBounce.velocity);
        return;
      }
      const bounce = bounceFromBarriers(next, nextVelocity, bouncyBarriers);
      if (bounce.bounced) {
        advance(bounce.point, bounce.velocity);
        return;
      }
      const tear = resolveTear(next, nextVelocity, hazards.tears, brokenTearsRef.current);
      if (tear.kind === 'bounce') {
        advance(tear.point, tear.velocity);
        return;
      }
      if (tear.kind === 'tear') {
        brokenTearsRef.current = new Set(brokenTearsRef.current).add(tear.id);
        setBrokenTears(brokenTearsRef.current);
        nextVelocity = tear.velocity;
        velocityRef.current = nextVelocity;
        showCallout('RIIIP!', next, '#E9E4D6');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const nearestObstacle = solid.reduce(
        (nearest, segment) => Math.min(nearest, distanceToSegment(next, segment)),
        Number.POSITIVE_INFINITY,
      );
      const currentRiskBonus = Math.max(0, Math.round((48 - nearestObstacle) * 4));
      if (currentRiskBonus > riskBonusRef.current) {
        riskBonusRef.current = currentRiskBonus;
        setRiskBonus(currentRiskBonus);
      }
      // Close call: grazing a barrier at speed slows time for a beat and cheers.
      if (isNearMiss(nearestObstacle, Math.hypot(nextVelocity.x, nextVelocity.y)) && now - lastNearMissRef.current > 900) {
        lastNearMissRef.current = now;
        slowUntilRef.current = now + 380;
        showCallout(t('nearMiss'), next, goalColor);
        void Haptics.selectionAsync();
      }

      const portalStep = resolvePortalStep(next, portals, portalLockRef.current, solid);
      const eraserHit = eraserCfg ? eraserHitsStone(eraserRect(eraserCfg, elapsed), next) : false;
      const collided = portalStep.collided || eraserHit;
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
      if (fullTrailRef.current.length < 600) fullTrailRef.current.push(next);
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
  }, [board.height, board.width, bouncyBarriers, course, eraserCfg, finishAttempt, goal, goalColor, hazards, level, movingBarBlueprints, phase, portals, showCallout]);

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
    // Every new shot gets a fresh drop of ink for one short correction.
    inkPoolRef.current = INK_MAX;
    setInkPool(INK_MAX);
    if (fullTrailRef.current.length === 0) fullTrailRef.current = [start];
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

  const finalizeInk = useCallback(() => {
    const drawing = inkDrawRef.current;
    inkDrawRef.current = null;
    setInkPreview(null);
    if (!drawing || phaseRef.current !== 'moving') return;
    const plan = planInkLine(drawing.from, drawing.to, inkPoolRef.current);
    if (!plan) return;
    inkPoolRef.current -= plan.cost;
    setInkPool(Math.round(inkPoolRef.current));
    inkLinesRef.current = [...activeInkLines(inkLinesRef.current, motionTimeRef.current), { segment: plan.segment, born: motionTimeRef.current }];
    inkUsedRef.current = true;
    setDrawnOnce(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => (phaseRef.current === 'aiming' || phaseRef.current === 'moving') && !showIntro && !storyCard,
    onMoveShouldSetPanResponder: () => (phaseRef.current === 'aiming' || phaseRef.current === 'moving') && !showIntro && !storyCard,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      if (phaseRef.current === 'aiming') {
        startAim(locationX, locationY);
      } else if (phaseRef.current === 'moving') {
        // While the stone flies, a finger drag draws a short ink line that bounces it.
        inkDrawRef.current = { from: { x: locationX, y: locationY }, to: { x: locationX, y: locationY } };
      }
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      if (phaseRef.current === 'aiming') {
        updateJoystick(locationX, locationY);
      } else if (phaseRef.current === 'moving' && inkDrawRef.current) {
        inkDrawRef.current = { from: inkDrawRef.current.from, to: { x: locationX, y: locationY } };
        setInkPreview(inkDrawRef.current);
      }
    },
    onPanResponderRelease: () => {
      if (phaseRef.current === 'aiming') void launch();
      else finalizeInk();
    },
    onPanResponderTerminate: () => {
      if (phaseRef.current === 'aiming') void launch();
      else finalizeInk();
    },
  }), [finalizeInk, launch, showIntro, startAim, storyCard, updateJoystick]);

  const advanceLevel = useCallback(async () => {
    const next = level + 1;
    setLevel(next);
    setLives(LEVEL_LIVES);
    setLevelAttempts(0);
    setCompletion(null);
    setBonusOffer(false);
    syncTokenRef.current += 1;
    setWorldRank(null);
    setRankInvite(false);
    setGhost([]);
    commit(setCurrentLevel(progressRef.current, next));
    resetStone();
    setGamePhase('aiming');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [commit, level, resetStone, setGamePhase]);

  const nextLevel = useCallback(async () => {
    const finished = completion?.chapterCompleted;
    if (finished?.ending && !hasSeenStory(progressRef.current, 'end', finished.id)) {
      setStoryCard({ kind: 'end', chapter: finished });
      return;
    }
    await advanceLevel();
  }, [advanceLevel, completion]);

  const dismissStory = useCallback(() => {
    if (!storyCard) return;
    commit(markStorySeen(progressRef.current, storyCard.kind, storyCard.chapter.id));
    setStoryCard(null);
    if (storyCard.kind === 'end') void advanceLevel();
  }, [advanceLevel, commit, storyCard]);

  const revive = useCallback(() => {
    const paid = spendInk(progressRef.current, REVIVE_COST);
    if (!paid) return;
    commit(paid);
    pendingLossRef.current = null;
    setLives(1);
    resetStone();
    setGamePhase('aiming');
  }, [commit, resetStone, setGamePhase]);

  const declineRevive = useCallback(() => {
    const loss = pendingLossRef.current;
    pendingLossRef.current = null;
    if (loss) applyLoss(loss);
  }, [applyLoss]);

  const retry = useCallback(() => {
    resetStone();
    setGamePhase('aiming');
  }, [resetStone, setGamePhase]);

  /** Daily surprise page and perfect-streak bonus page: an already-reached level under a special rule. */
  const startMode = useCallback((kind: 'surprise' | 'bonus', returnTo?: number) => {
    const today = localDate();
    const stored = progressRef.current;
    if (kind === 'surprise' && !surpriseAvailable(stored, today)) return;
    const playRule: DailyRule = kind === 'bonus' ? 'slick' : dailyRuleFor(today);
    const playLevel = kind === 'bonus'
      ? Math.max(3, Math.min(stored.bestLevel, 3 + (hashString(`bonus-${stored.ink}-${stored.history.length}`) % 4)))
      : surpriseLevelFor(today, stored.bestLevel);
    if (!modeRef.current) savedLevelRef.current = returnTo ?? stored.currentLevel;
    setBonusOffer(false);
    setCompletion(null);
    setSurpriseResult(null);
    setMode({ kind, rule: playRule, level: playLevel });
    setLevel(playLevel);
    setLives(LEVEL_LIVES);
    setLevelAttempts(0);
    setGhost([]);
    resetStone();
    setGamePhase('aiming');
  }, [resetStone, setGamePhase]);

  useEffect(() => {
    startModeRef.current = startMode;
  }, [startMode]);

  const exitMode = useCallback(() => {
    const back = savedLevelRef.current;
    setMode(null);
    setSurpriseResult(null);
    setLevel(back);
    setLives(LEVEL_LIVES);
    setLevelAttempts(0);
    setGhost([]);
    setCompletion(null);
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
    setMode(null);
    setSurpriseResult(null);
    setBonusOffer(false);
    setGhost([]);
    commit(setCurrentLevel(progressRef.current, 1));
    setShowHelp(true);
    resetStone();
    setGamePhase('aiming');
  }, [commit, resetStone, setGamePhase]);

  const aimProgress = clamp(Math.hypot(aim.x - launchPoint.x, aim.y - launchPoint.y) / MAX_DRAG, 0, 1);
  const boardInsetTop = Math.max(18, insets.top * 0.18);
  const stoneColor = skinColor(progress.selectedSkin);
  const chapterAccent = colors[chapter.accent];
  const chapterLength = chapter.end === null ? null : chapter.end - chapter.start + 1;
  const chapterStep = Math.max(1, level - chapter.start + 1);
  const chapterFill = chapterLength === null ? 1 : Math.min(1, chapterStep / chapterLength);
  const starsCollected = totalStars(progress);
  const daily = dailyFor(progress, localDate());
  const cycleSkin = () => {
    const ids = progress.skins;
    const nextSkin = ids[(ids.indexOf(progress.selectedSkin) + 1) % ids.length] ?? 'coral';
    commit(selectSkin(progressRef.current, nextSkin));
  };
  const toggleSound = () => {
    const nextEnabled = !soundEnabled;
    setSoundEnabledState(nextEnabled);
    setSoundEnabled(nextEnabled);
    void AsyncStorage.setItem(SOUND_ENABLED_KEY, String(nextEnabled));
  };
  const skinGoal = nextSkinGoal(progress);
  const pageLeft = levelsUntilChapterEnd(level);
  const completionNudges: string[] = [];
  if (completion) {
    if (completion.stars < 3) completionNudges.push(formatCopy('moreStars', { count: String(3 - completion.stars) }));
    else if (skinGoal) {
      const nudge = skinNudge(skinGoal);
      if (nudge) completionNudges.push(nudge);
    }
    if (pageLeft === 1) completionNudges.push(t('pageLast'));
    else if (pageLeft !== null && pageLeft > 1) completionNudges.push(formatCopy('pageLeft', { count: String(pageLeft) }));
  }
  const hitHint = failureHint(level, levelAttempts);
  const eraserView = useMemo(
    () => (eraserCfg ? { rect: eraserRect(eraserCfg, motionTime), erased: erasedFlags(eraserCfg, motionTime, course) } : null),
    [course, eraserCfg, motionTime],
  );
  const pencilView = useMemo(() => pencilBars(level, board.width, board.height, motionTime), [board.height, board.width, level, motionTime]);
  const inkLinesView = [
    ...activeInkLines(inkLinesRef.current, motionTime).map((line) => ({ segment: line.segment, age: motionTime - line.born })),
    ...(inkPreview ? (() => {
      const plan = planInkLine(inkPreview.from, inkPreview.to, inkPoolRef.current);
      return plan ? [{ segment: plan.segment, age: 1.2 }] : [];
    })() : []),
  ];
  const hintPath = assist && phase === 'aiming' && Math.hypot(aim.x - launchPoint.x, aim.y - launchPoint.y) > MIN_DRAG
    ? predictPath(launchPoint, aim, [...course, ...bouncyBarriers])
    : [];
  const kindKeys: Partial<Record<LevelKind, CopyKey>> = {
    precision: 'kindPrecision', portals: 'kindPortals', relax: 'kindRelax', pencil: 'kindPencil', eraser: 'kindEraser', boss: 'kindBoss',
  };
  const kindKey = kindKeys[playKind];
  const ruleKeys = { slick: 'ruleSlick', mirror: 'ruleMirror', night: 'ruleNight' } as const;
  const levelLabel = mode
    ? `${t(mode.kind === 'bonus' ? 'bonusBadge' : 'surpriseBadge')} · ${t(ruleKeys[mode.rule])}`
    : kindKey ? `${chapterTitle} · ${t(kindKey)}` : chapterTitle;
  const artPalette: Palette = {
    obstacle: colors.obstacle,
    stone: stoneColor,
    stoneHighlight: colors.stoneHighlight,
    goal: colors.goal,
    gridLine: colors.gridLine,
    surface: colors.gameSurface,
    background: colors.gameBackground,
    border: colors.border,
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
          <Pressable onPress={() => router.push('/map')} style={styles.headerIcon} accessibilityLabel={t('map')}>
            <Feather name="map" size={16} color={colors.ink} />
          </Pressable>
          <Pressable onPress={() => router.push('/journal')} style={styles.headerIcon} accessibilityLabel={t('journal')}>
            <Feather name="book-open" size={16} color={colors.ink} />
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
          <Feather name="droplet" size={14} color={colors.goal} />
          <Text style={[styles.statText, { color: colors.ink }]}>{progress.ink} {t('ink')}</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="zap" size={14} color={colors.stoneHighlight} />
          <Text style={[styles.statText, { color: colors.ink }]}>{progress.dayStreak} {t('dayUnit')}</Text>
        </View>
        <View style={styles.stat}>
          <Feather name="star" size={14} color={colors.stoneHighlight} />
          <Text style={[styles.statText, { color: colors.ink }]}>{starsCollected}</Text>
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
        <View style={styles.dailyChip} accessibilityLabel={formatCopy('dailyProgress', { count: String(daily.clears), target: String(DAILY_TARGET) })}>
          <Text style={[styles.livesLabel, { color: daily.claimed ? colors.goal : colors.mutedForeground }]}>{t('dailyQuest')}</Text>
          {Array.from({ length: DAILY_TARGET }).map((_, index) => (
            <View
              key={`daily-pip-${index}`}
              style={[styles.dailyPip, { backgroundColor: index < daily.clears ? colors.goal : colors.border }]}
            />
          ))}
        </View>
      </View>
      <View style={styles.chapterProgressRow}>
        <Text style={[styles.chapterProgressLabel, { color: chapterAccent }]} numberOfLines={1}>{levelLabel}</Text>
        <View style={[styles.chapterProgressTrack, { backgroundColor: colors.gameSurfaceRaised }]}>
          <View style={[styles.chapterProgressFill, { width: `${Math.round(chapterFill * 100)}%`, backgroundColor: chapterAccent }]} />
        </View>
        <Text style={[styles.chapterProgressCount, { color: colors.mutedForeground }]}>{chapterStep}/{chapterLength ?? '∞'} · {starsCollected} {t('stars')}</Text>
      </View>

      <Animated.View
        style={[styles.board, { backgroundColor: colors.gameSurface, borderColor: chapterAccent, transform: [{ translateX: shake }] }]}
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
        <LinearGradient
          pointerEvents="none"
          colors={[colors.gameSurfaceRaised, colors.gameSurface]}
          style={StyleSheet.absoluteFill}
        />
        <BoardArt
          width={board.width}
          height={board.height}
          palette={artPalette}
          exitLabel={t('exit')}
          course={course}
          bouncy={bouncyBarriers}
          portals={portals}
          movingBlueprints={movingBarBlueprints}
          movingBars={movingBars}
          goal={goal}
          origin={origin}
          stoneColor={stoneColor}
          trail={trail}
          ghost={phase === 'moving' ? [] : ghost}
          aim={phase === 'aiming' ? { from: launchPoint, to: aim } : null}
          hazards={hazards}
          brokenTears={brokenTears}
          eraser={eraserView}
          pencil={pencilView}
          inkLines={inkLinesView}
          stains={stains}
          night={mode?.rule === 'night' ? stone : null}
          hintPath={hintPath}
          reveal={reveal}
        />
        {callout && (
          <Animated.View
            key={callout.id}
            pointerEvents="none"
            style={[
              styles.callout,
              {
                left: callout.x - 70,
                top: callout.y,
                opacity: calloutAnim.interpolate({ inputRange: [0, 0.35, 1, 2], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { scale: calloutAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.12] }) },
                  { rotate: '-7deg' },
                ],
              },
            ]}
          >
            <Text style={[styles.calloutText, { color: callout.color }]}>{callout.text}</Text>
          </Animated.View>
        )}
        {phase === 'moving' && (
          <View pointerEvents="none" style={styles.inkHud}>
            <Text style={[styles.inkHudLabel, { color: colors.mutedForeground }]}>{t('inkMeter')}</Text>
            <View style={[styles.inkTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.inkFill, { width: `${inkPool}%`, backgroundColor: stoneColor }]} />
            </View>
          </View>
        )}
        {phase === 'moving' && level <= 3 && !drawnOnce && !mode && (
          <View pointerEvents="none" style={[styles.hintBanner, { backgroundColor: colors.gameSurfaceRaised, borderColor: colors.border }]}>
            <Feather name="edit-3" size={13} color={colors.stoneHighlight} />
            <Text style={[styles.hintBannerText, { color: colors.ink }]}>{t('drawHint')}</Text>
          </View>
        )}
        {relaxPage && !assist && phase === 'aiming' && levelAttempts === 0 && !mode && (
          <View pointerEvents="none" style={[styles.hintBanner, { backgroundColor: colors.gameSurfaceRaised, borderColor: colors.border }]}>
            <Feather name="coffee" size={13} color={colors.goal} />
            <Text style={[styles.hintBannerText, { color: colors.ink }]}>{t('relaxNote')}</Text>
          </View>
        )}
        {assist && phase === 'aiming' && (
          <View pointerEvents="none" style={[styles.hintBanner, { backgroundColor: colors.gameSurfaceRaised, borderColor: colors.border }]}>
            <Feather name="compass" size={13} color={colors.goal} />
            <Text style={[styles.hintBannerText, { color: colors.ink }]}>{t('assistOn')}</Text>
          </View>
        )}
        {welcome && (
          <View pointerEvents="none" style={[styles.welcome, { backgroundColor: colors.gameSurfaceRaised, borderColor: chapterAccent }]}>
            <Feather name="sun" size={18} color={colors.stoneHighlight} />
            <View style={styles.welcomeCopy}>
              <Text style={[styles.welcomeTitle, { color: colors.ink }]}>{t('welcomeBack')}</Text>
              <Text style={[styles.welcomeText, { color: colors.mutedForeground }]}>
                {welcome.broken
                  ? t('streakBroken')
                  : formatCopy('welcomeStreak', { count: String(welcome.streak), target: String(DAILY_TARGET) })}
              </Text>
            </View>
          </View>
        )}
        {showIntro && reveal < 0.55 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.chapterIntro, { opacity: introOpacity, transform: [{ scale: introScale }] }]}
          >
            <Feather name="aperture" size={18} color={colors.stoneHighlight} />
            <Text style={[styles.chapterKicker, { color: colors.stoneHighlight }]}>{t('newScene')}</Text>
            <Text style={[styles.chapterTitle, { color: colors.ink }]}>{chapterTitle}</Text>
            <Text style={[styles.chapterNumber, { color: colors.mutedForeground }]}>{t('chapter')} {formatLevel(level)}</Text>
          </Animated.View>
        )}
        {phase === 'aiming' && (
          <>
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
                      { backgroundColor: aimProgress >= (index + 1) / 5 ? stoneColor : colors.border },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.powerValue, { color: stoneColor }]}>{Math.round(aimProgress * 100)}</Text>
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
          pointerEvents="none"
          style={[
            styles.stone,
            { left: stone.x - STONE_BOX / 2, top: stone.y - STONE_BOX / 2, transform: [{ scale: pulse }] },
          ]}
        >
          <StoneSprite color={stoneColor} />
        </Animated.View>

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
            {hitHint && (
              <View style={[styles.hintBox, { backgroundColor: colors.gameSurface, borderColor: colors.border }]}>
                <Text style={[styles.hintLabel, { color: colors.goal }]}>{t('hintTitle')}</Text>
                <Text style={[styles.hintText, { color: colors.ink }]}>{hitHint}</Text>
              </View>
            )}
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

        {phase === 'revive' && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.goal}22` }]}>
              <Feather name="droplet" size={20} color={colors.goal} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('reviveTitle')}</Text>
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>{t('reviveCopy')}</Text>
            <Text style={[styles.livesMessage, { color: colors.goal }]}>{progress.ink} {t('ink')}</Text>
            <Pressable
              testID="revive-button"
              onPress={revive}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="droplet" size={16} color={colors.gameBackground} />
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{formatCopy('reviveButton', { cost: String(REVIVE_COST) })}</Text>
            </Pressable>
            <Pressable onPress={declineRevive} style={styles.secondaryAction}>
              <Text style={[styles.secondaryActionText, { color: colors.mutedForeground }]}>{t('reviveDecline')}</Text>
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

        {phase === 'complete' && surpriseResult && (
          <View style={[styles.resultCard, { backgroundColor: colors.gameSurfaceRaised }]}>
            <View style={[styles.resultIcon, { backgroundColor: `${colors.goal}22` }]}>
              <Feather name="gift" size={21} color={colors.goal} />
            </View>
            <Text style={[styles.resultTitle, { color: colors.ink }]}>
              {surpriseResult.ink > 0 ? formatCopy('surpriseWon', { count: String(surpriseResult.ink) }) : t('surpriseDone')}
            </Text>
            <Pressable
              testID="exit-mode-button"
              onPress={exitMode}
              style={({ pressed }) => [styles.resultButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('continueRun')}</Text>
              <Feather name="arrow-right" size={16} color={colors.gameBackground} />
            </Pressable>
          </View>
        )}

        {phase === 'complete' && !surpriseResult && (
          <View style={[styles.resultCard, styles.completeCard, { backgroundColor: colors.gameSurfaceRaised }]}>
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
              <Text style={[styles.riskText, { color: colors.stoneHighlight }]}>{formatCopy('riskBonus', { count: String(completion?.riskBonus ?? 0) })}</Text>
            )}
            {completion && (
              <View style={styles.rewardRow}>
                <View style={[styles.rewardChip, { backgroundColor: `${colors.goal}22` }]}>
                  <Feather name="droplet" size={12} color={colors.goal} />
                  <Text style={[styles.rewardText, { color: colors.goal }]}>{formatCopy('inkEarned', { count: String(completion.inkEarned) })}</Text>
                </View>
                {completion.newSkins.map((skinId) => (
                  <View key={skinId} style={[styles.rewardChip, { backgroundColor: `${skinColor(skinId)}22` }]}>
                    <Feather name="droplet" size={12} color={skinColor(skinId)} />
                    <Text style={[styles.rewardText, { color: skinColor(skinId) }]}>{formatCopy('newSkin', { name: skinName(skinId) })}</Text>
                  </View>
                ))}
              </View>
            )}
            {completion?.dailyJustCompleted && (
              <Text style={[styles.riskText, { color: colors.goal }]}>{formatCopy('dailyDone', { count: String(DAILY_BONUS_INK) })}</Text>
            )}
            {completion?.secretUnlockedFor && (
              <Text style={[styles.riskText, { color: colors.stoneHighlight }]}>{t('secretUnlocked')}</Text>
            )}
            {worldRank && (
              <Pressable onPress={() => router.push('/leaderboard')} accessibilityRole="button" accessibilityLabel={t('lbSeeRanking')}>
                <Text style={[styles.riskText, { color: colors.goal }]}>
                  {formatCopy('lbRankChip', { rank: String(worldRank.rank) })}
                  {worldRank.climbed > 0 ? ` · ${formatCopy('lbRankUp', { count: String(worldRank.climbed) })}` : ''}
                </Text>
              </Pressable>
            )}
            {rankInvite && !worldRank && (
              <Pressable onPress={() => router.push('/leaderboard')} accessibilityRole="button" style={[styles.rewardChip, { backgroundColor: `${colors.stoneHighlight}22`, alignSelf: 'center', marginTop: 8 }]}>
                <Feather name="users" size={12} color={colors.stoneHighlight} />
                <Text style={[styles.rewardText, { color: colors.stoneHighlight }]}>{t('lbJoinTitle')}</Text>
              </Pressable>
            )}
            {completion?.drop && (
              <Text style={[styles.riskText, { color: colors.stoneHighlight }]}>
                {completion.drop.kind === 'ink'
                  ? formatCopy('dropInk', { count: String(completion.drop.amount) })
                  : completion.drop.kind === 'skin'
                    ? formatCopy('dropSkin', { name: skinName(completion.drop.id) })
                    : t('dropCard')}
              </Text>
            )}
            {completion?.pureFirst && <Text style={[styles.riskText, { color: colors.goal }]}>{t('pureClear')}</Text>}
            {completionNudges.map((nudge) => (
              <Text key={nudge} style={[styles.nudgeText, { color: colors.mutedForeground }]}>{nudge}</Text>
            ))}
            <Text style={[styles.resultCopy, { color: colors.mutedForeground }]}>{formatCopy('nextCopy', { chapter: L(chapterForLevel(level + 1).name) })}</Text>
            {bonusOffer && (
              <View style={[styles.hintBox, { backgroundColor: colors.gameSurface, borderColor: colors.goal }]}>
                <Text style={[styles.hintLabel, { color: colors.goal }]}>{t('bonusTitle')}</Text>
                <Text style={[styles.hintText, { color: colors.ink }]}>{t('bonusCopy')}</Text>
                <Pressable
                  testID="bonus-button"
                  onPress={() => startMode('bonus', level + 1)}
                  style={({ pressed }) => [styles.bonusButton, { backgroundColor: colors.goal, opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={[styles.resultButtonText, { color: colors.gameBackground }]}>{t('bonusPlay')}</Text>
                </Pressable>
                <Pressable onPress={() => setBonusOffer(false)} style={styles.secondaryAction}>
                  <Text style={[styles.secondaryActionText, { color: colors.mutedForeground }]}>{t('bonusSkip')}</Text>
                </Pressable>
              </View>
            )}
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
        {storyCard && <StoryCard kind={storyCard.kind} chapter={storyCard.chapter} colors={colors} onDismiss={dismissStory} />}
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.legend}>
          {([
            ['thorn', t('obstacle'), true],
            ['exit', t('goal'), true],
            ['moving', t('movingObstacle'), movingBars.length > 0],
            ['bouncy', t('bouncer'), bouncyBarriers.length > 0],
            ['portal', t('portal'), portals.length > 0],
          ] as const)
            .filter(([, , visible]) => visible)
            .map(([kind, label]) => (
              <View key={kind} style={styles.legendItem}>
                <LegendGlyph kind={kind} palette={artPalette} />
                <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{label}</Text>
              </View>
            ))}
        </View>
        {progress.skins.length > 1 && (
          <Pressable
            onPress={cycleSkin}
            style={[styles.skinButton, { borderColor: colors.border, backgroundColor: colors.gameSurface }]}
            accessibilityRole="button"
          >
            <View style={[styles.skinDot, { backgroundColor: stoneColor }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{t('style')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  stone: { position: 'absolute', width: STONE_BOX, height: STONE_BOX },
  burst: { position: 'absolute', width: 1, height: 1, zIndex: 10 },
  burstBubble: { position: 'absolute', borderWidth: 2 },
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
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 11, paddingBottom: 10, gap: 10 },
  legend: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  skinDot: { width: 12, height: 12, borderRadius: 6 },
  skinButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  legendText: { fontSize: 10, fontWeight: '600' },
  welcome: { position: 'absolute', zIndex: 25, top: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 13 },
  welcomeCopy: { flex: 1 },
  welcomeTitle: { fontSize: 13, fontWeight: '800' },
  welcomeText: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  dailyChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  dailyPip: { width: 14, height: 5, borderRadius: 3 },
  completeCard: { top: '12%' },
  callout: { position: 'absolute', width: 140, zIndex: 20, alignItems: 'center' },
  calloutText: { fontSize: 26, fontWeight: '900', letterSpacing: 1, textShadowColor: '#0B1220', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 3 },
  inkHud: { position: 'absolute', left: 44, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 12 },
  inkHudLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  inkTrack: { width: 92, height: 6, borderRadius: 4, overflow: 'hidden' },
  inkFill: { height: '100%', borderRadius: 4 },
  hintBanner: { position: 'absolute', zIndex: 14, top: 12, left: 44, right: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 11 },
  hintBannerText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  bonusButton: { alignSelf: 'stretch', borderRadius: 11, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 10 },
  rewardChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 9 },
  rewardText: { fontSize: 11, fontWeight: '800' },
  nudgeText: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 5 },
  hintBox: { alignSelf: 'stretch', borderRadius: 12, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 12, marginTop: 12 },
  hintLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  hintText: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});