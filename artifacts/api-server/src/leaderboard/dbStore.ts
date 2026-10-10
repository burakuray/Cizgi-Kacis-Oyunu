import { and, asc, count, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type PlayerRow, playersTable } from "@workspace/db/schema";
import type { ScoreSubmission } from "./rules.ts";
import { type LeaderboardStore, type PlayerRecord, type RankedPlayer } from "./store.ts";

// The drizzle handle is passed in so this file never touches DATABASE_URL at import time.
export function createDbStore(db: NodePgDatabase<Record<string, unknown>>): LeaderboardStore {
  const t = playersTable;
  const toRecord = (row: PlayerRow): PlayerRecord => ({ ...row });
  const order = [desc(t.score), asc(t.scoreUpdatedAt), asc(t.id)];

  return {
    async createPlayer({ nickname, secretHash }) {
      const [row] = await db.insert(t).values({ nickname, secretHash }).returning();
      return toRecord(row);
    },
    async getPlayer(id) {
      const [row] = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return row ? toRecord(row) : null;
    },
    async setNickname(id, nickname) {
      await db.update(t).set({ nickname }).where(eq(t.id, id));
    },
    async setScore(id, submission: ScoreSubmission) {
      const [row] = await db
        .update(t)
        .set({ ...submission, scoreUpdatedAt: sql`now()` })
        .where(eq(t.id, id))
        .returning();
      return toRecord(row);
    },
    async deletePlayer(id) {
      const rows = await db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
      return rows.length > 0;
    },
    async top(limit) {
      const rows = await db.select().from(t).orderBy(...order).limit(limit);
      return rows.map((row, index): RankedPlayer => ({ ...toRecord(row), rank: index + 1 }));
    },
    async around(rank, radius) {
      const first = Math.max(1, rank - radius); // rank 1 is the best: the window cannot start above it
      const offset = first - 1;
      const rows = await db.select().from(t).orderBy(...order).limit(rank + radius - first + 1).offset(offset);
      return rows.map((row, index): RankedPlayer => ({ ...toRecord(row), rank: offset + index + 1 }));
    },
    async rankOf(player) {
      const [{ ahead }] = await db
        .select({ ahead: count() })
        .from(t)
        .where(
          or(
            gt(t.score, player.score),
            and(eq(t.score, player.score), lt(t.scoreUpdatedAt, player.scoreUpdatedAt)),
            and(eq(t.score, player.score), eq(t.scoreUpdatedAt, player.scoreUpdatedAt), lt(t.id, player.id)),
          ),
        );
      return Number(ahead) + 1;
    },
    async count() {
      const [{ total }] = await db.select({ total: count() }).from(t);
      return Number(total);
    },
  };
}
