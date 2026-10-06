import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), directory = path.join(root, '.cache', 'config-failure-smoke');
await mkdir(directory, { recursive: true });
// A deliberately invalid encrypted fixture, in an isolated profile only.
const file = path.join(directory, 'services.bin');
await writeFile(file, Buffer.from('not-an-encrypted-configuration').toString('base64'));
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DEEPSEEK_|DASHSCOPE_|LINGO_|ASR_MODEL|TTS_MODEL)/i.test(name)));
const app = await electron.launch({ args: [root], cwd: root, env: { ...environment, LINGO_TEST_DATA_DIR: directory, LINGO_TEST_PORT: '18779', LINGO_TEST_HEADLESS: '1', VITE_DEV_SERVER_URL: '' } });
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('alert')).toContainText('本机加密配置读取失败', { timeout: 15000 });
  await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  const status = JSON.parse(await readFile(path.join(directory, 'startup-status.json'), 'utf8'));
  if (status.stage !== 'configuration-failed' || status.code !== 'unreadable') throw Error('Missing safe failure diagnostic.');
  const backendRunning = await fetch('http://127.0.0.1:18779/health', { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false);
  if (backendRunning) throw Error('An incompletely configured backend was started.');
  console.log(JSON.stringify({ status: 'passed', clearConfigurationError: true, incompleteBackendBlocked: true, noUserConfigurationModified: true }));
} finally { await app.close(); await unlink(file); }
