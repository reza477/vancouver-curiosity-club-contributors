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
const child = spawn(process.execPath, [vinextCli, action], {
  cwd: projectRoot,
  env: {
    ...process.env,
    WRANGLER_LOG_PATH:
      process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start vinext: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`vinext exited after signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

