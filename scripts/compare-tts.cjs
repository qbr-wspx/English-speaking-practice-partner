const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

app.setPath('userData', path.join(app.getPath('appData'), 'english-speaking-companion'));
app.whenReady().then(async () => {
  try {
    await safeStorage.isAsyncEncryptionAvailable();
    const secretPath = path.join(app.getPath('userData'), 'services.bin');
    const config = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(fs.readFileSync(secretPath, 'utf8'), 'base64'))).result);
    const root = path.resolve(__dirname, '..');
    const child = spawn(path.join(root, '.venv', 'Scripts', 'python.exe'), ['scripts/compare-tts.py'], {
      cwd: root, env: { ...process.env, ...config }, stdio: 'inherit', windowsHide: true,
    });
    child.on('error', () => { console.error('TTS comparison could not start.'); app.exit(1); });
    child.on('exit', code => app.exit(code ?? 1));
  } catch {
    console.error('Local encrypted service configuration unavailable.');
    app.exit(1);
  }
});
