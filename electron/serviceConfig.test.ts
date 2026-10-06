import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigurationError, loadServiceConfig, serviceEnvironment } from "./serviceConfig";

describe("encrypted desktop configuration", () => {
  let directory: string;
  const complete = { DEEPSEEK_API_KEY: "test-deepseek", DASHSCOPE_API_KEY: "test-speech", DASHSCOPE_WORKSPACE_ID: "test-space" };
  beforeEach(() => {
    mkdirSync(".cache", { recursive: true });
    directory = mkdtempSync(path.resolve(".cache/config-test-"));
    writeFileSync(path.join(directory, "services.bin"), Buffer.from("encrypted-test-fixture").toString("base64"));
  });
  afterEach(() => { unlinkSync(path.join(directory, "services.bin")); rmdirSync(directory); });
  function store(value = complete) {
    return { isAsyncEncryptionAvailable: vi.fn().mockResolvedValue(true), decryptStringAsync: vi.fn().mockResolvedValue({ result: JSON.stringify(value) }) };
  }
  it("waits and recovers when OS encryption is temporarily unavailable", async () => {
    const crypto = store(); crypto.isAsyncEncryptionAvailable.mockResolvedValueOnce(false);
    const delay = vi.fn().mockResolvedValue(undefined);
    expect(await loadServiceConfig(directory, crypto, {}, delay)).toEqual(complete);
    expect(delay).toHaveBeenCalledTimes(1);
  });
  it("recovers from a transient read/decrypt failure instead of launching a partial service", async () => {
    const crypto = store(); crypto.decryptStringAsync.mockRejectedValueOnce(new Error("temporary failure"));
    expect(await loadServiceConfig(directory, crypto, {}, async () => {})).toEqual(complete);
  });
  it("reports permanent decryption failure without exposing its details or falling back to partial credentials", async () => {
    const crypto = store(); crypto.decryptStringAsync.mockRejectedValue(new Error("sensitive-provider-detail"));
    const result = await loadServiceConfig(directory, crypto, {}, async () => {}).catch(error => error);
    expect(result).toBeInstanceOf(ConfigurationError);
    expect(result.code).toBe("unreadable"); expect(result.attempts).toBe(3);
    expect(result.message).not.toContain("sensitive-provider-detail");
  });
  it("rejects configuration that lacks speech credentials", async () => {
    const crypto = store({ ...complete, DASHSCOPE_API_KEY: "" });
    await expect(loadServiceConfig(directory, crypto, {}, async () => {})).rejects.toMatchObject({ code: "incomplete" });
  });
  it("excludes unknown fields from decrypted configuration", async () => {
    expect(await loadServiceConfig(directory, store({ ...complete, UNTRUSTED_FIELD: "ignored" } as typeof complete))).toEqual(complete);
  });
  it("removes stale differently-cased environment values on Windows", () => {
    const result = serviceEnvironment({ Path: "system-path", DashScope_Api_Key: "old", DASHSCOPE_API_KEY: "older" }, complete);
    expect(result).toMatchObject({ Path: "system-path", ...complete });
    expect(result).not.toHaveProperty("DashScope_Api_Key");
  });
});
