/**
 * Local test rig: the REAL leaderboard router (in-memory store, seeded with a few players) on :4010 and the
 * static web build on :4011. Usage: node --experimental-strip-types scripts/playtest/servers.mts [webBuildDir]
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const apiRoot = resolve(here, '../../../api-server');
const express = createRequire(join(apiRoot, 'package.json'))('express') as typeof import('express');
const { createMemoryStore } = await import(join(apiRoot, 'src/leaderboard/memoryStore.ts'));
const { createLeaderboardRouter, jsonErrorHandler } = await import(join(apiRoot, 'src/leaderboard/router.ts'));

const api = express();
api.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Player-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
api.use(express.json({ limit: '16kb' }));
const store = createMemoryStore();
api.use('/api', createLeaderboardRouter({ store, limits: { registerPerHour: 1000, submitPerMinute: 1000, readPerMinute: 1000 } }));
api.use(jsonErrorHandler);
api.listen(4010, '127.0.0.1');

const seeded: Array<[string, number, number]> = [['Ayşe', 5200, 8], ['Mert', 4300, 7], ['Deniz', 3100, 6], ['Elif', 2000, 5], ['Kaan', 1450, 4], ['Zeynep', 900, 3], ['Can', 520, 2]];
for (const [nickname, score, levels] of seeded) {
  const player = await store.createPlayer({ nickname, secretHash: createHash('sha256').update(nickname).digest('hex') });
  await store.setScore(player.id, { score, levelsCleared: levels, stars: levels * 2, bestLevel: levels + 1 });
}

const root = resolve(process.argv[2] ?? '/tmp/webplay');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
createServer((req, res) => {
  let file = join(root, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback for expo-router
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(4011, '127.0.0.1');
console.log(`ready: game http://127.0.0.1:4011 (build: ${root}), API http://127.0.0.1:4010/api`);
