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
  "app/styles/components/forms.css",
  "app/styles/pages/home.css",
  "app/styles/pages/event-detail.css",
  "app/styles/motion.css",
  "app/styles/components/responsive-overrides.css",
]);

const publicRouteCssPaths = Object.freeze({
  about: "public/styles/about.css",
  events: Object.freeze([
    "public/styles/calendar.css",
    "public/styles/events.css",
  ]),
  organizations: "public/styles/organizations.css",
});

const publicSupplementalCssPaths = Object.freeze([
  "public/styles/calendar.css",
]);

export async function readPublicCss() {
  const [globalCss, ...supplementalCss] = await Promise.all([
    readCssGraph(publicCssEntry, new Set()),
    ...publicSupplementalCssPaths.map((file) =>
      readFile(new URL(file, projectRoot), "utf8"),
    ),
  ]);
  return `${globalCss}\n${supplementalCss.join("\n")}`;
}

export async function readPublicRouteCss(route) {
  const routeCssPaths = publicRouteCssPaths[route];
  if (!routeCssPaths) throw new Error(`Unknown public route stylesheet: ${route}`);
  const paths = Array.isArray(routeCssPaths) ? routeCssPaths : [routeCssPaths];
  const [globalCss, ...routeCss] = await Promise.all([
    readCssGraph(publicCssEntry, new Set()),
    ...paths.map((file) => readFile(new URL(file, projectRoot), "utf8")),
  ]);
  return `${globalCss}\n${routeCss.join("\n")}`;
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
