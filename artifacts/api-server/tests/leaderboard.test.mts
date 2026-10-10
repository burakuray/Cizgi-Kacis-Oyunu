import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createMemoryStore } from "../src/leaderboard/memoryStore.ts";
import { createLeaderboardRouter, jsonErrorHandler } from "../src/leaderboard/router.ts";
import { clampLimit, compareRank, isImprovement, maxPossibleScore, parseSubmission, sanitizeNickname } from "../src/leaderboard/rules.ts";

type Auth = { id: string; secret: string };

let base = "";
async function startServer(limits?: { registerPerHour?: number; submitPerMinute?: number; readPerMinute?: number }) {
  let tick = 0;
  const store = createMemoryStore(() => new Date(1_700_000_000_000 + tick++ * 1000));
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createLeaderboardRouter({ store, blocklist: ["badword"], limits }));
  app.use(jsonErrorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (method: string, path: string, body?: unknown, auth?: Auth) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { "x-player-id": auth.id, authorization: `Bearer ${auth.secret}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers, text };
  };
  const register = async (nickname: string): Promise<Auth> => {
    const { status, body } = await call("POST", "/players", { nickname });
    assert.equal(status, 201, JSON.stringify(body));
    return { id: body.id, secret: body.secret };
  };
  const submit = (auth: Auth, score: number, levelsCleared: number, stars = levelsCleared * 2) =>
    call("PUT", "/players/me/score", { score, levelsCleared, stars, bestLevel: levelsCleared + 1 }, auth);
  return { call, register, submit, close: () => server.close() };
}

test("nicknames are cleaned, bounded and cannot impersonate staff", () => {
  assert.deepEqual(sanitizeNickname("  Ayşe   Nur "), { ok: true, nickname: "Ayşe Nur" });
  assert.deepEqual(sanitizeNickname("Çağlar_42"), { ok: true, nickname: "Çağlar_42" });
  for (const bad of ["ab", "a".repeat(17), "<script>", "@@@@", "Ad\u0000min", "", 12, null]) assert.equal(sanitizeNickname(bad).ok, false, String(bad));
  assert.equal(sanitizeNickname("Admin").ok, false);
  assert.equal(sanitizeNickname("A.d-m_i n").ok, false, "separators do not hide a reserved name");
  assert.equal(sanitizeNickname("my BadWord x", ["badword"]).ok, false, "operator blocklist");
  assert.equal(sanitizeNickname("Badminton").ok, true, "reserved names match exactly, not as substrings");
});

test("only scores the game can produce are accepted", () => {
  assert.equal(parseSubmission({ score: 0, levelsCleared: 0, stars: 0, bestLevel: 1 }).ok, true);
  assert.equal(parseSubmission({ score: 1000, levelsCleared: 3, stars: 7, bestLevel: 4 }).ok, true);
  const cap = maxPossibleScore(3);
  assert.equal(parseSubmission({ score: cap, levelsCleared: 3, stars: 9, bestLevel: 4 }).ok, true);
  const tooHigh = parseSubmission({ score: cap + 1, levelsCleared: 3, stars: 9, bestLevel: 4 });
  assert.deepEqual(tooHigh, { ok: false, reason: "scoreTooHigh" });
  assert.deepEqual(parseSubmission({ score: 299, levelsCleared: 3, stars: 3, bestLevel: 4 }), { ok: false, reason: "scoreTooLow" });
  assert.equal(parseSubmission({ score: 500, levelsCleared: 3, stars: 10, bestLevel: 4 }).ok, false, "more than 3 stars per level");
  assert.equal(parseSubmission({ score: 500, levelsCleared: 3, stars: 3, bestLevel: 9 }).ok, false, "best level must follow cleared levels");
  for (const junk of [null, "x", [], { score: "999", levelsCleared: 1, stars: 1, bestLevel: 2 }, { score: 1.5, levelsCleared: 1, stars: 1, bestLevel: 2 }, { score: -1, levelsCleared: 0, stars: 0, bestLevel: 1 }]) {
    assert.equal(parseSubmission(junk).ok, false, JSON.stringify(junk));
  }
});

test("ranking: higher score first, earlier achiever wins ties, order is stable", () => {
  const at = (n: number) => new Date(n);
  const rows = [
    { id: "b", score: 100, scoreUpdatedAt: at(5) },
    { id: "a", score: 100, scoreUpdatedAt: at(9) },
    { id: "c", score: 300, scoreUpdatedAt: at(9) },
    { id: "d", score: 100, scoreUpdatedAt: at(5) },
  ].sort(compareRank);
  assert.deepEqual(rows.map((r) => r.id), ["c", "b", "d", "a"]);
  assert.equal(isImprovement({ score: 10, levelsCleared: 1, stars: 1, bestLevel: 2 }, { score: 10, levelsCleared: 1, stars: 1, bestLevel: 2 }), false);
  assert.equal(isImprovement({ score: 10, levelsCleared: 1, stars: 1, bestLevel: 2 }, { score: 9, levelsCleared: 1, stars: 3, bestLevel: 2 }), false, "a lower score is never an improvement");
  assert.equal(isImprovement({ score: 800, levelsCleared: 3, stars: 6, bestLevel: 4 }, { score: 500, levelsCleared: 4, stars: 8, bestLevel: 5 }), false, "more cleared levels cannot justify a lower total");
  assert.equal(clampLimit("500"), 100);
  assert.equal(clampLimit("abc"), 50);
  assert.equal(clampLimit("0"), 1);
});

test("register, submit, climb the ladder, and see yourself and the others", async () => {
  const { call, register, submit, close } = await startServer();
  try {
    const ayse = await register("Ayşe");
    const mert = await register("Mert");
    const deniz = await register("Deniz");

    assert.equal((await submit(ayse, 700, 2)).body.rank, 1);
    const mertFirst = await submit(mert, 900, 2);
    assert.equal(mertFirst.body.rank, 1, "Mert overtakes Ayşe");
    assert.equal(mertFirst.body.total, 3);
    const denizTied = await submit(deniz, 700, 2);
    assert.equal(denizTied.body.rank, 3, "tie with Ayşe: she got there first, so Deniz is behind her");

    const board = await call("GET", "/leaderboard?limit=10");
    assert.equal(board.status, 200);
    assert.deepEqual(board.body.entries.map((e: { nickname: string }) => e.nickname), ["Mert", "Ayşe", "Deniz"]);
    assert.deepEqual(board.body.entries.map((e: { rank: number }) => e.rank), [1, 2, 3]);
    assert.equal(board.body.total, 3);
    assert.equal(board.body.me, null, "anonymous readers have no 'me'");
    assert.ok(board.body.entries.every((e: { isMe: boolean }) => e.isMe === false));
    assert.ok(!/secret|id"|hash/i.test(board.text.replace(/"isMe"/g, "")), "no ids or secrets leak into the public list");

    const asDeniz = await call("GET", "/leaderboard?limit=10", undefined, deniz);
    assert.equal(asDeniz.body.me.rank, 3);
    assert.equal(asDeniz.body.me.isMe, true);
    assert.equal(asDeniz.body.entries[2].isMe, true);
    assert.deepEqual(asDeniz.body.around, [], "already visible in the list, no extra window");
  } finally {
    close();
  }
});

test("same-score progress updates preserve the first-achiever tie break", async () => {
  const { register, submit, close } = await startServer();
  try {
    const first = await register("First Player");
    const second = await register("Second Player");

    assert.equal((await submit(first, 700, 2, 2)).body.rank, 1);
    assert.equal((await submit(second, 700, 2, 2)).body.rank, 2);

    const improvedStars = await submit(first, 700, 2, 3);
    assert.equal(improvedStars.body.accepted, true);
    assert.equal(improvedStars.body.rank, 1, "a same-score metadata update must not erase when the score was first reached");
  } finally {
    close();
  }
});

test("a player outside the top list still sees their rank and the players around them", async () => {
  const { call, register, submit, close } = await startServer();
  try {
    const players: Auth[] = [];
    for (let i = 0; i < 7; i += 1) {
      const auth = await register(`Player ${i + 1}`);
      players.push(auth);
      await submit(auth, 1000 - i * 50, 2);
    }
    const asSeventh = await call("GET", "/leaderboard?limit=3", undefined, players[6]);
    assert.equal(asSeventh.body.entries.length, 3);
    assert.equal(asSeventh.body.me.rank, 7);
    assert.equal(asSeventh.body.total, 7);
    assert.deepEqual(asSeventh.body.around.map((e: { rank: number }) => e.rank), [5, 6, 7]);
    assert.equal(asSeventh.body.around[2].isMe, true);
  } finally {
    close();
  }
});

test("scores never go down and impossible scores are rejected", async () => {
  const { register, submit, call, close } = await startServer();
  try {
    const me = await register("Kaan");
    assert.equal((await submit(me, 800, 3, 6)).body.accepted, true);
    const older = await submit(me, 500, 2, 4);
    assert.equal(older.status, 200);
    assert.equal(older.body.accepted, false, "an old copy of the game cannot overwrite a better result");
    assert.equal(older.body.score, 800);

    const lowerWithMoreLevels = await submit(me, 500, 4, 8);
    assert.equal(lowerWithMoreLevels.body.accepted, false, "a lower total cannot replace the record even with more levels reported");
    assert.equal(lowerWithMoreLevels.body.score, 800);

    const cheat = await submit(me, 9_999_999, 3, 9);
    assert.equal(cheat.status, 422);
    assert.equal(cheat.body.error, "invalid_score");
    const board = await call("GET", "/leaderboard", undefined, me);
    assert.equal(board.body.me.score, 800, "the rejected cheat changed nothing");
  } finally {
    close();
  }
});

test("only the owner can change a player: wrong secret, wrong id and missing headers are refused", async () => {
  const { register, submit, call, close } = await startServer();
  try {
    const owner = await register("Owner One");
    const other = await register("Other One");
    assert.equal((await call("PUT", "/players/me/score", { score: 100, levelsCleared: 1, stars: 1, bestLevel: 2 })).status, 401);
    assert.equal((await submit({ id: owner.id, secret: "x".repeat(43) }, 100, 1)).status, 401);
    assert.equal((await submit({ id: "00000000-0000-4000-8000-000000000000", secret: owner.secret }, 100, 1)).status, 401);
    assert.equal((await submit({ id: "not-a-uuid", secret: owner.secret }, 100, 1)).status, 401);
    assert.equal((await call("PATCH", "/players/me", { nickname: "Hacked" }, { id: owner.id, secret: other.secret })).status, 401);
    assert.equal((await call("DELETE", "/players/me", undefined, { id: owner.id, secret: other.secret })).status, 401);
    assert.equal((await submit(owner, 100, 1)).status, 200);
  } finally {
    close();
  }
});

test("rename and delete the account", async () => {
  const { register, submit, call, close } = await startServer();
  try {
    const me = await register("Old Name");
    await submit(me, 600, 2);
    const renamed = await call("PATCH", "/players/me", { nickname: "  New   Name " }, me);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.nickname, "New Name");
    assert.equal((await call("PATCH", "/players/me", { nickname: "x" }, me)).status, 422);
    assert.equal((await call("GET", "/leaderboard", undefined, me)).body.entries[0].nickname, "New Name");

    assert.equal((await call("DELETE", "/players/me", undefined, me)).status, 204);
    const after = await call("GET", "/leaderboard", undefined, me);
    assert.equal(after.body.total, 0);
    assert.equal(after.body.me, null, "a deleted account no longer authenticates");
    assert.equal((await submit(me, 600, 2)).status, 401);
  } finally {
    close();
  }
});

test("bad nicknames are refused with a machine-readable reason", async () => {
  const { call, close } = await startServer();
  try {
    for (const nickname of ["", "ab", "<b>hi</b>", "Admin", "xx badword xx", 42, undefined]) {
      const response = await call("POST", "/players", { nickname });
      assert.equal(response.status, 422, String(nickname));
      assert.equal(response.body.error, "invalid_nickname");
      assert.ok(response.body.reason);
    }
    const broken = await fetch(`${base}/players`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error, "bad_request", "malformed JSON answers with JSON, not an HTML page");
    const huge = await fetch(`${base}/players`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: "x".repeat(40_000) }) });
    assert.equal(huge.status, 413);
  } finally {
    close();
  }
});

test("rate limits stop scripts from flooding registration and score submissions", async () => {
  const { call, register, submit, close } = await startServer({ registerPerHour: 3, submitPerMinute: 3 });
  try {
    const first = await register("Fast One");
    await register("Fast Two");
    await register("Fast Three");
    const blocked = await call("POST", "/players", { nickname: "Fast Four" });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

    for (let i = 0; i < 3; i += 1) assert.equal((await submit(first, 100 + i, 1)).status, 200);
    assert.equal((await submit(first, 200, 1)).status, 429);
  } finally {
    close();
  }
});

test("without a database the server stays up and answers 503 instead of crashing", async () => {
  const saved = process.env["DATABASE_URL"];
  delete process.env["DATABASE_URL"];
  const { createLazyDbStore } = await import("../src/leaderboard/lazyStore.ts");
  const app = express();
  app.use(express.json());
  app.use("/api", createLeaderboardRouter({ store: createLazyDbStore() }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const board = await fetch(`${base}/leaderboard`);
    assert.equal(board.status, 503);
    assert.equal((await board.json()).error, "unavailable");
    const join = await fetch(`${base}/players`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: "Ayşe" }) });
    assert.equal(join.status, 503);
  } finally {
    server.close();
    if (saved !== undefined) process.env["DATABASE_URL"] = saved;
  }
});
