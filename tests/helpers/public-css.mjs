import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";

export const projectRoot = new URL("../../", import.meta.url);
export const publicCssEntry = new URL("app/globals.css", projectRoot);

export const publicCssModulePaths = Object.freeze([
  "app/styles/tokens.css",
  "app/styles/base.css",
  "app/styles/layout.css",
  "app/styles/components/editorial.css",
  "app/styles/components/catalog.css",
  "app/styles/components/event-card.css",
  "app/styles/components/calendar.css",
  "app/styles/components/forms.css",
  "app/styles/pages/home.css",
  "app/styles/pages/event-detail.css",
  "app/styles/pages/about.css",
  "app/styles/components/responsive-overrides.css",
]);

const publicRouteCssPaths = Object.freeze({
  events: "public/styles/events.css",
  organizations: "public/styles/organizations.css",
});

export async function readPublicCss() {
  return readCssGraph(publicCssEntry, new Set());
}

export async function readPublicRouteCss(route) {
  const routeCssPath = publicRouteCssPaths[route];
  if (!routeCssPath) throw new Error(`Unknown public route stylesheet: ${route}`);
  const [globalCss, routeCss] = await Promise.all([
    readPublicCss(),
    readFile(new URL(routeCssPath, projectRoot), "utf8"),
  ]);
  return `${globalCss}\n${routeCss}`;
}

export function readPublicCssSync() {
  return readCssGraphSync(publicCssEntry, new Set());
}

export async function publicCssSourceBytes() {
  const files = ["app/globals.css", ...publicCssModulePaths];
  const sizes = await Promise.all(
    files.map(async (file) => (await stat(new URL(file, projectRoot))).size),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

async function readCssGraph(file, visited) {
  const key = file.href;
  if (visited.has(key)) return "";
  visited.add(key);
  const source = await readFile(file, "utf8");
  const imported = await Promise.all(
    localImports(source).map((specifier) =>
      readCssGraph(new URL(specifier, file), visited),
    ),
  );
  return `${source}\n${imported.join("\n")}`;
}

function readCssGraphSync(file, visited) {
  const key = file.href;
  if (visited.has(key)) return "";
  visited.add(key);
  const source = readFileSync(file, "utf8");
  const imported = localImports(source).map((specifier) =>
    readCssGraphSync(new URL(specifier, file), visited),
  );
  return `${source}\n${imported.join("\n")}`;
}

function localImports(source) {
  return [...source.matchAll(/@import\s+["']([^"']+)["'][^;]*;/gu)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}
