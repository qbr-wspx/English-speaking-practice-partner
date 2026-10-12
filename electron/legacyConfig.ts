import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const migrationArgument = '--lingo-migrate-legacy-config';
// MSIX hosts redirect AppData for their children. The cipher also depends on
// that profile's Local State; copying services.bin alone cannot migrate it.
export function legacyProfile(localAppData: string): string {
  return path.join(localAppData, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming', 'english-speaking-companion');
}

export function readLegacyConfiguration(executable: string, directory: string): Promise<Record<string, string> | null> {
  if (!existsSync(path.join(directory, 'services.bin')) || !existsSync(path.join(directory, 'Local State'))) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(executable, [migrationArgument], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|VITE_DEV_SERVER_URL|LINGO_TEST_.*)$/i.test(key))) });
    let output = ''; let finished = false;
    const finish = (value: Record<string, string> | null) => { if (finished) return; finished = true; clearTimeout(timer); output = ''; resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(null); }, 15000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 16384) { child.kill(); finish(null); } });
    child.on('error', () => finish(null));
    child.on('close', code => {
      try {
        const value: unknown = JSON.parse(output);
        if (code !== 0 || !value || typeof value !== 'object' || Array.isArray(value)) return finish(null);
        const config = value as Record<string, string>;
        if (!['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'DASHSCOPE_WORKSPACE_ID'].every(key => typeof config[key] === 'string' && config[key].trim())) return finish(null);
        finish(config);
      } catch { finish(null); }
    });
  });
}

export function saveMigratedConfiguration(directory: string, encrypted: Buffer) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'services.bin');
  if (existsSync(file)) copyFileSync(file, `${file}.before-migration-${Date.now()}`);
  const temporary = `${file}.migrating`;
  writeFileSync(temporary, encrypted.toString('base64'));
  renameSync(temporary, file);
}
