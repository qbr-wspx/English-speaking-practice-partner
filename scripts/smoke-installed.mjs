import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const executablePath = process.argv[2];
if (!executablePath) throw Error('Provide the installed executable path.');
const nativeMode = process.argv.includes('--native');
const directory = path.join(process.cwd(), '.cache', nativeMode ? 'installed-native-smoke' : 'installed-smoke');
await mkdir(directory, { recursive: true });
const configFile = path.join(process.env.APPDATA, 'english-speaking-companion', 'services.bin');
const configHash = createHash('sha256').update(await readFile(configFile)).digest('hex');
let app;
if (nativeMode) {
  // Launch the production entry point directly. Attach only AFTER its normal startup;
  // no Electron test loader, mocked keychain, inherited service keys, or delayed ready event.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DEEPSEEK_|DASHSCOPE_|LINGO_|VITE_DEV_SERVER_URL|ASR_MODEL|TTS_MODEL)/i.test(name)));
  const child = spawn(executablePath, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=18788', '--mute-audio'], { cwd: path.dirname(executablePath), env: environment, stdio: 'ignore', windowsHide: true });
  let startupFailure;
  child.once('error', error => { startupFailure = error; });
  for (let attempt = 0; attempt < 90; attempt++) {
    if (startupFailure || child.exitCode !== null) throw Error('Native application failed to launch.');
    const ready = await fetch('http://127.0.0.1:18765/health').then(response => response.json()).catch(() => null);
    if (ready?.deepseek_configured && ready?.speech_configured) break;
    if (attempt === 89) { child.kill(); throw Error('Native startup did not load both configured services.'); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18788');
  app = {
    firstWindow: async () => browser.contexts()[0].pages()[0] || await browser.contexts()[0].waitForEvent('page'),
    close: async () => {
      for (const page of browser.contexts()[0].pages()) await page.close().catch(() => {});
      await browser.close().catch(() => {});
      if (child.exitCode === null) child.kill();
    },
  };
} else app = await electron.launch({ executablePath, args: [], cwd: path.dirname(executablePath), env: { ...process.env, VITE_DEV_SERVER_URL: '' } });
const results = {}, errors = [], fixtureSessions = [];
let page, originalIds;
async function sessions() {
  return page.evaluate(async () => {
    const connection = await window.desktop.getConnection();
    const response = await fetch(`${connection.httpUrl}/api/sessions`, { headers: { Authorization: `Bearer ${connection.token}` } });
    if (!response.ok) throw Error('Could not inspect local sessions.');
    return (await response.json()).map(item => item.id).sort();
  });
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  if (!nativeMode) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
  await expect(page.getByText('陪练服务已就绪', { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.avatar-loading')).toHaveCount(0, { timeout: 30000 });
  originalIds = await sessions();
  results.runtime = nativeMode ? { ...JSON.parse(await readFile(path.join(process.env.APPDATA, 'english-speaking-companion', 'startup-status.json'), 'utf8')), nativeLaunch: true, credentialsFromEnvironment: false, electronTestLoader: false } : await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') }));
  await page.screenshot({ path: path.join(directory, 'home.png') });
  const fixture = (await readFile(path.join(process.cwd(), '.cache', 'voice-preview.wav'))).toString('base64');
  await page.exposeFunction('recordFixtureSession', identifier => fixtureSessions.push(identifier));
  await page.evaluate(async encoded => {
    const OriginalSocket = window.WebSocket;
    window.fixtureSockets = [];
    window.WebSocket = class extends OriginalSocket {
      constructor(...args) {
        super(...args);
        window.fixtureSockets.push(this);
        this.addEventListener('message', event => {
          const packet = JSON.parse(event.data);
          if (packet.type === 'session.ready') window.recordFixtureSession(packet.session_id);
        });
      }
    };
    const context = new AudioContext(), destination = context.createMediaStreamDestination();
    const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    window.playSyntheticSpeech = async () => {
      await context.resume();
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start();
    };
  }, fixture);
  await page.getByRole('button', { name: '开始这个场景' }).click();
  const input = page.getByRole('textbox', { name: '英文输入' });
  await expect(input).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.notice-banner')).toHaveCount(0);
  await page.evaluate(() => window.playSyntheticSpeech());
  await expect(page.locator('.partial-transcript')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.transcript-list .message-row.user')).toHaveCount(1, { timeout: 25000 });
  await expect(input).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.notice-banner')).toHaveCount(0);
  results.cloudSpeechAndReply = true;
  // Replay uses the actual in-memory audio returned by the cloud; repeated stops exercise
  // mouth reset and microphone recovery without generating extra dialogue or API requests.
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '重听回复' }).last().click();
    await expect(page.getByRole('button', { name: '打断', exact: true })).toBeEnabled();
    await page.waitForTimeout(350);
    if (cycle === 0) await page.screenshot({ path: path.join(directory, 'avatar-speaking.png') });
    await page.getByRole('button', { name: '打断', exact: true }).click();
    await expect(input).toBeEnabled({ timeout: 10000 });
  }
  await page.screenshot({ path: path.join(directory, 'avatar-listening.png') });
  await expect(page.locator('.avatar-fallback')).toHaveCount(0);
  results.replayInterruptCycles = 3;
  results.avatarRenderedDuringSpeech = true;
  await page.getByRole('button', { name: '结束并复盘' }).click();
  await expect(page.locator('.review-summary h4').first()).toBeVisible({ timeout: 45000 });
  results.review = true;
  if (errors.length) throw Error(`Renderer error: ${errors.join(';')}`);
  results.status = 'passed';
} catch (error) {
  results.status = 'failed'; results.failure = error.message; process.exitCode = 1;
} finally {
  try { if (page && !page.isClosed()) {
    await page.evaluate(async () => {
      await Promise.all((window.fixtureSockets || []).filter(socket => socket.readyState === WebSocket.OPEN).map(socket => new Promise(resolve => {
        const timer = setTimeout(resolve, 4000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.send(JSON.stringify({ type: 'session.stop' }));
      })));
    });
    for (const identifier of fixtureSessions) {
      if (originalIds?.includes(identifier)) throw Error('Refusing to delete existing user history.');
      await page.evaluate(async id => {
        const connection = await window.desktop.getConnection();
        const response = await fetch(`${connection.httpUrl}/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${connection.token}` } });
        if (!response.ok) throw Error('Could not remove synthetic installation test session.');
      }, identifier);
    }
    results.historyPreserved = originalIds && JSON.stringify(await sessions()) === JSON.stringify(originalIds);
    results.existingSessionCount = originalIds?.length;
  } } catch (error) { results.cleanupFailure = error.message; results.status = 'failed'; process.exitCode = 1; }
  results.configPreserved = configHash === createHash('sha256').update(await readFile(configFile)).digest('hex');
  await app.close();
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (!results.historyPreserved || !results.configPreserved) process.exitCode = 1;
}
