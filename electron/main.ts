import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { ConfigurationError, loadServiceConfigFromFiles, serviceEnvironment } from "./serviceConfig";
import { loadFriendsUrl, loadFriendToken, saveFriendToken } from "./friendsConfig";
import { legacyProfile, migrationArgument, readLegacyConfiguration, saveMigratedConfiguration } from "./legacyConfig";

const isMigrationWorker = process.argv.includes(migrationArgument);
const oldProfile = legacyProfile(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'));

const requestedTestPort = Number(process.env.LINGO_TEST_PORT);
const BACKEND_PORT = !app.isPackaged && process.env.LINGO_TEST_DATA_DIR && Number.isInteger(requestedTestPort) && requestedTestPort > 1024 && requestedTestPort < 65536 ? requestedTestPort : 18765;
const friendsUrl = loadFriendsUrl(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."), !app.isPackaged ? process.env.LINGO_FRIENDS_SERVICE_URL : undefined);
app.setPath("userData", isMigrationWorker ? oldProfile : !app.isPackaged && process.env.LINGO_TEST_DATA_DIR || path.join(app.getPath("appData"), friendsUrl ? "english-speaking-companion-friends" : "english-speaking-companion"));
const backendToken = randomBytes(32).toString("hex");
let friendToken: string | null = null;
let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendState: "stopped" | "starting" | "ready" | "error" = "stopped";
let backendMessage = "";
let startupPromise: Promise<{ state: string; message: string }> | null = null;
let loadedConfig: Record<string, string> | null = null;

function recordStartup(stage: string, extra: Record<string, string | number | boolean> = {}) {
  try {
    const directory = app.getPath("userData");
    mkdirSync(directory, { recursive: true });
    // Deliberately allow only our own fixed status fields; never record secrets or raw errors.
    writeFileSync(path.join(directory, "startup-status.json"), JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), executable: process.execPath, stage, ...extra }, null, 2));
    const log = path.join(directory, 'startup-events.jsonl');
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, version: app.getVersion(), stage, ...extra }) + '\n');
  } catch { /* Diagnostics must not prevent startup. */ }
}

function getBackendStatus() {
  return { state: backendState, message: backendMessage };
}

async function waitForBackend(expectedProcess = backendProcess): Promise<boolean> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (!expectedProcess || expectedProcess !== backendProcess || expectedProcess.exitCode !== null) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/health`);
      if (response.ok) {
        const health = await response.json() as { version?: string; instance_id?: string; deepseek_configured?: boolean; speech_configured?: boolean };
        if (health.version !== app.getVersion()) {
          backendState = "error";
          backendMessage = "另一个版本的语音服务仍在运行，请关闭旧版 Café Lingo 后重新打开。";
          return false;
        }
        if (health.instance_id !== createHash("sha256").update(backendToken).digest("hex").slice(0, 16)) {
          backendState = "error"; backendMessage = "另一份本机服务占用了端口，请关闭旧应用后重新启动。"; return false;
        }
        if (!health.deepseek_configured || !health.speech_configured) {
          backendState = "error"; backendMessage = "后端未完整载入本机配置，服务尚未就绪。请点击重试。";
          recordStartup("backend-config-mismatch", { deepseek: Boolean(health.deepseek_configured), speech: Boolean(health.speech_configured) });
          return false;
        }
        return true;
      }
    } catch {
      // The local service may still be importing its dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

function startBackend(): Promise<{ state: string; message: string }> {
  if (!startupPromise) startupPromise = (friendsUrl ? startFriendsBackend() : startBackendOnce())
    .catch(() => {
      backendState = "error";
      backendMessage = "本机服务启动遇到临时问题，请点击重新连接。";
      recordStartup("startup-failed");
      return getBackendStatus();
    })
    .finally(() => { startupPromise = null; });
  return startupPromise;
}

async function startFriendsBackend(): Promise<{ state: string; message: string }> {
  backendState = "starting";
  backendMessage = "正在连接陪练服务…";
  try {
    friendToken = friendToken || await loadFriendToken(app.getPath("userData"), safeStorage);
    if (!friendToken) {
      backendState = "error"; backendMessage = "首次使用请输入邀请码。";
      return { state: "needs-invite", message: backendMessage };
    }
    const response = await fetch(`${friendsUrl}/api/scenarios`, { headers: { Authorization: `Bearer ${friendToken}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) {
      backendState = "error"; backendMessage = "邀请凭据已失效，请联系邀请人。";
      return { state: "needs-invite", message: backendMessage };
    }
    if (!response.ok) throw new Error("service-unavailable");
    backendState = "ready"; backendMessage = "陪练服务已就绪";
    recordStartup("ready", { remote: true });
  } catch {
    backendState = "error"; backendMessage = "在线服务暂时无法连接，请稍后重试。";
    recordStartup("remote-unavailable");
  }
  return getBackendStatus();
}

