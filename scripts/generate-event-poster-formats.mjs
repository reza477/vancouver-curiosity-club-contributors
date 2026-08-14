import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const POSTER_DIRECTORY = path.join(process.cwd(), "public", "event-posters");
const JPEG_PATTERN = /^[a-z0-9][a-z0-9-]*\.jpeg$/u;
const MAX_POSTERS = 500;

export async function generateEventPosterFormats({
  posterDirectory = POSTER_DIRECTORY,
} = {}) {
  const entries = await readdir(posterDirectory, { withFileTypes: true });
  const jpegNames = entries
    .filter((entry) => entry.isFile() && JPEG_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (jpegNames.length === 0 || jpegNames.length > MAX_POSTERS) {
    throw new Error(
      `Expected between 1 and ${MAX_POSTERS} event poster JPEGs; found ${jpegNames.length}.`,
    );
  }

  let jpegBytes = 0;
  let avifBytes = 0;
  let webpBytes = 0;
  for (const jpegName of jpegNames) {
    const jpegPath = path.join(posterDirectory, jpegName);
    const jpeg = await readFile(jpegPath);
    jpegBytes += jpeg.byteLength;
    const image = sharp(jpeg, { failOn: "warning" }).rotate();
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
      throw new Error(`Poster ${jpegName} is not a valid JPEG.`);
    }

    const [avif, webp] = await Promise.all([
      image
        .clone()
        .avif({ chromaSubsampling: "4:2:0", effort: 4, quality: 52 })
        .toBuffer(),
      image
        .clone()
        .webp({ effort: 5, quality: 82, smartSubsample: true })
        .toBuffer(),
    ]);
    await Promise.all([
      writeAtomically(
        path.join(posterDirectory, replaceExtension(jpegName, "avif")),
        avif,
      ),
      writeAtomically(
        path.join(posterDirectory, replaceExtension(jpegName, "webp")),
        webp,
      ),
    ]);
    avifBytes += avif.byteLength;
    webpBytes += webp.byteLength;
  }

  return Object.freeze({
    avifBytes,
    jpegBytes,
    posterCount: jpegNames.length,
    webpBytes,
  });
}

async function writeAtomically(targetPath, bytes) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  await rename(temporaryPath, targetPath);
}

function replaceExtension(filename, extension) {
  return filename.replace(/\.jpeg$/u, `.${extension}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await generateEventPosterFormats();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
