import { randomUUID } from "node:crypto";
import { compareRank, type ScoreSubmission } from "./rules.ts";
import type { LeaderboardStore, PlayerRecord, RankedPlayer } from "./store.ts";

/** In-memory store used by the tests (and handy for running the server locally without a database). */
export function createMemoryStore(now: () => Date = () => new Date()): LeaderboardStore {
  const players = new Map<string, PlayerRecord>();
  const ordered = (): RankedPlayer[] => [...players.values()].sort(compareRank).map((player, index) => ({ ...player, rank: index + 1 }));
  return {
    async createPlayer({ nickname, secretHash }) {
      const stamp = now();
      const player: PlayerRecord = { id: randomUUID(), nickname, secretHash, score: 0, levelsCleared: 0, stars: 0, bestLevel: 1, createdAt: stamp, scoreUpdatedAt: stamp };
      players.set(player.id, player);
      return { ...player };
    },
    async getPlayer(id) {
      const player = players.get(id);
      return player ? { ...player } : null;
    },
    async setNickname(id, nickname) {
      const player = players.get(id);
      if (player) player.nickname = nickname;
    },
    async setScore(id, submission: ScoreSubmission) {
      const player = players.get(id);
      if (!player) throw new Error("unknown player");
      const scoreUpdatedAt = submission.score > player.score ? now() : player.scoreUpdatedAt;
      Object.assign(player, submission, { scoreUpdatedAt });
      return { ...player };
    },
    async deletePlayer(id) {
      return players.delete(id);
    },
    async top(limit) {
      return ordered().slice(0, limit);
    },
    async around(rank, radius) {
      return ordered().filter((row) => row.rank >= rank - radius && row.rank <= rank + radius);
    },
    async rankOf(player) {
      return ordered().find((row) => row.id === player.id)?.rank ?? ordered().length + 1;
    },
    async count() {
      return players.size;
    },
  };
}
