import { access, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import {
  WORKER_ASSET_ORIGIN_PREFIX,
  WORKER_OWNED_ASSET_DIRECTORIES,
  publicAssetOriginPath,
} from "../lib/public-asset-cache";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

type RelativeFile = Readonly<{
  absolutePath: string;
  relativePath: string;
}>;

async function listFilesRecursively(
  directory: string,
  relativeDirectory = "",
): Promise<RelativeFile[]> {
  if (!(await exists(directory))) return [];

  const files: RelativeFile[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

export async function relocateWorkerOwnedAssetDirectories(
  root: string,
): Promise<void> {
  const clientDirectory = resolve(root, "dist", "client");
  const originDirectory = resolve(
    clientDirectory,
    WORKER_ASSET_ORIGIN_PREFIX.slice(1),
  );
  // Workers Sites serves this Pages-style metadata file as public bytes rather
  // than applying it. vinext generates one during the client build, so remove
  // it from the final artifact instead of exposing a misleading /_headers URL.
  await rm(resolve(clientDirectory, "_headers"), { force: true });
  await mkdir(originDirectory, { recursive: true });

  const relocatedDirectoryCounts = new Map<string, number>();

  for (const directory of WORKER_OWNED_ASSET_DIRECTORIES) {
    const sourceDirectory = resolve(clientDirectory, directory);
    const targetDirectory = resolve(originDirectory, directory);
    const sourceFiles = await listFilesRecursively(sourceDirectory);
    const ownedFiles = sourceFiles.filter(
      (file) =>
        publicAssetOriginPath({
          method: "GET",
          pathname: `/${directory}/${file.relativePath}`,
        }) !== null,
    );

    if (ownedFiles.length > 0) {
      await rm(targetDirectory, { recursive: true, force: true });
      await mkdir(targetDirectory, { recursive: true });
      for (const file of ownedFiles) {
        const targetPath = resolve(targetDirectory, file.relativePath);
        await mkdir(dirname(targetPath), { recursive: true });
        await rename(
          file.absolutePath,
          targetPath,
        );
      }
    }

    const targetFiles = (await listFilesRecursively(targetDirectory)).filter(
      (file) =>
        publicAssetOriginPath({
          method: "GET",
          pathname: `/${directory}/${file.relativePath}`,
        }) !== null,
    );
    relocatedDirectoryCounts.set(directory, targetFiles.length);
  }

  if (
    !["assets", "_next/static"].some(
      (directory) => (relocatedDirectoryCounts.get(directory) ?? 0) > 0,
    )
  ) {
    throw new Error(
      "Missing Worker-owned client assets: dist/client/assets or dist/client/_next/static",
    );
  }
  if ((relocatedDirectoryCounts.get("event-posters") ?? 0) === 0) {
    throw new Error(
      "Missing Worker-owned static assets: dist/client/event-posters",
    );
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
