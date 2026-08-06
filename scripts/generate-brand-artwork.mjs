import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const masterPath = resolve(
  projectRoot,
  "design-assets",
  "brand-icon-master.svg",
);
const masterSvg = await readFile(masterPath);
const midnightNavy = Object.freeze({ b: 49, g: 27, r: 7 });

const iconTargets = Object.freeze([
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["favicon-48.png", 48],
  ["icon.png", 64],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]);

await Promise.all(
  iconTargets.map(async ([fileName, size]) => {
    const output = await sharp(masterSvg, { density: 384 })
      .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    await writeFile(resolve(projectRoot, "public", fileName), output);
  }),
);

const maskableMark = await sharp(masterSvg, { density: 384 })
  .resize(400, 400, { fit: "fill", kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();
await sharp({
  create: {
    background: { ...midnightNavy, alpha: 1 },
    channels: 4,
    height: 512,
    width: 512,
  },
})
  .composite([{ input: maskableMark, left: 56, top: 56 }])
  .png({ compressionLevel: 9, palette: false })
  .toFile(resolve(projectRoot, "public", "icon-maskable-512.png"));

await sharp(masterSvg, { density: 384 })
  .resize(2048, 2048, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  })
  .png({ compressionLevel: 9, palette: false })
  .toFile(resolve(projectRoot, "design-assets", "brand-icon-master.png"));

const socialMark = await sharp(masterSvg, { density: 384 })
  .resize(430, 430, { fit: "fill", kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();
const socialType = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <style>
      .name {
        fill: #F5F0E6;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 78px;
        font-weight: 760;
        letter-spacing: 3px;
      }
      .tagline {
        fill: #6D91F2;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 31px;
        font-weight: 650;
        letter-spacing: 1px;
      }
    </style>
    <text class="name" x="515" y="188">VANCOUVER</text>
    <text class="name" x="515" y="288">CURIOSITY</text>
    <text class="name" x="515" y="388">CLUB</text>
    <text class="tagline" x="520" y="476">A SOCIAL CALENDAR WITH A BRAIN</text>
    <circle cx="1109" cy="466" r="9" fill="#E85B48" />
  </svg>
`);
await sharp({
  create: {
    background: { ...midnightNavy, alpha: 1 },
    channels: 4,
    height: 630,
    width: 1200,
  },
})
  .composite([
    { input: socialMark, left: 48, top: 100 },
    { input: socialType, left: 0, top: 0 },
  ])
  .png({ compressionLevel: 9, palette: false })
  .toFile(resolve(projectRoot, "public", "og.png"));
