import { readPublicCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);
const fontsDirectory = new URL("public/fonts/", projectRoot);
const expectedFontFiles = [
  "fraunces-72pt-latin-400-600.woff2",
  "fraunces-72pt-latin-ext-400-600.woff2",
  "inter-latin-400-700.woff2",
  "inter-latin-ext-400-700.woff2",
];
const expectedFaceFiles = [
  {
    family: "Fraunces",
    file: "fraunces-72pt-latin-ext-400-600.woff2",
    unicodeRange: /unicode-range:\s*U\+0100-02BA/u,
    weight: "400 600",
  },
  {
    family: "Fraunces",
    file: "fraunces-72pt-latin-400-600.woff2",
    unicodeRange: /unicode-range:\s*U\+0000-00FF/u,
    weight: "400 600",
  },
  {
    family: "Inter",
    file: "inter-latin-ext-400-700.woff2",
    unicodeRange: /unicode-range:\s*U\+0100-02BA/u,
    weight: "400 700",
  },
  {
    family: "Inter",
    file: "inter-latin-400-700.woff2",
    unicodeRange: /unicode-range:\s*U\+0000-00FF/u,
    weight: "400 700",
  },
];
const officialFontArtifacts = new Map([
  [
    "fraunces-72pt-latin-400-600.woff2",
    {
      bytes: 36_864,
      sha256: "c6b883e7a03c0b47364fdbe88252378be5a1436d3372b95d00bf9987dd362fd7",
    },
  ],
  [
    "fraunces-72pt-latin-ext-400-600.woff2",
    {
      bytes: 33_736,
      sha256: "8be2652ca663884bfad174c42c9aaf4de9f597a854554335ac9a0e3d7188f399",
    },
  ],
  [
    "inter-latin-400-700.woff2",
    {
      bytes: 48_256,
      sha256: "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62",
    },
  ],
  [
    "inter-latin-ext-400-700.woff2",
    {
      bytes: 85_068,
      sha256: "34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956",
    },
  ],
]);

test("self-hosted public fonts are verified Google Fonts WOFF2 files within budget", async () => {
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
    const expectedArtifact = officialFontArtifacts.get(file);
    assert.ok(expectedArtifact, `${file} needs an authoritative artifact record`);
    assert.equal(metadata.size, expectedArtifact.bytes, `${file} byte size`);
    assert.equal(
      createHash("sha256").update(contents).digest("hex"),
      expectedArtifact.sha256,
      `${file} must match the documented Google Fonts artifact`,
    );
    totalBytes += metadata.size;
  }
  assert.equal(totalBytes, 203_924);
  assert.ok(
    totalBytes <= 210_000,
    `font payload is ${totalBytes} bytes; the limit is 210000`,
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
  for (const [index, expected] of expectedFaceFiles.entries()) {
    const fontFace = fontFaces[index];
    assert.match(fontFace, /font-display:\s*swap;/u);
    assert.match(
      fontFace,
      new RegExp(`font-family:\\s*"${expected.family}";`, "u"),
    );
    assert.match(
      fontFace,
      new RegExp(`font-weight:\\s*${expected.weight};`, "u"),
    );
    assert.match(
      fontFace,
      new RegExp(
        `url\\("/fonts/${expected.file.replaceAll(".", "\\.")}"\\)`,
        "u",
      ),
    );
    assert.match(fontFace, expected.unicodeRange);
    assert.doesNotMatch(fontFace, /https?:|fonts\.(?:googleapis|gstatic)\.com/u);
  }

  const declaredWeights = [...styles.matchAll(/font-weight:\s*([^;]+);/gu)]
    .map((match) => match[1].trim())
    .filter((weight) => !weight.includes(" "));
  assert.deepEqual(
    [...new Set(declaredWeights)].sort(),
    ["400", "600", "700"],
    "public CSS must request only weights exposed by the self-hosted faces",
  );
  assert.match(
    styles,
    /body\[data-surface="public"\]\s*\{[\s\S]*?font-synthesis:\s*none;/u,
  );

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

test("root layout preloads only the above-fold Latin display and UI subsets", async () => {
  const layout = await readFile(new URL("app/layout.tsx", projectRoot), "utf8");
  assert.equal((layout.match(/rel="preload"/gu) ?? []).length, 2);
  assert.match(
    layout,
    /<link\s+rel="preload"\s+href="\/fonts\/fraunces-72pt-latin-400-600\.woff2"\s+as="font"\s+type="font\/woff2"\s+crossOrigin="anonymous"\s*\/>/u,
  );
  assert.match(
    layout,
    /<link\s+rel="preload"\s+href="\/fonts\/inter-latin-400-700\.woff2"\s+as="font"\s+type="font\/woff2"\s+crossOrigin="anonymous"\s*\/>/u,
  );
  assert.doesNotMatch(layout, /rel="preload"[\s\S]*?latin-ext/u);
});
