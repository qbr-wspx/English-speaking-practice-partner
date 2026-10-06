import { _electron as electron, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const directory = path.join(root, '.cache', 'window-recovery-smoke');
await mkdir(directory, { recursive: true });
const env = { ...process.env, DEEPSEEK_API_KEY: 'render-test-only', DASHSCOPE_API_KEY: 'render-test-only', DASHSCOPE_WORKSPACE_ID: 'render-test-only', LINGO_TEST_DATA_DIR: path.join(directory, 'data'), LINGO_TEST_PORT: '18779', VITE_DEV_SERVER_URL: '' };
const app = await electron.launch({ args: [root], cwd: root, env });
const results = {};
try {
  const page = await app.firstWindow();
  await expect(page.getByText('陪练服务已就绪', { exact: true })).toBeVisible({ timeout: 30000 });
  for (const mode of ['hidden', 'minimized']) {
    await app.evaluate(({ BrowserWindow }, state) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (state === 'hidden') window.hide(); else window.minimize();
    }, mode);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, state) => {
      const window = BrowserWindow.getAllWindows()[0];
      return state === 'hidden' ? !window.isVisible() : window.isMinimized();
    }, mode)).toBe(true);
    const second = spawn(require('electron'), [root], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { second.kill(); reject(Error('Second instance did not exit.')); }, 10000);
      second.once('error', error => { clearTimeout(timer); reject(error); });
      second.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length === 1 && windows[0].isVisible() && !windows[0].isMinimized();
    })).toBe(true);
    results[mode] = 'restored existing window';
  }
  results.status = 'passed';
} finally {
  await app.close();
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
