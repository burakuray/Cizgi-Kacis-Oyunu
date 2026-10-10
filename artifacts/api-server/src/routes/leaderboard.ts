import { createLazyDbStore } from "../leaderboard/lazyStore.ts";
import { createLeaderboardRouter } from "../leaderboard/router.ts";

const blocklist = (process.env["NICKNAME_BLOCKLIST"] ?? "")
  .split(",")
  .map((word) => word.trim())
  .filter(Boolean);

export default createLeaderboardRouter({ store: createLazyDbStore(), blocklist });
