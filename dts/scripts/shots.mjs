/** Captures the interface figures used in Chapter Four. */
import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'admin@ubth.edu.ng');
  await page.fill('#password', 'Admin@2026');
  await page.click('button[type=submit]');
  // router.replace is a client-side navigation, so wait for the
  // dashboard itself rather than for a page load event.
  await page.waitForSelector('h1:has-text("Dashboard")', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function shot(name, full = true) {
  await page.mouse.move(2, 2);            // keep stray tooltips out of the capture
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: full });
  console.log('  captured', name);
}

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot('01-sign-in', false);

await signIn(page);
await shot('02-dashboard');

await page.goto(`${BASE}/analysis`, { waitUntil: 'networkidle' });
await page.waitForSelector('.recharts-surface', { timeout: 20000 });
await shot('03-analysis-all');

for (const [name, label] of [['04-analysis-malaria','Malaria'], ['05-analysis-lassa','Lassa Fever']]) {
  await page.selectOption('#disease', { label });
  await page.waitForTimeout(1800);
  await shot(name);
}

await page.goto(`${BASE}/alerts`, { waitUntil: 'networkidle' });
await page.waitForSelector('table', { timeout: 20000 });
await shot('06-signals');

await page.goto(`${BASE}/entry`, { waitUntil: 'networkidle' });
await page.waitForSelector('.entry-grid table', { timeout: 20000 });
await shot('07-monthly-return');

await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForSelector('table', { timeout: 20000 });
await shot('08-administration');

// a phone, because a medical officer will open this on one
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await signIn(mp);
await mp.mouse.move(2, 2);
await mp.waitForTimeout(1600);
await mp.screenshot({ path: 'screenshots/09-dashboard-mobile.png', fullPage: true });
console.log('  captured 09-dashboard-mobile');

await browser.close();
console.log('Done.');
