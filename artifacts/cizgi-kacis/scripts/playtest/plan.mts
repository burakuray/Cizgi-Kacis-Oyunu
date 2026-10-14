// Finds a real winning shot sequence for a level on a given board size, using the same physics as the game.
import { buildLevel, simulateShot } from '../../lib/solver.ts';
type State = { at: { x: number; y: number }; time: number; shots: Array<{ from: { x: number; y: number }; angle: number; speed: number; seconds: number }> };
// A plan a human could repeat: small aim and power errors must not change the outcome.
function robust(built: ReturnType<typeof buildLevel>, from: { x: number; y: number }, angle: number, speed: number, time: number, base: ReturnType<typeof simulateShot>) {
  for (const dTheta of [-0.02, 0, 0.02]) for (const dSpeed of [-0.2, 0, 0.2]) {
    if (dTheta === 0 && dSpeed === 0) continue;
    const r = simulateShot(built, from, angle + dTheta, Math.min(7.1, Math.max(1.8, speed + dSpeed)), time);
    if (r.outcome !== base.outcome) return false;
    if (base.outcome === 'rest' && Math.hypot(r.rest.x - base.rest.x, r.rest.y - base.rest.y) > 34) return false;
  }
  return true;
}
export function plan(level: number, W: number, H: number, maxShots = 8, from?: { x: number; y: number }) {
  const built = buildLevel(level, W, H);
  const speeds = [2.2, 3.2, 4.2, 5.2, 6.2, 7.1];
  let frontier: State[] = [{ at: from ?? built.origin, time: 0, shots: [] }];
  const seen = new Set<string>();
  for (let depth = 1; depth <= maxShots; depth += 1) {
    const next: State[] = [];
    for (const s of frontier) {
      for (let i = 0; i < 120; i += 1) {
        const angle = (i / 120) * Math.PI * 2;
        for (const speed of speeds) {
          const r = simulateShot(built, s.at, angle, speed, s.time);
          const shot = { from: s.at, angle, speed, seconds: r.time - s.time };
          if (r.outcome === 'goal' && robust(built, s.at, angle, speed, s.time, r)) return { shots: [...s.shots, shot], built };
          if (r.outcome === 'rest' && robust(built, s.at, angle, speed, s.time, r)) {
            const key = `${Math.round(r.rest.x / 22)}:${Math.round(r.rest.y / 22)}`;
            if (!seen.has(key)) { seen.add(key); next.push({ at: r.rest, time: r.time, shots: [...s.shots, shot] }); }
          }
        }
      }
    }
    const cells = new Map<string, State>();
    for (const s of next) { const k = `${Math.floor(s.at.x / 60)}:${Math.floor(s.at.y / 60)}`; const h = cells.get(k); const sc = (q: State) => Math.hypot(q.at.x - built.goal.x, q.at.y - built.goal.y); if (!h || sc(s) < sc(h)) cells.set(k, s); }
    frontier = [...cells.values()].sort((a, b) => Math.hypot(a.at.x - built.goal.x, a.at.y - built.goal.y) - Math.hypot(b.at.x - built.goal.x, b.at.y - built.goal.y)).slice(0, 30);
  }
  return null;
}
const [level, W, H, fx, fy] = process.argv.slice(2).map(Number);
if (level) { const p = plan(level, W, H, 8, Number.isFinite(fx) ? { x: fx, y: fy } : undefined); console.log(JSON.stringify(p ? p.shots : null)); }
