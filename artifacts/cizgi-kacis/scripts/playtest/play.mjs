/**
 * Plays level 1 of the real web build with a bot, like a person: it aims with finger gestures, looks where the
 * stone stopped, and re-plans from there. Then it joins the world ranking. Writes screenshots and prints findings.
 *
 *   PLAYTEST_MODULES=/path/with/puppeteer node scripts/playtest/play.mjs [outDir]
 * (PLAYTEST_MODULES is a folder where `npm i puppeteer-core @sparticuz/chromium` was run.)
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
const out = process.argv[2] ?? '/tmp/playtest';
mkdirSync(out, { recursive: true });
const planScript = fileURLToPath(new URL('./plan.mts', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:4011/', { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(1200);
await page.screenshot({ path: `${out}/01-start.png` });
if (await page.$('[data-testid="story-continue"]')) { await sleep(2600); await page.screenshot({ path: `${out}/02-story.png` }); await page.click('[data-testid="story-continue"]'); }
await sleep(2300); // the pencil draws the page, then input unlocks

const box = await (await page.$('[data-testid="game-board"]')).boundingBox();
const W = Math.round(box.width), H = Math.round(box.height); // the game's own board size (border included)
const ox = box.x + 1, oy = box.y + 1;
const planFrom = (pos) => JSON.parse(execFileSync('node', ['--experimental-strip-types', planScript, '1', String(W), String(H), ...(pos ? [String(pos.x), String(pos.y)] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop());
const stonePos = () => page.evaluate((bx, by) => {
  const s = [...document.querySelectorAll('[data-testid="game-board"] svg')].find((n) => n.getAttribute('width') === '40' && n.getAttribute('height') === '40');
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: +(r.x + r.width / 2 - bx).toFixed(1), y: +(r.y + r.height / 2 - by).toFixed(1) };
}, ox, oy);
await page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });

async function shoot(shot, index) {
  const strength = Math.min(1, Math.max(0.25, shot.speed / 7.1));
  const radius = 38 * strength; // AIM_PAD_RADIUS
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
  if (index === 0) await page.screenshot({ path: `${out}/03-aiming.png` });
  await page.touchscreen.touchEnd();
  await sleep(Math.max(300, shot.seconds * 450));
  await page.screenshot({ path: `${out}/04-flight-${index + 1}.png` });
  let last = null, still = 0;
  for (let i = 0; i < 80 && still < 4; i += 1) {
    await sleep(150);
    const now = await stonePos();
    still = last && now && Math.hypot(now.x - last.x, now.y - last.y) < 0.6 ? still + 1 : 0;
    last = now;
  }
  return last;
}

let cleared = false;
for (let attempt = 0; attempt < 8 && !cleared; attempt += 1) {
  const pos = attempt === 0 ? null : await stonePos();
  const shots = planFrom(pos);
  if (!shots?.length) { console.log('no plan from', pos); break; }
  console.log(`shot ${attempt + 1}: from ${pos ? `${pos.x},${pos.y}` : 'the start'}, ${shots.length} to go`);
  await shoot(shots[0], attempt);
  cleared = Boolean(await page.$('[data-testid="next-level-button"]'));
}
console.log('level 1 cleared:', cleared);
await sleep(600);
await page.screenshot({ path: `${out}/05-result.png` });
const frames = (await page.evaluate(() => window.__frames.slice(5))).sort((a, b) => a - b);
console.log(`frame times (headless, software rendering): median ${frames[Math.floor(frames.length / 2)].toFixed(1)}ms, p95 ${frames[Math.floor(frames.length * 0.95)].toFixed(1)}ms, max ${frames[frames.length - 1].toFixed(0)}ms`);

const clickText = async (text) => {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent?.trim() === t), text);
  const el = handle.asElement();
  if (el) await el.click();
  return Boolean(el);
};
console.log('ranking invite on the result card:', await clickText('Join the ranking'));
await sleep(1500);
await page.screenshot({ path: `${out}/06-join.png` });
await page.type('[data-testid="nickname-input"]', 'Test Oyuncu');
await page.click('[data-testid="nickname-submit"]');
await sleep(2500);
await page.screenshot({ path: `${out}/07-ranking.png` });
const text = await page.evaluate(() => document.body.innerText);
console.log('your rank card:', text.split('\n').find((l) => /^#\d+/.test(l.trim())), '| other players visible:', ['Mert', 'Deniz', 'Elif'].every((n) => text.includes(n)));
console.log('console errors:', problems.length ? problems.slice(0, 5) : 'none');
await browser.close();
