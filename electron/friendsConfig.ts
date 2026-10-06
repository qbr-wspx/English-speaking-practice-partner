import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

interface CryptoStore {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string }>;
}

export function parseFriendsUrl(value: unknown, allowLoopback = false): string {
  if (typeof value !== "string") throw new Error("朋友版服务地址无效。");
  const url = new URL(value);
  const loopback = allowLoopback && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!(url.protocol === "https:" || loopback) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("朋友版需要安全的 HTTPS 服务地址。");
  }
  return url.origin;
}

export function loadFriendsUrl(resourceDirectory: string, developmentUrl?: string): string | null {
  if (developmentUrl) return parseFriendsUrl(developmentUrl, true);
  const file = path.join(resourceDirectory, "friend-service.json");
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as { url?: unknown };
  return parseFriendsUrl(value.url);
}

export async function loadFriendToken(directory: string, crypto: CryptoStore): Promise<string | null> {
  const file = path.join(directory, "friend-token.bin");
  if (!existsSync(file)) return null;
  if (!await crypto.isAsyncEncryptionAvailable()) throw new Error("当前 Windows 账号无法读取邀请凭据。");
  const token = (await crypto.decryptStringAsync(Buffer.from(readFileSync(file, "utf8"), "base64"))).result;
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) throw new Error("邀请凭据已损坏，请联系邀请人。");
  return token;
}

export async function saveFriendToken(directory: string, token: string, crypto: CryptoStore): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) throw new Error("服务返回了无效的邀请凭据。");
  if (!await crypto.isAsyncEncryptionAvailable()) throw new Error("当前 Windows 账号无法保存邀请凭据。");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "friend-token.bin");
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, (await crypto.encryptStringAsync(token)).toString("base64"));
  renameSync(temporary, file);
}
