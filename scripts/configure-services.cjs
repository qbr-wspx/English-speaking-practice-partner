const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const directory = path.join(app.getPath('appData'), 'english-speaking-companion');
app.setPath('userData', directory);
app.whenReady().then(async () => {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows encryption is unavailable');
    let previous = {};
    const file = path.join(directory, 'services.bin');
    if (fs.existsSync(file)) previous = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64'))).result);
    let legacy = '';
    const old = path.join(directory, 'deepseek-key.bin');
    if (fs.existsSync(old)) legacy = (await safeStorage.decryptStringAsync(Buffer.from(fs.readFileSync(old, 'utf8'), 'base64'))).result;
    const config = {
      DEEPSEEK_API_KEY: process.env.LINGO_CONFIG_DEEPSEEK?.trim() || previous.DEEPSEEK_API_KEY || legacy,
      DASHSCOPE_API_KEY: process.env.LINGO_CONFIG_DASHSCOPE?.trim() || previous.DASHSCOPE_API_KEY || '',
      DASHSCOPE_WORKSPACE_ID: process.env.LINGO_CONFIG_WORKSPACE?.trim() || previous.DASHSCOPE_WORKSPACE_ID || '',
      DEEPSEEK_MODEL: 'deepseek-v4-flash', ASR_MODEL: 'qwen-audio-3.1-asr-flash-streaming', TTS_MODEL: 'cosyvoice-v3-flash',
    };
    if (!config.DEEPSEEK_API_KEY || !config.DASHSCOPE_API_KEY || !config.DASHSCOPE_WORKSPACE_ID) throw new Error('All three service settings are required');
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, (await safeStorage.encryptStringAsync(JSON.stringify(config))).toString('base64'));
    fs.renameSync(temporary, file);
    console.log('Encrypted configuration saved. Running live service checks...');
    const root = path.resolve(__dirname, '..');
    const child = spawn(path.join(root, '.venv', 'Scripts', 'python.exe'), ['check_services.py'], {
      cwd: path.join(root, 'backend'), env: { ...process.env, ...config, PYTHONIOENCODING: 'utf-8' }, stdio: 'inherit', windowsHide: true,
    });
    child.on('error', () => { console.error('Could not start verifier. Run npm run setup first.'); app.exit(1); });
    child.on('exit', code => app.exit(code ?? 1));
  } catch (error) {
    console.error('Configuration failed:', error.message.includes('required') ? error.message : 'Unable to read or encrypt local service configuration.');
    app.exit(1);
  }
});
