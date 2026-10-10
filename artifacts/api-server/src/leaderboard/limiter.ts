/** Tiny fixed-window rate limiter (per process). Enough to blunt scripts; use a gateway for real abuse. */
export function createLimiter(windowMs: number, max: number, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
      const time = now();
      if (hits.size > 5000) for (const [k, v] of hits) if (time - v.start >= windowMs) hits.delete(k);
      const entry = hits.get(key);
      if (!entry || time - entry.start >= windowMs) {
        hits.set(key, { start: time, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      entry.count += 1;
      return entry.count <= max
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + windowMs - time) / 1000)) };
    },
  };
}
