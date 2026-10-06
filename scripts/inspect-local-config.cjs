// Diagnostic metadata only: never print decrypted configuration or encryption keys.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('appData'), 'english-speaking-companion'));
app.whenReady().then(async () => {
  const result = { userData: app.getPath('userData'), encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable() };
  for (const name of ['services.bin', 'deepseek-key.bin']) {
    try {
      const encrypted = Buffer.from(fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8'), 'base64');
      const { result: value } = await safeStorage.decryptStringAsync(encrypted);
      result[name] = name === 'services.bin' ? Object.fromEntries(Object.entries(JSON.parse(value)).map(([key, entry]) => [key, typeof entry === 'string' && Boolean(entry.trim())])) : { readable: Boolean(value) };
    } catch { result[name] = { readable: false }; }
  }
  console.log(JSON.stringify(result));
  app.exit();
});
