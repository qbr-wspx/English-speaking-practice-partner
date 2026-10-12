import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const fields = ["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID", "DEEPSEEK_MODEL", "ASR_MODEL", "TTS_MODEL"] as const;
const required = ["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID"];
export class ConfigurationError extends Error {
  constructor(public code: "missing" | "unreadable" | "incomplete", public attempts: number) {
    super(code === "missing"
      ? "未找到本机服务配置。请关闭应用并重新运行最新版安装包；无需在终端手动配置。"
      : code === "incomplete"
        ? "本机服务配置暂时未能完整读取，请点击重新连接；若连续失败，请重新运行最新版安装包。"
        : "本机加密配置读取失败，请点击重新连接；若连续失败，请重新运行最新版安装包。");
  }
}
interface CryptoStore {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  decryptStringAsync(value: Buffer): Promise<{ result: string }>;
  isEncryptionAvailable?(): boolean;
  decryptString?(value: Buffer): string;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("encryption-timeout")), timeoutMs);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function decryptConfiguration(crypto: CryptoStore, encrypted: Buffer, timeoutMs: number): Promise<string> {
  try {
    // On Windows this established API is deterministic once app.whenReady has
    // completed and avoids depending on a delayed async provider callback.
    if (crypto.isEncryptionAvailable?.() && crypto.decryptString) return crypto.decryptString(encrypted);
  } catch {
    // Fall through to the async provider before declaring the file unreadable.
  }
  try {
    if (await withTimeout(crypto.isAsyncEncryptionAvailable(), timeoutMs)) {
      return (await withTimeout(crypto.decryptStringAsync(encrypted), timeoutMs)).result;
    }
  } catch {
    // The caller retries a bounded number of times.
  }
  throw new Error("encryption-unavailable");
}

export async function loadServiceConfigFromFiles(files: string[], crypto: CryptoStore, overrides: Record<string, string | undefined> = {}, delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)), encryptionTimeoutMs = 1500): Promise<Record<string, string>> {
  let lastCode: "missing" | "unreadable" | "incomplete" = "missing";
  for (let attempt = 1; attempt <= 3; attempt++) {
    let sawFile = false;
    let sawUnreadable = false;
    let sawIncomplete = false;
    for (const file of files) {
      if (!existsSync(file)) continue;
      sawFile = true;
      const config: Record<string, string> = {};
      try {
        const encrypted = Buffer.from(readFileSync(file, "utf8"), "base64");
        const value: unknown = JSON.parse(await decryptConfiguration(crypto, encrypted, encryptionTimeoutMs));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-config");
        for (const name of fields) {
          const entry = (value as Record<string, unknown>)[name];
          if (typeof entry === "string") config[name] = entry.trim();
        }
        for (const name of fields) if (overrides[name]?.trim()) config[name] = overrides[name]!.trim();
        if (required.every(name => Boolean(config[name]))) return config;
        sawIncomplete = true;
      } catch {
        // Never surface exception details or a partially decrypted configuration.
        sawUnreadable = true;
      }
    }
    if (!sawFile && required.every(name => Boolean(overrides[name]?.trim()))) return Object.fromEntries(fields.filter(name => overrides[name]?.trim()).map(name => [name, overrides[name]!.trim()]));
    lastCode = sawIncomplete ? "incomplete" : sawUnreadable ? "unreadable" : "missing";
    if (attempt < 3) await delay(250 * attempt);
  }
  throw new ConfigurationError(lastCode, 3);
}

export async function loadServiceConfig(directory: string, crypto: CryptoStore, overrides: Record<string, string | undefined> = {}, delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)), encryptionTimeoutMs = 1500): Promise<Record<string, string>> {
  return loadServiceConfigFromFiles([path.join(directory, "services.bin")], crypto, overrides, delay, encryptionTimeoutMs);
}

export function serviceEnvironment(inherited: NodeJS.ProcessEnv, config: Record<string, string>): NodeJS.ProcessEnv {
  const ownedNames = new Set(Object.keys(config).map(name => name.toUpperCase()));
  // Windows treats environment variable names case-insensitively; Node sorts duplicates.
  return { ...Object.fromEntries(Object.entries(inherited).filter(([name]) => !ownedNames.has(name.toUpperCase()))), ...config };
}
