import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let outputDir;

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Windows packaging must run on Windows with the bundled Windows backend.");
  }

  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const sourceModels = (await readdir(join(root, "public", "models"))).sort();
  const builtModels = (await readdir(join(root, "dist", "models"))).sort();
  if (JSON.stringify(sourceModels) !== JSON.stringify(builtModels)) {
    throw new Error("Built avatar assets differ from public/models. Rebuild with an empty output directory before packaging.");
  }
  // Build outside the workspace to avoid Windows locking executable rename operations.
  outputDir = await mkdtemp(join(tmpdir(), "cafe-lingo-package-"));
  console.log(`Packaging in: ${outputDir}`);

  await new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("electron-builder/cli.js"),
        "--win",
        "nsis",
        "--publish",
        "never",
        `--config.electronDist=${join(root, "node_modules", "electron", "dist")}`,
        `--config.directories.output=${outputDir}`,
      ],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    child.once("error", rejectBuild);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(`electron-builder failed (${signal ?? `exit code ${code}`}).`));
    });
  });

  const installer = `Cafe-Lingo-Setup-${version}.exe`;
  const artifacts = [installer, `${installer}.blockmap`];
  // Validate all outputs before publishing anything into release/.
  for (const name of artifacts) {
    const details = await stat(join(outputDir, name));
    if (!details.isFile() || details.size === 0) {
      throw new Error(`Missing or empty packaging artifact: ${name}`);
    }
  }

  const releaseDir = join(root, "release");
  await mkdir(releaseDir, { recursive: true });
  for (const name of artifacts) {
    const destination = join(releaseDir, name);
    await copyFile(join(outputDir, name), destination);
    console.log(`Created: ${destination}`);
  }
  console.log(`Build output retained for inspection: ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (outputDir) console.error(`Build output retained for diagnosis: ${outputDir}`);
  process.exitCode = 1;
});
