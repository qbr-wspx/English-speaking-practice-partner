import { describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { readLegacyConfiguration, saveMigratedConfiguration } from './legacyConfig';
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true }); });
function profile() { const directory = mkdtempSync(path.join(tmpdir(), 'lingo-migrate-test-')); directories.push(directory); writeFileSync(path.join(directory, 'services.bin'), 'ciphertext'); writeFileSync(path.join(directory, 'Local State'), '{}'); return directory; }
function worker(output: string, code = 0) {
  vi.mocked(spawn).mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
    setTimeout(() => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', code); }, 0);
    return child as unknown as ReturnType<typeof spawn>;
  });
}
describe('profile-aware configuration migration', () => {
  it('rejects partial or failed worker output', async () => {
    worker('{"DEEPSEEK_API_KEY":"fixture"}');
    expect(await readLegacyConfiguration('app.exe', profile())).toBeNull();
    worker('{"DEEPSEEK_API_KEY":"a","DASHSCOPE_API_KEY":"b","DASHSCOPE_WORKSPACE_ID":"c"}', 1);
    expect(await readLegacyConfiguration('app.exe', profile())).toBeNull();
  });
  it('accepts validated private worker output', async () => {
    const config = { DEEPSEEK_API_KEY:'fixture-a', DASHSCOPE_API_KEY:'fixture-b', DASHSCOPE_WORKSPACE_ID:'fixture-c' };
    worker(JSON.stringify(config));
    expect(await readLegacyConfiguration('app.exe', profile())).toEqual(config);
    expect(vi.mocked(spawn).mock.lastCall?.[2]).toMatchObject({ windowsHide:true, stdio:['ignore','pipe','ignore'] });
  });
  it('backs up prior ciphertext and atomically writes newly encrypted bytes', () => {
    const directory = profile();
    saveMigratedConfiguration(directory, Buffer.from('new-encrypted-fixture'));
    expect(readFileSync(path.join(directory,'services.bin'),'utf8')).toBe(Buffer.from('new-encrypted-fixture').toString('base64'));
    const backup = readdirSync(directory).find(name => name.startsWith('services.bin.before-migration-'))!;
    expect(readFileSync(path.join(directory,backup),'utf8')).toBe('ciphertext');
    expect(readdirSync(directory)).not.toContain('services.bin.migrating');
  });
});
