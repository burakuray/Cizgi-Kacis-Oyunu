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
