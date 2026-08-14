import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { EventPosterImage } from "../../app/_components/EventPosterImage.tsx";

const posterDirectory = path.resolve("public/event-posters");

test("every bundled event poster has dimension-matched AVIF and WebP variants", async () => {
  const names = (await readdir(posterDirectory)).sort();
  const jpegNames = names.filter((name) => name.endsWith(".jpeg"));
  assert.equal(jpegNames.length, 141);

  let jpegBytes = 0;
  let modernBytes = 0;
  for (const jpegName of jpegNames) {
    const stem = jpegName.slice(0, -".jpeg".length);
    const expected = [
      ["avif", `${stem}.avif`],
      ["webp", `${stem}.webp`],
    ];
    const jpegPath = path.join(posterDirectory, jpegName);
    const jpeg = await readFile(jpegPath);
    const jpegMetadata = await sharp(jpeg).metadata();
    jpegBytes += jpeg.byteLength;

    for (const [format, modernName] of expected) {
      assert.ok(names.includes(modernName), `${modernName} is missing`);
      const modern = await readFile(path.join(posterDirectory, modernName));
      const metadata = await sharp(modern).metadata();
      if (format === "avif") {
        assert.equal(metadata.format, "heif", modernName);
        assert.match(modern.subarray(4, 12).toString("ascii"), /^ftypavi/u);
      } else {
        assert.equal(metadata.format, "webp", modernName);
        assert.equal(modern.subarray(0, 4).toString("ascii"), "RIFF");
        assert.equal(modern.subarray(8, 12).toString("ascii"), "WEBP");
      }
      assert.equal(metadata.width, jpegMetadata.width, modernName);
      assert.equal(metadata.height, jpegMetadata.height, modernName);
      modernBytes += modern.byteLength;
    }
  }

  assert.ok(
    modernBytes < jpegBytes * 2,
    "the two modern-format sets must remain smaller than two JPEG sets",
  );
});

test("the poster image boundary prefers AVIF and WebP but retains JPEG fallback", async () => {
  const source = await readFile(
    path.resolve("app/_components/EventPosterImage.tsx"),
    "utf8",
  );
  assert.match(source, /<picture>/u);
  assert.match(source, /type="image\/avif"/u);
  assert.match(source, /type="image\/webp"/u);
  assert.match(source, /\{image\}/u);
  assert.match(source, /setFailedSrc\(src\)/u);
  assert.match(source, /localPosterModernSources/u);
  assert.match(source, /urls\.some/u);
});

test("dynamic Meetup posters omit untruthful widths while bundled posters retain them", () => {
  const fallback = createElement("span", null, "Poster unavailable");
  const dynamicMarkup = renderToStaticMarkup(
    createElement(EventPosterImage, {
      alt: "Synchronized Meetup poster",
      fallback,
      sizes: "(max-width: 40rem) 480px, 1600px",
      src: "/meetup-posters/vancouver-group/12345/large",
      srcSet:
        "/meetup-posters/vancouver-group/12345/small 480w, /meetup-posters/vancouver-group/12345/medium 960w, /meetup-posters/vancouver-group/12345/large 1600w",
    }),
  );
  assert.match(
    dynamicMarkup,
    /<img[^>]*src="\/meetup-posters\/vancouver-group\/12345\/large"/u,
  );
  assert.doesNotMatch(dynamicMarkup, /\bsrcset=|\bsizes=|<picture>/iu);

  const staticMarkup = renderToStaticMarkup(
    createElement(EventPosterImage, {
      alt: "Bundled event poster",
      fallback,
      sizes: "(max-width: 40rem) 480px, 1600px",
      src: "/event-posters/meetup-12345.jpeg",
      srcSet:
        "/event-posters/meetup-12345-480.jpeg 480w, /event-posters/meetup-12345-960.jpeg 960w, /event-posters/meetup-12345.jpeg 1600w",
    }),
  );
  assert.match(staticMarkup, /<picture>/u);
  assert.match(staticMarkup, /type="image\/avif"/u);
  assert.match(staticMarkup, /type="image\/webp"/u);
  assert.match(staticMarkup, /\bsrcSet=|\bsrcset=/u);
  assert.match(staticMarkup, /\bsizes=/u);
});
