import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsRoot = resolve(projectRoot, "tests");
const supportedExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTests(absolutePath)));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.includes(".test.") &&
      supportedExtensions.has(extname(entry.name))
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

const testFiles = (await collectTests(testsRoot)).sort();
if (testFiles.length === 0) {
  console.error("No foundation tests were found.");
  process.exit(2);
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`Unable to start tests: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Tests exited after signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