async function startBackendOnce(): Promise<{ state: string; message: string }> {
  if (backendProcess && !backendProcess.killed && backendState === "ready") {
    return { state: backendState, message: backendMessage };
  }
  backendState = "starting";
  backendMessage = "正在读取本机加密配置…";
  recordStartup("configuration-reading");
  let config: Record<string, string>;
  try {
    const configFiles = Array.from(new Set([
      path.join(app.getPath("userData"), "services.bin"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "english-speaking-companion", "services.bin") : "",
      path.join(homedir(), "AppData", "Roaming", "english-speaking-companion", "services.bin"),
    ].filter(Boolean)));
    if (app.isPackaged) configFiles.push(path.join(process.resourcesPath, "local-config.bin"));
    recordStartup("configuration-locations", {
      candidates: configFiles.length,
      available: configFiles.filter(file => existsSync(file)).length,
      packagedFallback: app.isPackaged && existsSync(path.join(process.resourcesPath, "local-config.bin")),
    });
    try {
      config = loadedConfig || await loadServiceConfigFromFiles(configFiles, safeStorage, !app.isPackaged && process.env.LINGO_TEST_DATA_DIR ? process.env : {});
    } catch (originalError) {
      if (!app.isPackaged) throw originalError;
      const migrated = await readLegacyConfiguration(process.execPath, oldProfile);
      if (!migrated) throw originalError;
      saveMigratedConfiguration(app.getPath('userData'), safeStorage.encryptString(JSON.stringify(migrated)));
      config = await loadServiceConfigFromFiles([path.join(app.getPath('userData'), 'services.bin')], safeStorage);
      // Keep prior practice history when the real desktop profile is still new.
      const database = path.join(app.getPath('userData'), 'cafe-lingo.db');
      if (!existsSync(database) && existsSync(path.join(oldProfile, 'cafe-lingo.db'))) copyFileSync(path.join(oldProfile, 'cafe-lingo.db'), database);
      recordStartup('configuration-migrated');
    }
    loadedConfig = config;
    recordStartup("configuration-loaded");
  } catch (error) {
    backendState = "error";
    backendMessage = error instanceof ConfigurationError ? error.message : "本机配置暂时无法读取，请点击重试。";
    recordStartup("configuration-failed", { code: error instanceof ConfigurationError ? error.code : "unknown", attempts: error instanceof ConfigurationError ? error.attempts : 0 });
    return getBackendStatus();
  }
  if (backendProcess && backendProcess.exitCode === null) {
    const previous = backendProcess; backendProcess = null;
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 3000); previous.once("exit", () => { clearTimeout(timer); resolve(); }); previous.kill(); });
  }

  const projectRoot = path.resolve(__dirname, "..");
  const backendDir = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "CafeLingoBackend")
    : path.join(projectRoot, "backend");
  const venvPython = path.join(projectRoot, ".venv", "Scripts", "python.exe");
  const backendExecutable = app.isPackaged
    ? path.join(backendDir, "CafeLingoBackend.exe")
    : existsSync(venvPython)
      ? venvPython
      : "python";
  const backendArgs = app.isPackaged
    ? []
    : ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT), "--no-access-log"];
  const dataDir = app.getPath("userData");

  backendState = "starting";
  backendMessage = "正在启动本地语音服务…";
  const child = spawn(
    backendExecutable,
    backendArgs,
    {
      cwd: backendDir,
      env: {
        ...serviceEnvironment(process.env, config),
        LINGO_BACKEND_TOKEN: backendToken,
        LINGO_APP_VERSION: app.getVersion(),
        APP_DATA_DIR: dataDir,
        BACKEND_PORT: String(BACKEND_PORT),
      },
      windowsHide: true,
    },
  );
  backendProcess = child;

  child.stdout.on("data", (data) => console.log(`[backend] ${String(data).trim()}`));
  child.stderr.on("data", (data) => console.error(`[backend] ${String(data).trim()}`));
  child.on("error", () => {
    if (backendProcess !== child) return;
    backendState = "error";
    backendMessage = "无法启动本地语音服务，请检查安装文件是否完整。";
  });
  child.on("exit", (code) => {
    if (backendProcess !== child) return;
    backendProcess = null;
    recordStartup('backend-exited', { exitCode: code ?? -1 });
    if (backendState !== "stopped") {
      backendState = code === 0 ? "stopped" : "error";
      backendMessage = code === 0 ? "服务已停止" : `后端异常退出（${code ?? "unknown"}）`;
    }
  });

  if (await waitForBackend(child)) {
    backendState = "ready";
    backendMessage = "本地语音服务已就绪";
    recordStartup("ready", { deepseek: true, speech: true });
  } else if (getBackendStatus().state !== "error") {
    backendState = "error";
    backendMessage = "后端启动超时，请检查 Python 依赖";
  }
  if (backendState === "error") { backendProcess = null; child.kill(); }
  return { state: backendState, message: backendMessage };
}

