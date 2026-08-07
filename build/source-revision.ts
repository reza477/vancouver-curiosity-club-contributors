import { execFileSync } from "node:child_process";

const FULL_GIT_REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function readSourceRevision(
  options: Readonly<{
    configuredRevision?: string | null;
    cwd?: string;
    requireClean?: boolean;
  }> = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const requireClean = options.requireClean ?? false;
  const configured = normalizeConfiguredRevision(
    options.configuredRevision ?? process.env.VCC_SOURCE_REVISION ?? null,
  );
  const revision = readGitHead(cwd);

  if (revision === null) {
    if (requireClean) {
      throw new Error(
        "A clean Git working tree is required for a production build, but Git provenance could not be verified.",
      );
    }
    if (configured !== null) return configured;
    throw new Error(
      "A real Git source revision is required to build the Owner backup.",
    );
  }

  if (configured !== null && configured !== revision) {
    throw new Error(
      "VCC_SOURCE_REVISION does not match the checked-out Git HEAD.",
    );
  }

  if (requireClean) {
    const status = readGitStatus(cwd);
    if (status === null) {
      throw new Error(
        "A clean Git working tree is required for a production build, but its status could not be verified.",
      );
    }
    if (status.trim().length > 0) {
      throw new Error(
        "Refusing to build from a dirty Git working tree. Commit or remove all tracked and untracked source changes first.",
      );
    }
    if (readGitHead(cwd) !== revision) {
      throw new Error(
        "Git HEAD changed while build provenance was being verified.",
      );
    }
  }

  return revision;
}

function normalizeConfiguredRevision(input: string | null): string | null {
  if (input === null || input.trim() === "") return null;
  const revision = input.trim().toLowerCase();
  if (!FULL_GIT_REVISION_PATTERN.test(revision)) {
    throw new Error(
      "VCC_SOURCE_REVISION must be a full 40- or 64-character Git revision.",
    );
  }
  return revision;
}

function readGitHead(cwd: string): string | null {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
    return FULL_GIT_REVISION_PATTERN.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

function readGitStatus(cwd: string): string | null {
  try {
    return execFileSync(
      "git",
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return null;
  }
}
