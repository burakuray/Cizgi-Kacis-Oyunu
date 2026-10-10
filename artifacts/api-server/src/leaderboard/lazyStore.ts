import { type LeaderboardStore, StoreUnavailableError } from "./store.ts";

/**
 * Connects to Postgres on first use. Without DATABASE_URL the server still starts (health checks, other
 * routes) and leaderboard calls answer 503 instead of crashing the process.
 */
export function createLazyDbStore(): LeaderboardStore {
  let pending: Promise<LeaderboardStore> | null = null;
  const connect = (): Promise<LeaderboardStore> => {
    if (!process.env["DATABASE_URL"]) return Promise.reject(new StoreUnavailableError("DATABASE_URL is not set"));
    pending ??= (async () => {
      const [{ db }, { createDbStore }] = await Promise.all([import("@workspace/db"), import("./dbStore.ts")]);
      return createDbStore(db as never);
    })().catch((error) => {
      pending = null;
      throw new StoreUnavailableError(error instanceof Error ? error.message : "database connection failed");
    });
    return pending;
  };
  const method =
    <K extends keyof LeaderboardStore>(name: K) =>
    async (...args: Parameters<LeaderboardStore[K]>) => {
      const store = await connect();
      return (store[name] as (...a: unknown[]) => unknown)(...args);
    };
  return {
    createPlayer: method("createPlayer"),
    getPlayer: method("getPlayer"),
    setNickname: method("setNickname"),
    setScore: method("setScore"),
    deletePlayer: method("deletePlayer"),
    top: method("top"),
    around: method("around"),
    rankOf: method("rankOf"),
    count: method("count"),
  } as LeaderboardStore;
}
