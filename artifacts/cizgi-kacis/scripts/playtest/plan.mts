// Finds a real winning shot sequence for a level on a given board size, using the same physics as the game.
import { levelKind } from '../../game-logic.ts';
import { buildLevel, simulateShot } from '../../lib/solver.ts';
type State = { at: { x: number; y: number }; time: number; shots: Array<{ from: { x: number; y: number }; angle: number; speed: number; seconds: number }> };
// A plan a human could repeat: small aim and power errors must not change the outcome.
type Tolerance = { time: number; theta: number; speed: number };
const STRICT: Tolerance = { time: 0.25, theta: 0.02, speed: 0.2 };
const RELAXED: Tolerance = { time: 0.1, theta: 0.01, speed: 0.1 };
const NONE: Tolerance = { time: 0, theta: 0, speed: 0 }; // last resort: the bot re-plans after every shot anyway
function robust(built: ReturnType<typeof buildLevel>, from: { x: number; y: number }, angle: number, speed: number, time: number, base: ReturnType<typeof simulateShot>, tol: Tolerance) {
  const timed = built.eraser !== null || built.blueprints.length > 0 || ['pencil', 'boss'].includes(levelKind(built.level));
  // the bot only estimates the clock of the moving hazards, so a good plan must survive a timing error too
  for (const dTime of timed ? [-tol.time, 0, tol.time] : [0]) for (const dTheta of [-tol.theta, 0, tol.theta]) for (const dSpeed of [-tol.speed, 0, tol.speed]) {
    if (dTheta === 0 && dSpeed === 0 && dTime === 0) continue;
    const r = simulateShot(built, from, angle + dTheta, Math.min(7.1, Math.max(1.8, speed + dSpeed)), Math.max(0, time + dTime));
    if (r.outcome !== base.outcome) return false;
    if (base.outcome === 'rest' && Math.hypot(r.rest.x - base.rest.x, r.rest.y - base.rest.y) > 34) return false;
  }
  return true;
}
export function plan(level: number, W: number, H: number, maxShots = 8, from?: { x: number; y: number }, time0 = 0, tol: Tolerance = STRICT) {
  const built = buildLevel(level, W, H);
  const wide = tol === NONE; // the last-resort pass searches as widely as the solver does
  const speeds = wide ? [1.8, 2.6, 3.4, 4.2, 5, 5.8, 6.5, 7.1] : [2.2, 3.2, 4.2, 5.2, 6.2, 7.1];
  const angleCount = wide ? 144 : 120;
  const beam = wide ? 40 : 24;
  let frontier: State[] = [{ at: from ?? built.origin, time: time0, shots: [] }];
  const seen = new Set<string>();
  for (let depth = 1; depth <= maxShots; depth += 1) {
    const next: State[] = [];
    for (const s of frontier) {
      for (let i = 0; i < angleCount; i += 1) {
        const angle = (i / angleCount) * Math.PI * 2;
        for (const speed of speeds) {
          const r = simulateShot(built, s.at, angle, speed, s.time);
          const shot = { from: s.at, angle, speed, seconds: r.time - s.time };
          if (r.outcome === 'goal' && robust(built, s.at, angle, speed, s.time, r, tol)) return { shots: [...s.shots, shot], built };
          if (r.outcome === 'rest' && robust(built, s.at, angle, speed, s.time, r, tol)) {
            const key = `${Math.round(r.rest.x / 22)}:${Math.round(r.rest.y / 22)}`;
            if (!seen.has(key)) { seen.add(key); next.push({ at: r.rest, time: r.time, shots: [...s.shots, shot] }); }
          }
        }
      }
    }
    const cells = new Map<string, State>();
    for (const s of next) { const k = `${Math.floor(s.at.x / 60)}:${Math.floor(s.at.y / 60)}`; const h = cells.get(k); const sc = (q: State) => Math.hypot(q.at.x - built.goal.x, q.at.y - built.goal.y); if (!h || sc(s) < sc(h)) cells.set(k, s); }
    frontier = [...cells.values()].sort((a, b) => Math.hypot(a.at.x - built.goal.x, a.at.y - built.goal.y) - Math.hypot(b.at.x - built.goal.x, b.at.y - built.goal.y)).slice(0, beam);
  }
  return null;
}
const [level, W, H, fx, fy, t0] = process.argv.slice(2).map(Number);
if (level) {
  const from = Number.isFinite(fx) ? { x: fx, y: fy } : undefined;
  const start = Number.isFinite(t0) ? t0 : 0;
  // PLAN_MODE=none skips the strict passes (they are slow to fail on levels with moving hazards)
  const skip = process.env.PLAN_MODE === 'none';
  const p = (skip ? null : plan(level, W, H, 6, from, start, STRICT)) ?? (skip ? null : plan(level, W, H, 7, from, start, RELAXED)) ?? plan(level, W, H, 8, from, start, NONE); console.log(JSON.stringify(p ? p.shots : null)); }
