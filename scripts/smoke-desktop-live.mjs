import { _electron as electron, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), directory = path.join(root, '.cache', 'desktop-live');
await mkdir(directory, { recursive: true });
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, LINGO_TEST_DATA_DIR: path.join(directory, 'data'), LINGO_TEST_PORT: '18776', LINGO_TEST_HEADLESS: '1', VITE_DEV_SERVER_URL: '' } });
const results = {}, errors = [];
try {
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
  await expect(page.getByText('陪练服务已就绪', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.avatar-loading')).toHaveCount(0, { timeout: 30000 });
  // A synthetic stream exercises AudioWorklet and VAD without recording the user.
  const fixture = (await readFile(path.join(root, '.cache', 'voice-preview.wav'))).toString('base64');
  await page.evaluate(async encoded => {
    const context = new AudioContext(); const destination = context.createMediaStreamDestination();
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); const buffer = await context.decodeAudioData(bytes.buffer);
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    window.playSyntheticSpeech = async () => { await context.resume(); const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start(); };
  }, fixture);
  await page.getByRole('button', { name: '开始这个场景' }).click();
  const input = page.getByRole('textbox', { name: '英文输入' });
  await expect(input).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.notice-banner')).toHaveCount(0);
  const begin = Date.now(); await page.evaluate(() => window.playSyntheticSpeech());
  await expect(page.locator('.partial-transcript')).toBeVisible({ timeout: 20000 });
  results.partialSubtitles = true;
  await expect(page.locator('.transcript-list .message-row.user')).toHaveCount(1, { timeout: 25000 });
  await expect(input).toBeEnabled({ timeout: 45000 });
  results.voiceRoundSeconds = Number(((Date.now() - begin) / 1000).toFixed(2));
  await page.screenshot({ path: path.join(directory, 'practice.png') });
  const replay = page.getByRole('button', { name: '重听回复' }).last();
  await replay.click(); await expect(input).toBeDisabled();
  await page.getByRole('button', { name: '打断', exact: true }).click(); await expect(input).toBeEnabled({ timeout: 5000 });
  results.replayAndInterrupt = true;
  await input.fill('A medium latte to go, please.'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '打断', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '打断', exact: true }).click(); await expect(input).toBeEnabled({ timeout: 5000 });
  results.interruptProcessing = true;
  await input.fill('A small latte, please.'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(input).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: '结束并复盘' }).click();
  await expect(page.locator('.review-summary h4').first()).toBeVisible({ timeout: 45000 });
  await page.screenshot({ path: path.join(directory, 'review.png') }); results.savedHistoryAndReview = true;
  await page.getByRole('button', { name: '再练一次', exact: true }).click();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic permission rejection', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: '开始这个场景' }).click();
  await expect(page.locator('.notice-banner')).toBeVisible({ timeout: 45000 }); await expect(input).toBeEnabled({ timeout: 45000 });
  results.restartAndDeniedMicrophone = true;
  await page.getByRole('button', { name: '结束并复盘' }).click();
  await expect(page.locator('.review-summary h4').first()).toBeVisible({ timeout: 45000 });
  if (errors.length) throw Error('Renderer error: ' + errors.join(';'));
  results.status = 'passed'; console.log(JSON.stringify(results));
} catch (e) {
  results.status = 'failed'; results.failure = e.message;
  const current = app.windows()[0]; if (current && !current.isClosed()) await current.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  console.error(e.message); process.exitCode = 1;
} finally { await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2)); await app.close(); }
