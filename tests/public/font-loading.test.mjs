import { readPublicCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);
const fontsDirectory = new URL("public/fonts/", projectRoot);
const expectedFontFiles = [
  "fraunces-72pt-latin-400.woff2",
  "fraunces-72pt-latin-ext-400.woff2",
  "inter-latin-400.woff2",
  "inter-latin-ext-400.woff2",
];
const expectedFaceFiles = [
  "fraunces-72pt-latin-ext-400.woff2",
  "fraunces-72pt-latin-400.woff2",
  "inter-latin-ext-400.woff2",
  "inter-latin-400.woff2",
];

test("self-hosted public fonts are licensed WOFF2 files within budget", async () => {
  const files = (await readdir(fontsDirectory))
    .filter((file) => file.endsWith(".woff2"))
    .sort();
  assert.deepEqual(files, expectedFontFiles);

  let totalBytes = 0;
  for (const file of files) {
    const fileUrl = new URL(file, fontsDirectory);
    const [contents, metadata] = await Promise.all([
      readFile(fileUrl),
      stat(fileUrl),
    ]);
    assert.equal(
      contents.subarray(0, 4).toString("ascii"),
      "wOF2",
      `${file} must have a WOFF2 signature`,
    );
    totalBytes += metadata.size;
  }
  assert.ok(
    totalBytes <= 120_000,
    `font payload is ${totalBytes} bytes; the limit is 120000`,
  );

  const [frauncesLicense, interLicense] = await Promise.all([
    readFile(new URL("Fraunces-OFL.txt", fontsDirectory), "utf8"),
    readFile(new URL("Inter-OFL.txt", fontsDirectory), "utf8"),
  ]);
  assert.match(frauncesLicense, /Copyright 2018 The Fraunces Project Authors/u);
  assert.match(frauncesLicense, /SIL Open Font License, Version 1\.1/u);
  assert.match(interLicense, /Copyright 2020 The Inter Project Authors/u);
  assert.match(interLicense, /SIL Open Font License, Version 1\.1/u);
});

test("public font faces stay local, swap safely, and preserve typography overrides", async () => {
  const [styles, previewStyles] = await Promise.all([
    readPublicCss(),
    readFile(new URL("app/_organizer/phase6.module.css", projectRoot), "utf8"),
  ]);
  const fontFaces = [...styles.matchAll(/@font-face\s*\{[\s\S]*?\}/gu)].map(
    (match) => match[0],
  );
  assert.equal(fontFaces.length, 4);
  for (const [index, file] of expectedFaceFiles.entries()) {
    const fontFace = fontFaces[index];
    assert.match(fontFace, /font-display:\s*swap;/u);
    assert.match(fontFace, /font-weight:\s*400;/u);
    assert.match(
      fontFace,
      new RegExp(`url\\("/fonts/${file.replaceAll(".", "\\.")}"\\)`, "u"),
    );
    assert.doesNotMatch(fontFace, /https?:|fonts\.(?:googleapis|gstatic)\.com/u);
  }
  assert.match(fontFaces[0], /font-family:\s*"Fraunces";/u);
  assert.match(fontFaces[0], /unicode-range:\s*U\+0100-02BA/u);
  assert.match(fontFaces[1], /font-family:\s*"Fraunces";/u);
  assert.match(fontFaces[1], /unicode-range:\s*U\+0000-00FF/u);
  assert.match(fontFaces[2], /font-family:\s*"Inter";/u);
  assert.match(fontFaces[2], /unicode-range:\s*U\+0100-02BA/u);
  assert.match(fontFaces[3], /font-family:\s*"Inter";/u);
  assert.match(fontFaces[3], /unicode-range:\s*U\+0000-00FF/u);

  assert.match(
    styles,
    /--display:\s*"Fraunces", Georgia, "Times New Roman", Times, serif;/u,
  );
  assert.match(
    styles,
    /--sans:\s*"Inter", "Avenir Next", Avenir, "Segoe UI", "Helvetica Neue",\s*Arial, sans-serif;/u,
  );
  assert.match(
    styles,
    /body\[data-surface="public"\]\[data-typography="humanist"\]\s*\{[\s\S]*?--display:\s*"Avenir Next"/u,
  );
  assert.match(
    styles,
    /body\[data-surface="public"\]\[data-typography="system"\]\s*\{[\s\S]*?--display:\s*ui-serif[\s\S]*?--sans:\s*system-ui/u,
  );
  assert.match(
    previewStyles,
    /\.publicPreviewShell\[data-typography="humanist"\]\s*\{[\s\S]*?--display:\s*"Avenir Next"/u,
  );
  assert.match(
    previewStyles,
    /\.publicPreviewShell\[data-typography="system"\]\s*\{[\s\S]*?--display:\s*ui-serif[\s\S]*?--sans:\s*system-ui/u,
  );
});

test("root layout preloads only the above-fold display subset", async () => {
  const layout = await readFile(new URL("app/layout.tsx", projectRoot), "utf8");
  assert.equal((layout.match(/rel="preload"/gu) ?? []).length, 1);
  assert.match(
    layout,
    /<link\s+rel="preload"\s+href="\/fonts\/fraunces-72pt-latin-400\.woff2"\s+as="font"\s+type="font\/woff2"\s+crossOrigin="anonymous"\s*\/>/u,
  );
  assert.doesNotMatch(layout, /rel="preload"[\s\S]*?inter-/u);
  assert.doesNotMatch(layout, /rel="preload"[\s\S]*?latin-ext/u);
});
