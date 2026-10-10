import { index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * One row per player of the world leaderboard. `secretHash` is the SHA-256 of a random secret that only the
 * player's device knows; the secret itself is never stored. Ranking: score desc, then who reached it first.
 */
export const playersTable = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nickname: varchar("nickname", { length: 32 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    score: integer("score").notNull().default(0),
    levelsCleared: integer("levels_cleared").notNull().default(0),
    stars: integer("stars").notNull().default(0),
    bestLevel: integer("best_level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    scoreUpdatedAt: timestamp("score_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("players_rank_idx").on(table.score.desc(), table.scoreUpdatedAt.asc(), table.id.asc())],
);

export type PlayerRow = typeof playersTable.$inferSelect;
