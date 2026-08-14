import { access, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
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

  for (const directory of WORKER_OWNED_ASSET_DIRECTORIES) {
    const sourceDirectory = resolve(clientDirectory, directory);
    const targetDirectory = resolve(originDirectory, directory);
    const sourceEntries = (await exists(sourceDirectory))
      ? await readdir(sourceDirectory, { withFileTypes: true })
      : [];
    const ownedEntries = sourceEntries.filter(
      (entry) =>
        entry.isFile() &&
        publicAssetOriginPath({
          method: "GET",
          pathname: `/${directory}/${entry.name}`,
        }) !== null,
    );

    if (ownedEntries.length > 0) {
      await rm(targetDirectory, { recursive: true, force: true });
      await mkdir(targetDirectory, { recursive: true });
      for (const entry of ownedEntries) {
        await rename(
          resolve(sourceDirectory, entry.name),
          resolve(targetDirectory, entry.name),
        );
      }
    }

    const targetEntries = (await exists(targetDirectory))
      ? await readdir(targetDirectory, { withFileTypes: true })
      : [];
    if (!targetEntries.some((entry) => entry.isFile())) {
      throw new Error(
        `Missing Worker-owned static assets: dist/client/${directory}`,
      );
    }
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
