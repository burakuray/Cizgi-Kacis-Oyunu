/** The game's real HTTP client against the real server code (in-memory store), over a real socket. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { ApiError, createLeaderboardClient } from "../../cizgi-kacis/lib/leaderboardApi.ts";
import { applyClear, defaultProgress, leaderboardSnapshot, touchDay } from "../../cizgi-kacis/lib/progress.ts";
import { createMemoryStore } from "../src/leaderboard/memoryStore.ts";
import { createLeaderboardRouter, jsonErrorHandler } from "../src/leaderboard/router.ts";

async function boot(limits?: { submitPerMinute?: number }) {
  let tick = 0;
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createLeaderboardRouter({ store: createMemoryStore(() => new Date(1_700_000_000_000 + tick++ * 1000)), limits }));
  app.use(jsonErrorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return { baseUrl, client: createLeaderboardClient({ baseUrl, timeoutMs: 1500 }), close: () => server.close() };
}

function play(levels: number, quality: number) {
  let progress = touchDay(defaultProgress(), "2026-05-01").progress;
  for (let level = 1; level <= levels; level += 1) {
    progress = applyClear(progress, { level, failedAttempts: quality, riskBonus: 30, today: "2026-05-01" }).progress;
  }
  return progress;
}

test("a full player journey: join, upload real game scores, climb, see the world", async () => {
  const { client, close } = await boot();
  try {
    const ayse = await client.register("Ayşe");
    const mert = await client.register("Mert");
    const deniz = await client.register("Deniz");

    const mertProgress = play(4, 0);
    const ayseProgress = play(3, 0);
    const denizProgress = play(2, 2);

    const m = await client.submitScore(mert, leaderboardSnapshot(mertProgress));
    const a = await client.submitScore(ayse, leaderboardSnapshot(ayseProgress));
    const d = await client.submitScore(deniz, leaderboardSnapshot(denizProgress));
    assert.deepEqual([m.rank, a.rank, d.rank], [1, 2, 3]);
    assert.equal(d.total, 3);

    const board = await client.board(50, deniz);
    assert.deepEqual(board.entries.map((e) => e.nickname), ["Mert", "Ayşe", "Deniz"]);
    assert.equal(board.me?.rank, 3);
    assert.equal(board.me?.score, leaderboardSnapshot(denizProgress).score);
    assert.equal(board.entries.find((e) => e.isMe)?.nickname, "Deniz");

    // Deniz plays on. Equalling Ayşe's score does not pass her (she got there first)...
    const tied = await client.submitScore(deniz, leaderboardSnapshot(play(3, 0)));
    assert.equal(tied.accepted, true);
    assert.equal(tied.rank, 3);
    // ...but reaching Mert's total puts Deniz right behind him, ahead of Ayşe.
    const ahead = await client.submitScore(deniz, leaderboardSnapshot(play(4, 0)));
    assert.equal(ahead.rank, 2);
    assert.equal((await client.board(50, ayse)).me?.rank, 3);
    assert.equal((await client.board(2)).entries.length, 2);
  } finally {
    close();
  }
});

test("errors reach the app as typed errors it can explain to the player", async () => {
  const { client, close } = await boot({ submitPerMinute: 3 });
  try {
    await assert.rejects(client.register("x"), (e: unknown) => e instanceof ApiError && e.code === "invalid_nickname" && e.status === 422 && e.reason === "length");
    await assert.rejects(client.register("Admin"), (e: unknown) => e instanceof ApiError && e.reason === "reserved");

    const me = await client.register("Kaan");
    await assert.rejects(client.submitScore({ ...me, secret: "z".repeat(43) }, leaderboardSnapshot(play(2, 0))), (e: unknown) => e instanceof ApiError && e.code === "unauthorized");
    await assert.rejects(client.submitScore(me, { score: 5_000_000, levelsCleared: 2, stars: 6, bestLevel: 3 }), (e: unknown) => e instanceof ApiError && e.code === "invalid_score");

    const snapshot = leaderboardSnapshot(play(2, 0));
    await client.submitScore(me, snapshot);
    await client.submitScore(me, snapshot);
    // (the refused cheat above also counted: three calls per minute are allowed)
    await assert.rejects(client.submitScore(me, snapshot), (e: unknown) => e instanceof ApiError && e.code === "rate_limited" && (e.retryAfterSeconds ?? 0) >= 1);
  } finally {
    close();
  }
});

test("rename and delete work through the client; a deleted account is rejected afterwards", async () => {
  const { client, close } = await boot();
  try {
    const me = await client.register("Eski Ad");
    await client.submitScore(me, leaderboardSnapshot(play(2, 0)));
    assert.equal((await client.rename(me, "Yeni Ad")).nickname, "Yeni Ad");
    assert.equal((await client.board(10, me)).me?.nickname, "Yeni Ad");
    await client.deleteAccount(me);
    await assert.rejects(client.submitScore(me, leaderboardSnapshot(play(2, 0))), (e: unknown) => e instanceof ApiError && e.code === "unauthorized");
    assert.equal((await client.board(10)).total, 0);
  } finally {
    close();
  }
});

test("an unreachable or silent server becomes a clear network or timeout error, never a crash", async () => {
  const { baseUrl, close } = await boot();
  close();
  const dead = createLeaderboardClient({ baseUrl: baseUrl.replace(/:\d+/, ":1"), timeoutMs: 800 });
  await assert.rejects(dead.board(10), (e: unknown) => e instanceof ApiError && e.code === "network");

  const slow = express();
  slow.get("/api/leaderboard", () => undefined); // never answers
  const server = slow.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const silent = createLeaderboardClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, timeoutMs: 300 });
    await assert.rejects(silent.board(10), (e: unknown) => e instanceof ApiError && e.code === "timeout");
  } finally {
    server.closeAllConnections?.();
    server.close();
  }

  const odd = express();
  odd.get("/api/leaderboard", (_req, res) => res.status(200).send("<html>captive portal</html>"));
  const oddServer = odd.listen(0);
  await new Promise((resolve) => oddServer.once("listening", resolve));
  try {
    const confused = createLeaderboardClient({ baseUrl: `http://127.0.0.1:${(oddServer.address() as AddressInfo).port}/api` });
    await assert.rejects(confused.board(10), (e: unknown) => e instanceof ApiError && e.code === "bad_response");
  } finally {
    oddServer.close();
  }
});
