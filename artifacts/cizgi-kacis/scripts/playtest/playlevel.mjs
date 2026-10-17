/**
 * Plays ONE level of the real web build with a bot and reports shots, deaths and findings.
 *   PLAYTEST_MODULES=/folder/with/puppeteer node scripts/playtest/playlevel.mjs <level> [width height] [outDir]
 * Progress is seeded in localStorage so any level can be opened directly.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const modules = process.env.PLAYTEST_MODULES;
if (!modules) throw new Error('Set PLAYTEST_MODULES to a folder containing puppeteer-core and @sparticuz/chromium');
const require = createRequire(`${modules}/package.json`);
const chromium = (await import(require.resolve('@sparticuz/chromium'))).default;
const puppeteer = (await import(require.resolve('puppeteer-core'))).default;
const level = Number(process.argv[2] ?? 5);
const viewW = Number(process.argv[3] ?? 390), viewH = Number(process.argv[4] ?? 844);
const out = process.argv[5] ?? `/tmp/playtest/level-${level}`;
mkdirSync(out, { recursive: true });
const planScript = fileURLToPath(new URL('./plan.mts', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chapters = ['first-trace', 'thorn-garden', 'portal-room', 'storm-corridor', 'erasers-shadow', 'draft-pages'];
const seeded = { version: 2, bestLevel: Math.max(level + 1, 3), currentLevel: level, seenStory: chapters.flatMap((c) => [`open:${c}`, `end:${c}`]), dayStreak: 1, bestDayStreak: 1, lastPlayedDate: new Date().toLocaleDateString('sv-SE') };

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const page = await browser.newPage();
await page.setViewport({ width: viewW, height: viewH, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((progress) => localStorage.setItem('@cizgi-kacis/progress-v2', JSON.stringify(progress)), seeded);
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message.slice(0, 200)));
await page.goto('http://127.0.0.1:4011/', { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3200); // page-drawing intro
await page.screenshot({ path: `${out}/01-start.png` });

const box = await (await page.$('[data-testid="game-board"]')).boundingBox();
const W = Math.round(box.width), H = Math.round(box.height);
const ox = box.x + 1, oy = box.y + 1;
const origin = { x: W / 2, y: H - 57 };
const label = await page.evaluate(() => [...document.querySelectorAll('div')].map((e) => e.textContent).find((t) => t && /·/.test(t) && t.length < 60 && /First|Thorn|Portal|Storm|Eraser|Draft/.test(t)) ?? '');
console.log(`level ${level} on a ${viewW}x${viewH} screen: board ${W}x${H}; header says: "${label}"`);

const stonePos = () => page.evaluate((bx, by) => {
  const s = [...document.querySelectorAll('[data-testid="game-board"] svg')].find((n) => n.getAttribute('width') === '40' && n.getAttribute('height') === '40');
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: +(r.x + r.width / 2 - bx).toFixed(1), y: +(r.y + r.height / 2 - by).toFixed(1) };
}, ox, oy);
const has = (id) => page.$(`[data-testid="${id}"]`);
const clickText = async (text) => {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent?.trim() === t), text);
  const el = handle.asElement();
  if (el) await el.click();
  return Boolean(el);
};

async function shoot(shot, shotNo) {
  const strength = Math.min(1, Math.max(0.25, shot.speed / 7.1));
  const radius = 38 * strength;
  const ax = ox + W / 2, ay = oy + H * 0.55;
  await page.touchscreen.touchStart(ax, ay);
  await sleep(60);
  // Chromium swallows touch moves inside its ~15px touch-slop zone (a real phone does not), so first pull out
  // past the slop, then come back to the radius we actually want. Only the final position counts for the game.
  const pull = Math.max(radius, 24);
  await page.touchscreen.touchMove(ax + Math.cos(shot.angle) * pull, ay + Math.sin(shot.angle) * pull);
  await sleep(40);
  await page.touchscreen.touchMove(ax + Math.cos(shot.angle) * radius, ay + Math.sin(shot.angle) * radius);
  await sleep(120);
  await page.touchscreen.touchEnd();
  await sleep(Math.max(300, shot.seconds * 450));
  await page.screenshot({ path: `${out}/02-flight-${shotNo}.png` });
  let last = null, still = 0;
  for (let i = 0; i < 90 && still < 4; i += 1) {
    await sleep(150);
    if (await has('next-level-button')) return;
    const now = await stonePos();
    still = last && now && Math.hypot(now.x - last.x, now.y - last.y) < 0.6 ? still + 1 : 0;
    last = now;
  }
}

let shots = 0, deaths = 0, clock = 0, cleared = false, replans = 0, stalls = 0;
let queue = [];
const started = Date.now();
while (shots < 22 && deaths < 6 && !cleared) {
  const pos = await stonePos();
  const atStart = !pos || Math.hypot(pos.x - origin.x, pos.y - origin.y) < 4;
  if (atStart) { clock = 0; queue = []; } // every attempt restarts the hazard clocks
  // keep following the plan while the stone is close to where the plan expected it; otherwise look again
  if (!(queue.length && pos && Math.hypot(pos.x - queue[0].from.x, pos.y - queue[0].from.y) < 20)) {
    replans += 1;
    queue = JSON.parse(execFileSync('node', ['--experimental-strip-types', planScript, String(level), String(W), String(H), String(atStart ? origin.x : pos.x), String(atStart ? origin.y : pos.y), String(clock)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 150000 }).trim().split('\n').pop()) ?? [];
    if (!queue.length) { console.log('  planner found nothing from', pos); break; }
  }
  const shot = queue.shift();
  shots += 1;
  const before = pos;
  console.log(`  shot ${shots}: from ${pos ? `${pos.x},${pos.y}` : 'start'} t=${clock.toFixed(1)}s, ${queue.length} more planned`);
  await shoot(shot, shots);
  clock += shot.seconds;
  const after = await stonePos();
  if (before && after && Math.hypot(after.x - before.x, after.y - before.y) < 2) { stalls += 1; queue = []; console.log('    the stone did not move (stalls:', stalls + ')'); if (stalls >= 3) break; } else stalls = 0;
  cleared = Boolean(await has('next-level-button'));
  if (!cleared && (await clickText('Try again'))) { deaths += 1; clock = 0; queue = []; console.log('    hit a barrier -> retry'); await sleep(500); }
}
await sleep(500);
await page.screenshot({ path: `${out}/03-end.png` });
console.log(`RESULT level ${level}: ${cleared ? 'CLEARED' : 'not cleared'} with ${shots} shots, ${deaths} deaths, ${replans} plans, ${((Date.now() - started) / 1000).toFixed(0)}s wall time; console errors: ${problems.length ? problems.slice(0, 3).join(' | ') : 'none'}`);
await browser.close();
