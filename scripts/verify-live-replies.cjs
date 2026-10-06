// Opt-in API smoke test. Uses the app's existing DPAPI storage without displaying
// the key, copying it to a file, or putting it on the process command line.
const { app, safeStorage } = require("electron");
const { readFileSync, existsSync } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");

// Chromium's encryption context is loaded from this application's Local State.
app.setPath("userData", path.join(app.getPath("appData"), "english-speaking-companion"));

app.whenReady().then(() => {
  let stage = "read-stored-key";
  try {
    const directory = app.getPath("userData");
    const servicesFile = path.join(directory, "services.bin");
    const config = existsSync(servicesFile) ? JSON.parse(safeStorage.decryptString(Buffer.from(readFileSync(servicesFile, "utf8"), "base64"))) : {};
    const keyFile = path.join(directory, "deepseek-key.bin");
    const encrypted = config.DEEPSEEK_API_KEY ? null : Buffer.from(readFileSync(keyFile, "utf8"), "base64");
    stage = "decrypt-stored-key";
    const key = config.DEEPSEEK_API_KEY || safeStorage.decryptString(encrypted);
    stage = "start-verifier";
    const root = path.resolve(__dirname, "..");
    const child = spawn(path.join(root, ".venv", "Scripts", "python.exe"), [process.argv.includes("--scenarios") ? "check_live_scenarios.py" : "check_live_replies.py"], {
      cwd: path.join(root, "backend"),
      env: { ...process.env, DEEPSEEK_API_KEY: key, DEEPSEEK_MODEL: config.DEEPSEEK_MODEL || "deepseek-v4-flash", PYTHONIOENCODING: "utf-8" },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", () => { console.error("Could not start the live verification process."); app.exit(1); });
    child.on("exit", (code) => app.exit(code ?? 1));
  } catch (error) {
    console.error(`Live verification unavailable at ${stage} (${error.code || error.name}); encryption available: ${safeStorage.isEncryptionAvailable()}. No key was displayed.`);
    app.exit(1);
  }
});
