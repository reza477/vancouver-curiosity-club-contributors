import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
const allowedActions = new Set(["build", "dev", "start"]);

if (!action || !allowedActions.has(action)) {
  console.error("Usage: node scripts/run-vinext.mjs <build|dev|start>");
  process.exit(2);
}

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vinextCli = resolve(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const childEnvironment = {
  ...process.env,
  WRANGLER_LOG_PATH:
    process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
};

function runNode(arguments_) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => resolveRun({ code, signal }));
  });
}

function acceptExit(result, label) {
  if (result.signal) {
    console.error(`${label} exited after signal ${result.signal}`);
    process.exitCode = 1;
    return false;
  }
  process.exitCode = result.code ?? 1;
  return result.code === 0;
}

try {
  const vinextResult = await runNode([vinextCli, action]);
  if (acceptExit(vinextResult, "vinext") && action === "build") {
    const relocationResult = await runNode([
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      "import { relocateWorkerOwnedAssetDirectories } from './build/sites-vite-plugin.ts'; await relocateWorkerOwnedAssetDirectories(process.cwd());",
    ]);
    acceptExit(relocationResult, "static asset relocation");
  }
} catch (error) {
  console.error(`Unable to start build tooling: ${error.message}`);
  process.exitCode = 1;
}