function registerIpc() {
  ipcMain.handle("backend:connection", () => friendsUrl ? { httpUrl: friendsUrl, wsUrl: `${friendsUrl.replace(/^http/, "ws")}/ws/conversation`, token: friendToken || "", remote: true } : { httpUrl: `http://127.0.0.1:${BACKEND_PORT}`, wsUrl: `ws://127.0.0.1:${BACKEND_PORT}/ws/conversation`, token: backendToken, remote: false });
  ipcMain.handle("backend:start", () => startBackend());
  ipcMain.handle("backend:status", getBackendStatus);
  ipcMain.handle("friends:redeem", async (_event, code: unknown) => {
    if (!friendsUrl) return { state: "error", message: "此安装版不需要邀请码。" };
    if (typeof code !== "string" || !/^LS-[A-Za-z0-9_-]{20,50}$/.test(code.trim())) return { state: "error", message: "请输入完整的邀请码。" };
    try {
      const response = await fetch(`${friendsUrl}/v1/invite/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { state: "error", message: response.status === 403 ? "邀请码无效或已使用，请联系邀请人。" : response.status === 429 ? "尝试次数过多，请稍后再试。" : "邀请码验证失败，请稍后重试。" };
      const body = await response.json() as { token?: string };
      if (!body.token) throw new Error("invalid-token");
      await saveFriendToken(app.getPath("userData"), body.token, safeStorage);
      friendToken = body.token;
      return startBackend();
    } catch {
      return { state: "error", message: "暂时无法验证邀请码，请检查网络后重试。" };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: app.isPackaged || process.env.LINGO_TEST_HEADLESS !== "1",
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "Lingo Studio · 英语口语陪练",
    backgroundColor: "#f2f5f8",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f2f5f8", symbolColor: "#17324d", height: 42 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !process.env.LINGO_TEST_DATA_DIR,
    },
  });

  const window = mainWindow;
  window.once("ready-to-show", () => {
    if (!window.isDestroyed() && (app.isPackaged || process.env.LINGO_TEST_HEADLESS !== "1")) window.show();
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

const ownsAppInstance = !isMigrationWorker && app.requestSingleInstanceLock();
if (isMigrationWorker) {
  app.whenReady().then(async () => {
    try {
      const config = await loadServiceConfigFromFiles([path.join(oldProfile, 'services.bin')], safeStorage);
      // Private parent/child pipe only: never log or persist plaintext.
      process.stdout.write(JSON.stringify(config), () => app.exit(0));
    } catch { app.exit(1); }
  });
}
else if (!ownsAppInstance) app.quit();
else app.whenReady().then(async () => {
  recordStartup("desktop-ready");
  registerIpc();
  createWindow();
  void startBackend();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (!app.isReady()) return; // The first launch will show its window when ready.
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});

app.on("window-all-closed", () => {
  backendState = "stopped";
  backendProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});
