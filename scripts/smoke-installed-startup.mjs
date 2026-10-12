import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const executable = process.argv[2];
const cycles = Number(process.argv[3] || 3);
if (!executable || !Number.isInteger(cycles) || cycles < 1 || cycles > 5) throw Error('Provide the installed executable and 1-5 cycles.');
const output = path.join(process.cwd(), '.cache', 'installed-startup-ui');
await mkdir(output, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DEEPSEEK_|DASHSCOPE_|LINGO_|VITE_DEV_SERVER_URL|ASR_MODEL|TTS_MODEL)/i.test(name)));
const results = [];

for (let cycle = 1; cycle <= cycles; cycle++) {
  const port = 18820 + cycle;
  const started = Date.now();
  const child = spawn(executable, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, '--mute-audio'], { cwd: path.dirname(executable), env: environment, stdio: 'ignore', windowsHide: true });
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    if (!browser) throw Error(`Cycle ${cycle}: desktop debugging endpoint did not start.`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await expect(page.getByText('陪练服务已就绪', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.scenario-tile')).toHaveCount(8, { timeout: 30000 });
    await expect(page.getByText('练习室未能连接。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.page-error')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, `cycle-${cycle}.png`) });
    const status = JSON.parse(await readFile(path.join(process.env.APPDATA, 'english-speaking-companion', 'startup-status.json'), 'utf8'));
    if (status.stage !== 'ready' || status.executable !== executable) throw Error(`Cycle ${cycle}: startup record is not ready.`);
    results.push({ cycle, version: status.version, scenarioCards: 8, errorBanner: false, startupSeconds: Number(((Date.now() - started) / 1000).toFixed(2)) });
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.exitCode === null ? child.once('exit', resolve) : resolve());
  }
}

await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
