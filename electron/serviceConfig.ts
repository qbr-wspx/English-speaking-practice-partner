import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const fields = ["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID", "DEEPSEEK_MODEL", "ASR_MODEL", "TTS_MODEL"] as const;
const required = ["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID"];
export class ConfigurationError extends Error {
  constructor(public code: "missing" | "unreadable" | "incomplete", public attempts: number) {
    super(code === "unreadable" ? "本机加密配置读取失败，服务尚未启动。请点击重试；若仍失败，请运行项目的 npm run configure 修复。" : "本机服务预配置不完整，服务尚未启动。请在项目终端运行 npm run configure。");
  }
}
interface CryptoStore {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  decryptStringAsync(value: Buffer): Promise<{ result: string }>;
}
export async function loadServiceConfig(directory: string, crypto: CryptoStore, overrides: Record<string, string | undefined> = {}, delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))): Promise<Record<string, string>> {
  const file = path.join(directory, "services.bin");
  let lastCode: "missing" | "unreadable" | "incomplete" = "missing";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const config: Record<string, string> = {};
    try {
      if (existsSync(file)) {
        // Wait for Electron's OS encryption initialization instead of silently skipping it.
        if (!await crypto.isAsyncEncryptionAvailable()) throw new Error("encryption-unavailable");
        const encrypted = Buffer.from(readFileSync(file, "utf8"), "base64");
        const value: unknown = JSON.parse((await crypto.decryptStringAsync(encrypted)).result);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-config");
        for (const name of fields) {
          const entry = (value as Record<string, unknown>)[name];
          if (typeof entry === "string") config[name] = entry.trim();
        }
        lastCode = "incomplete";
      }
      for (const name of fields) if (overrides[name]?.trim()) config[name] = overrides[name]!.trim();
      if (required.every(name => Boolean(config[name]))) return config;
    } catch {
      // Never surface exception details or a partially decrypted configuration.
      lastCode = "unreadable";
    }
    if (attempt < 3) await delay(250 * attempt);
  }
  throw new ConfigurationError(lastCode, 3);
}

export function serviceEnvironment(inherited: NodeJS.ProcessEnv, config: Record<string, string>): NodeJS.ProcessEnv {
  const ownedNames = new Set(Object.keys(config).map(name => name.toUpperCase()));
  // Windows treats environment variable names case-insensitively; Node sorts duplicates.
  return { ...Object.fromEntries(Object.entries(inherited).filter(([name]) => !ownedNames.has(name.toUpperCase()))), ...config };
}
