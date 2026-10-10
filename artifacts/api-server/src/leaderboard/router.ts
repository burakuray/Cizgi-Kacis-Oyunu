import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type ErrorRequestHandler, type IRouter, type Request, type RequestHandler, type Response, Router } from "express";
import { createLimiter } from "./limiter.ts";
import { clampLimit, isImprovement, parseSubmission, sanitizeNickname } from "./rules.ts";
import { type LeaderboardStore, type PlayerRecord, type RankedPlayer, StoreUnavailableError } from "./store.ts";

export type LeaderboardOptions = {
  store: LeaderboardStore;
  /** Extra words that may not appear in nicknames (operator-maintained moderation list). */
  blocklist?: string[];
  limits?: { registerPerHour?: number; submitPerMinute?: number; readPerMinute?: number };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

function publicEntry(row: RankedPlayer | (PlayerRecord & { rank: number }), meId: string | null) {
  return { rank: row.rank, nickname: row.nickname, score: row.score, levelsCleared: row.levelsCleared, stars: row.stars, isMe: meId !== null && row.id === meId };
}

function fail(res: Response, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ error, message, ...extra });
}

/** Turns body-parser failures (malformed or oversized JSON) into JSON instead of Express's HTML error page. */
export const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const status = typeof error?.status === "number" ? error.status : 500;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: status === 413 ? "too_large" : "bad_request", message: "Invalid request body." });
    return;
  }
  next(error);
};

/**
 * World leaderboard API (mounted under /api):
 *   POST   /players              register {nickname}            -> {id, secret, nickname}
 *   PATCH  /players/me           rename {nickname}              (auth)
 *   PUT    /players/me/score     {score, levelsCleared, stars, bestLevel} (auth) -> {accepted, score, rank, total}
 *   DELETE /players/me           delete the account             (auth)
 *   GET    /leaderboard?limit=   public top list; with auth also `me` and the players around me
 * Auth = headers `X-Player-Id: <id>` and `Authorization: Bearer <secret>`.
 */
export function createLeaderboardRouter(options: LeaderboardOptions): IRouter {
  const { store } = options;
  const blocklist = options.blocklist ?? [];
  const registerLimit = createLimiter(60 * 60 * 1000, options.limits?.registerPerHour ?? 8);
  const submitLimit = createLimiter(60 * 1000, options.limits?.submitPerMinute ?? 40);
  const readLimit = createLimiter(60 * 1000, options.limits?.readPerMinute ?? 120);
  const router = Router();

  const guarded =
    (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof StoreUnavailableError) return fail(res, 503, "unavailable", "The leaderboard is not available right now.");
        req.log?.error({ err: error }, "leaderboard request failed");
        fail(res, 500, "server_error", "Something went wrong.");
      }
    };

  async function authenticate(req: Request): Promise<PlayerRecord | null> {
    const id = req.header("x-player-id");
    const match = /^Bearer (\S{20,200})$/.exec(req.header("authorization") ?? "");
    if (!id || !match || !UUID.test(id)) return null;
    const player = await store.getPlayer(id.toLowerCase());
    if (!player) return null;
    const given = Buffer.from(hashSecret(match[1]), "hex");
    const stored = Buffer.from(player.secretHash, "hex");
    return given.length === stored.length && timingSafeEqual(given, stored) ? player : null;
  }

  const tooMany = (res: Response, retryAfterSeconds: number) => {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    fail(res, 429, "rate_limited", "Too many requests, slow down.", { retryAfterSeconds });
  };

  router.post(
    "/players",
    guarded(async (req, res) => {
      const limited = registerLimit.hit(req.ip ?? "unknown");
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);
      const nickname = sanitizeNickname((req.body as { nickname?: unknown } | undefined)?.nickname, blocklist);
      if (!nickname.ok) return fail(res, 422, "invalid_nickname", "Choose 3-16 letters, digits or spaces.", { reason: nickname.reason });
      const secret = randomBytes(32).toString("base64url");
      const player = await store.createPlayer({ nickname: nickname.nickname, secretHash: hashSecret(secret) });
      res.status(201).json({ id: player.id, secret, nickname: player.nickname });
    }),
  );

  router.patch(
    "/players/me",
    guarded(async (req, res) => {
      const me = await authenticate(req);
      if (!me) return fail(res, 401, "unauthorized", "Unknown player.");
      const nickname = sanitizeNickname((req.body as { nickname?: unknown } | undefined)?.nickname, blocklist);
      if (!nickname.ok) return fail(res, 422, "invalid_nickname", "Choose 3-16 letters, digits or spaces.", { reason: nickname.reason });
      await store.setNickname(me.id, nickname.nickname);
      res.json({ nickname: nickname.nickname });
    }),
  );

  router.put(
    "/players/me/score",
    guarded(async (req, res) => {
      const me = await authenticate(req);
      if (!me) return fail(res, 401, "unauthorized", "Unknown player.");
      const limited = submitLimit.hit(me.id);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);
      const parsed = parseSubmission(req.body);
      if (!parsed.ok) return fail(res, 422, "invalid_score", "That score is not possible.", { reason: parsed.reason });
      const current = { score: me.score, levelsCleared: me.levelsCleared, stars: me.stars, bestLevel: me.bestLevel };
      const accepted = isImprovement(current, parsed.value);
      const player = accepted ? await store.setScore(me.id, parsed.value) : me;
      const [rank, total] = await Promise.all([store.rankOf(player), store.count()]);
      res.json({ accepted, score: player.score, levelsCleared: player.levelsCleared, stars: player.stars, rank, total });
    }),
  );

  router.delete(
    "/players/me",
    guarded(async (req, res) => {
      const me = await authenticate(req);
      if (!me) return fail(res, 401, "unauthorized", "Unknown player.");
      await store.deletePlayer(me.id);
      res.status(204).end();
    }),
  );

  router.get(
    "/leaderboard",
    guarded(async (req, res) => {
      const limited = readLimit.hit(req.ip ?? "unknown");
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);
      const limit = clampLimit(req.query.limit);
      const me = await authenticate(req);
      const meId = me?.id ?? null;
      const [rows, total] = await Promise.all([store.top(limit), store.count()]);
      let meEntry = null;
      let around: ReturnType<typeof publicEntry>[] = [];
      if (me) {
        const rank = await store.rankOf(me);
        meEntry = publicEntry({ ...me, rank }, meId);
        if (rank > limit) around = (await store.around(rank, 2)).map((row) => publicEntry(row, meId));
      }
      res.json({ entries: rows.map((row) => publicEntry(row, meId)), total, me: meEntry, around });
    }),
  );

  return router;
}
