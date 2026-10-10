import type { ScoreSubmission } from "./rules.ts";

export type PlayerRecord = {
  id: string;
  nickname: string;
  secretHash: string;
  score: number;
  levelsCleared: number;
  stars: number;
  bestLevel: number;
  createdAt: Date;
  scoreUpdatedAt: Date;
};

export type RankedPlayer = PlayerRecord & { rank: number };

/** Everything the HTTP layer needs from storage. Implemented by Postgres in production and in memory in tests. */
export interface LeaderboardStore {
  createPlayer(input: { nickname: string; secretHash: string }): Promise<PlayerRecord>;
  getPlayer(id: string): Promise<PlayerRecord | null>;
  setNickname(id: string, nickname: string): Promise<void>;
  setScore(id: string, submission: ScoreSubmission): Promise<PlayerRecord>;
  deletePlayer(id: string): Promise<boolean>;
  top(limit: number): Promise<RankedPlayer[]>;
  /** Players whose rank lies in [rank - radius, rank + radius]. */
  around(rank: number, radius: number): Promise<RankedPlayer[]>;
  rankOf(player: PlayerRecord): Promise<number>;
  count(): Promise<number>;
}

export class StoreUnavailableError extends Error {
  constructor(message = "leaderboard storage is not available") {
    super(message);
    this.name = "StoreUnavailableError";
  }
}
