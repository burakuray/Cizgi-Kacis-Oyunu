# Playtest rig (simulation)

Runs the **real game UI** (the web build) in a phone-sized headless Chromium and lets a bot play it with finger
gestures. The bot uses `lib/solver.ts` (same physics as the game) to plan shots, then looks where the stone
actually stopped and re-plans, like a person would.

```bash
# 1. once: a folder with the browser tooling (Chromium ships inside the npm package)
mkdir -p /tmp/playtest-tools && cd /tmp/playtest-tools && npm init -y && npm i puppeteer-core @sparticuz/chromium

# 2. build the web version pointing at the local test API (use --clear whenever an EXPO_PUBLIC_* value changes!)
cd artifacts/cizgi-kacis
EXPO_PUBLIC_API_URL=http://127.0.0.1:4010 npx expo export --clear --platform web --output-dir /tmp/webplay

# 3. start the test rig (real leaderboard router + seeded players + the web build)
node --experimental-strip-types scripts/playtest/servers.mts /tmp/webplay &

# 4. let the bot play and join the ranking; screenshots land in /tmp/playtest
PLAYTEST_MODULES=/tmp/playtest-tools node scripts/playtest/play.mjs /tmp/playtest
```

What it can tell you: layouts and overlaps on a real screen size, whether a level is clearable by gestures, the
whole leaderboard journey against the real server code, console errors, relative frame times.

What it cannot: how it feels on a phone (GPU, touch latency, haptics, sound), iOS/Android native differences,
very slow devices. Frame times here are software rendering in a headless browser: use them only to compare
before/after, not as phone numbers.

## Play any level, on any screen size

```bash
# one level, seeded progress (no need to play the earlier ones); optional viewport and output folder
PLAN_MODE=none PLAYTEST_MODULES=/tmp/playtest-tools node scripts/playtest/playlevel.mjs 5            # iPhone-ish 390x844
PLAN_MODE=none PLAYTEST_MODULES=/tmp/playtest-tools node scripts/playtest/playlevel.mjs 13 360 640   # small phone
```

It prints shots, deaths and replans, and saves screenshots of the start, every flight and the end.

Things worth knowing when you use it:

- **Real time.** The game runs at real speed, so a level with 6-8 shots takes 1-3 minutes of wall time. Run one level per command.
- **`PLAN_MODE=none`** skips the strict planner passes. They are slow to fail on levels with moving hazards
  (Eraser, pencil, moving bars); the wide search finds a plan in seconds.
- **The clock of moving hazards is an estimate.** The bot sums the planned flight times, so it can be a little off
  on Eraser/pencil pages and may lose a life; it recovers by re-planning.
- **Chromium touch slop.** Chromium swallows touch moves in the first ~15px, so the bot pulls out past it and comes
  back before releasing. A real phone does not need this.
- **After changing an `EXPO_PUBLIC_*` value, rebuild with `--clear`**, otherwise Metro reuses cached code.
- Run-to-run results differ by a few pixels (software rendering stalls): that is why the bot looks where the stone
  stopped and plans again instead of replaying a fixed script.
