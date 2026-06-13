// Regenerate the README screenshots in docs/images/.
//
// Drives the real built app (Flask serving circuitscope/static/) in headless
// Chrome via playwright-core, so the shots always reflect the current UI.
//
// Usage:
//   python -m circuitscope.server /tmp/d3_surface.stim --no-browser --port 8079 &
//   node scripts/readme-screenshots.mjs [base-url]
//
// where the circuit is e.g. stim.Circuit.generated('surface_code:rotated_memory_z',
// distance=3, rounds=3, ...noise...). Requires Google Chrome installed.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8079';
const OUT = new URL('../docs/images/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(BASE);
// Wait for the preloaded circuit to finish analyzing (detector cards appear).
await page.getByRole('button', { name: /^D0/ }).waitFor({ timeout: 30000 });

// --- Timeline view with a detector selected -------------------------------
await page.getByRole('button', { name: /^D13/ }).click();
await page.waitForTimeout(900); // one-shot highlight fade-in
await page.screenshot({ path: `${OUT}timeline.png` });
console.log('wrote timeline.png');

// --- Compare view with measured data and the parameter fit ----------------
// Import measured fractions sampled from a perturbed copy of the circuit
// (3x the reset/measure flip rate), exactly as an experimentalist would
// paste in a CSV from a real run.
await page.evaluate(async () => {
  const init = await (await fetch('/api/initial')).json();
  const perturbed = init.circuit_text.replaceAll(/X_ERROR\(([\d.]+)\)/g, (_, p) => `X_ERROR(${3 * Number(p)})`);
  const mc = await (await fetch('/api/montecarlo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ circuit_text: perturbed, shots: 1000000, seed: 11 }),
  })).json();
  window.__csv = ['shots, 1000000', ...mc.fractions.map((f, i) => `D${i}, ${f.toFixed(7)}`)].join('\n');
});
await page.getByRole('button', { name: /^(Import data|Data ✓)$/ }).click();
const textarea = page.locator('textarea');
await textarea.waitFor();
await textarea.fill(await page.evaluate(() => window.__csv));
await page.getByRole('button', { name: 'Apply data' }).click();
await page.getByRole('button', { name: 'Compare', exact: true }).click();
await page.getByText('Full least-squares fit').waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}compare.png` });
console.log('wrote compare.png');

// --- Analysis view: formula, sliders, sensitivities ------------------------
await page.getByRole('button', { name: 'Analysis', exact: true }).click();
await page.getByText('Sensitivity').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}analysis.png` });
console.log('wrote analysis.png');

await browser.close();
