import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { extractMeetupPublicEventFacts } from "../lib/meetup-public-event-facts.js";

const DEFAULT_WORKSPACE_ROOT = process.cwd();

const ALLOWED_MEETUP_GROUP_SLUGS = Object.freeze([
  "vancouver-fantasy-scifi-meetup-group",
  "vancouver-literature-and-film",
  "vancouver-meetup-group",
]);

const EVENTS = Object.freeze([
  ["vancouver-fantasy-scifi-meetup-group", "315294572"],
  ["vancouver-fantasy-scifi-meetup-group", "315823229"],
  ["vancouver-literature-and-film", "315294587"],
  ["vancouver-literature-and-film", "315508432"],
  ["vancouver-literature-and-film", "315508537"],
  ["vancouver-literature-and-film", "315510842"],
  ["vancouver-literature-and-film", "315675534"],
  ["vancouver-literature-and-film", "315772444"],
  ["vancouver-literature-and-film", "315772533"],
  ["vancouver-literature-and-film", "315772658"],
  ["vancouver-literature-and-film", "315772811"],
  ["vancouver-literature-and-film", "315777434"],
  ["vancouver-literature-and-film", "315823022"],
  ["vancouver-literature-and-film", "315823623"],
  ["vancouver-literature-and-film", "315851485"],
  ["vancouver-meetup-group", "315294577"],
  ["vancouver-meetup-group", "315511475"],
  ["vancouver-meetup-group", "315511480"],
  ["vancouver-meetup-group", "315511485"],
  ["vancouver-meetup-group", "315560589"],
  ["vancouver-meetup-group", "315561268"],
  ["vancouver-meetup-group", "315592402"],
  ["vancouver-meetup-group", "315675704"],
  ["vancouver-meetup-group", "315723559"],
  ["vancouver-meetup-group", "315772775"],
  ["vancouver-meetup-group", "315772829"],
  ["vancouver-meetup-group", "315772917"],
  ["vancouver-meetup-group", "315793227"],
  ["vancouver-meetup-group", "315823081"],
  ["vancouver-meetup-group", "315837612"],
  ["vancouver-meetup-group", "315837649"],
  ["vancouver-meetup-group", "315851495"],
  ["vancouver-meetup-group", "315886330"],
  ["vancouver-meetup-group", "315892763"],
  ["vancouver-meetup-group", "315936856"],
  ["vancouver-meetup-group", "315961874"],
  ["vancouver-meetup-group", "315962265"],
  ["vancouver-meetup-group", "315963468"],
  ["vancouver-meetup-group", "315969091"],
  ["vancouver-meetup-group", "315976207"],
  ["vancouver-meetup-group", "315993304"],
  ["vancouver-meetup-group", "316010049"],
]);

const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_POSTER_BYTES = 10 * 1024 * 1024;
const MIN_POSTER_WIDTH = 480;
const MIN_POSTER_HEIGHT = 270;
const FORBIDDEN_PUBLIC_TEXT_PATTERN =
  /(?:https?:\/\/|\bwww\.|\b(?:mailto|tel|sms|javascript|data):|\b(?:zoom\.us|meet\.google|teams\.microsoft\.com|webex\.com|discord\.gg)\b|\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=)/iu;
const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const RAW_HTML_PATTERN = /<\/?[a-z][^>]*>/iu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/u;
const MAX_DESCRIPTION_BLOCKS = 400;
const MAX_DESCRIPTION_INLINE_NODES = 4_000;
const MAX_DESCRIPTION_LIST_ITEMS = 300;
const MAX_DESCRIPTION_LINK_LENGTH = 2_048;
const ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS = Object.freeze(
  new Set([
    "docs.google.com",
    "drive.google.com",
    "m.youtube.com",
    "maps.app.goo.gl",
    "reifelsanctuary.calendarspots.com",
    "vancouver.ca",
    "viff.org",
    "www.focusfeatures.com",
    "www.gutenberg.org",
    "www.navneuro.com",
    "www.pewresearch.org",
    "www.reifelbirdsanctuary.com",
    "www.ted.com",
    "www.vatican.va",
    "www.youtube.com",
    "youtu.be",
  ]),
);
const PUBLIC_DESCRIPTION_LINK_QUERY_KEYS = Object.freeze({
  "m.youtube.com": Object.freeze(new Set(["index", "list", "start", "t", "v"])),
  "www.youtube.com": Object.freeze(
    new Set(["index", "list", "start", "t", "v"]),
  ),
  "youtu.be": Object.freeze(new Set(["list", "start", "t"])),
});
const MANAGED_POSTER_FILENAME_PATTERN =
  /^meetup-[0-9]+(?:-(?:480|960))?\.jpeg$/u;
const REQUEST_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml",
  "user-agent":
    "VancouverCuriosityClub/1.0 (owner-authorized public event reconciliation)",
});

export async function refreshCuratedMeetupEnrichment({
  beforePromote = null,
  events = EVENTS,
  fetchImpl = globalThis.fetch,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
} = {}) {
  validateEventInventory(events);
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (beforePromote !== null && typeof beforePromote !== "function") {
    throw new Error("The publication promotion hook must be a function.");
  }

  const manifestPath = path.join(
    workspaceRoot,
    "lib",
    "meetup-event-enrichment.generated.json",
  );
  const posterDirectory = path.join(
    workspaceRoot,
    "public",
    "event-posters",
  );
  const stagingRoot = await mkdtemp(
    path.join(workspaceRoot, ".meetup-enrichment-"),
  );
  const stagingPosterDirectory = path.join(stagingRoot, "event-posters");
  const stagingManifestPath = path.join(stagingRoot, "manifest.json");
  const manifestEvents = [];
  const stagedPosterFilenames = [];
  let preserveStaging = false;

  try {
    await mkdir(stagingPosterDirectory, { recursive: true });

    for (const [groupSlug, eventId] of events) {
      const eventUrl = `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
      const response = await fetchImpl(eventUrl, {
        headers: REQUEST_HEADERS,
        redirect: "follow",
      });
      assertCanonicalMeetupEventResponseUrl(
        response.url,
        groupSlug,
        eventId,
      );
      if (!response.ok) {
        throw new Error(`Meetup event ${eventId} returned ${response.status}.`);
      }
      const eventPageHtml = await response.text();
      assertCanonicalMeetupEventDocument(
        eventPageHtml,
        groupSlug,
        eventId,
      );
      const event = readMeetupEvent(eventPageHtml, eventId);
      const actualGroupSlug = readText(event.group?.urlname, "group slug", 120);
      if (actualGroupSlug !== groupSlug) {
        throw new Error(
          `Meetup event ${eventId} resolved to unexpected group ${actualGroupSlug}.`,
        );
      }

      let poster = null;
      const rawPosterSource = event.featuredEventPhoto?.source;
      if (
        rawPosterSource !== null &&
        rawPosterSource !== undefined &&
        !(typeof rawPosterSource === "string" && rawPosterSource.trim() === "")
      ) {
        const sourceUrl = readPosterSource(rawPosterSource, eventId);
        const posterResponse = await fetchImpl(sourceUrl, {
          headers: { "user-agent": REQUEST_HEADERS["user-agent"] },
        });
        assertAllowedMeetupPosterResponseUrl(posterResponse.url, eventId);
        if (!posterResponse.ok) {
          throw new Error(
            `Meetup poster ${eventId} returned ${posterResponse.status}.`,
          );
        }
        const contentType = posterResponse.headers.get("content-type") ?? "";
        if (!/^image\/jpeg(?:;|$)/iu.test(contentType)) {
          throw new Error(`Meetup poster ${eventId} was not a JPEG.`);
        }
        const posterBytes = Buffer.from(await posterResponse.arrayBuffer());
        if (posterBytes.length < 1 || posterBytes.length > MAX_POSTER_BYTES) {
          throw new Error(`Meetup poster ${eventId} has an invalid byte size.`);
        }
        const metadata = await sharp(posterBytes, {
          failOn: "warning",
        }).metadata();
        if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
          throw new Error(`Meetup poster ${eventId} has invalid dimensions.`);
        }

        const sourceAspectRatio = metadata.width / metadata.height;
        const isSuitablePoster =
          metadata.width >= MIN_POSTER_WIDTH &&
          metadata.height >= MIN_POSTER_HEIGHT &&
          sourceAspectRatio >= 1.7 &&
          sourceAspectRatio <= 1.82;
        if (isSuitablePoster) {
          const widths = Object.freeze({
            small: Math.min(480, metadata.width),
            medium: Math.min(960, metadata.width),
            large: Math.min(1_600, metadata.width),
          });
          const variants = {};
          for (const [size, width] of Object.entries(widths)) {
            const filename =
              size === "large"
                ? `meetup-${eventId}.jpeg`
                : `meetup-${eventId}-${size === "small" ? 480 : 960}.jpeg`;
            const output = await sharp(posterBytes, { failOn: "warning" })
              .rotate()
              .resize({ width, withoutEnlargement: true })
              .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 88 })
              .toBuffer({ resolveWithObject: true });
            await writeFile(
              path.join(stagingPosterDirectory, filename),
              output.data,
            );
            stagedPosterFilenames.push(filename);
            variants[size] = Object.freeze({
              height: output.info.height,
              localPath: `/event-posters/${filename}`,
              width: output.info.width,
            });
          }

          const posterAltText = normalizePublicSafeSingleLine(
            `${readText(event.title, "event title", 200)} event poster.`,
            "poster alt text",
            300,
          );
          const posterCredit = normalizePublicSafeSingleLine(
            "Vancouver Curiosity Club event poster via Meetup",
            "poster credit",
            300,
          );
          poster = Object.freeze({
            altText: posterAltText,
            credit: posterCredit,
            sourceHeight: metadata.height,
            sourceUrl,
            sourceWidth: metadata.width,
            variants: Object.freeze(variants),
          });
        }
      }

      const publicDescription = normalizePublicDescription(event.description);
      const { blocks: descriptionBlocks, plainText: description } =
        publicDescription;
      const venue = normalizePublicVenue(event.venue);
      const publicEventFacts = extractMeetupPublicEventFacts(description, {
        hasPublicVenue: venue !== null,
      });
      const summary = normalizePublicSafeSingleLine(
        deriveSummary(description),
        "event summary",
        500,
        10,
      );
      manifestEvents.push(
        Object.freeze({
          ...publicEventFacts,
          description,
          descriptionBlocks,
          eventId,
          eventUrl,
          groupSlug,
          poster,
          summary,
          venue,
        }),
      );
    }

    manifestEvents.sort((left, right) =>
      left.eventId.localeCompare(right.eventId),
    );
    await writeFile(
      stagingManifestPath,
      `${JSON.stringify({ schemaVersion: 3, events: manifestEvents }, null, 2)}\n`,
      "utf8",
    );
    await publishStagedGeneration({
      beforePromote,
      manifestPath,
      posterDirectory,
      stagedPosterFilenames,
      stagingRoot,
      stagingManifestPath,
      stagingPosterDirectory,
    });
    return manifestEvents.length;
  } catch (error) {
    preserveStaging = error?.preserveStaging === true;
    throw error;
  } finally {
    if (!preserveStaging) {
      await rm(stagingRoot, { force: true, recursive: true });
    }
  }
}

async function publishStagedGeneration({
  beforePromote,
  manifestPath,
  posterDirectory,
  stagedPosterFilenames,
  stagingRoot,
  stagingManifestPath,
  stagingPosterDirectory,
}) {
  await mkdir(posterDirectory, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const backupDirectory = path.join(stagingRoot, "publication-backups");
  await mkdir(backupDirectory, { recursive: true });
  const publishToken = path.basename(stagingRoot).replace(/[^a-z0-9_-]/giu, "");
  const publicationFiles = [];

  try {
    for (const filename of [...stagedPosterFilenames].sort()) {
      publicationFiles.push(
        await preparePublicationFile({
          backupDirectory,
          filename,
          kind: "poster",
          publishToken,
          sourcePath: path.join(stagingPosterDirectory, filename),
          targetPath: path.join(posterDirectory, filename),
        }),
      );
    }
    publicationFiles.push(
      await preparePublicationFile({
        backupDirectory,
        filename: path.basename(manifestPath),
        kind: "manifest",
        publishToken,
        sourcePath: stagingManifestPath,
        targetPath: manifestPath,
      }),
    );

    const promotedFiles = [];
    try {
      for (const publicationFile of publicationFiles) {
        promotedFiles.push(publicationFile);
        if (beforePromote !== null) {
          await beforePromote(
            Object.freeze({
              filename: publicationFile.filename,
              kind: publicationFile.kind,
              targetPath: publicationFile.targetPath,
            }),
          );
        }
        await rename(
          publicationFile.publishTempPath,
          publicationFile.targetPath,
        );
      }
    } catch (publicationError) {
      const rollbackErrors = await rollbackPromotedFiles(
        [...promotedFiles].reverse(),
        publishToken,
      );
      if (rollbackErrors.length > 0) {
        const rollbackFailure = new AggregateError(
          [publicationError, ...rollbackErrors],
          "Meetup enrichment publication failed and could not be fully rolled back.",
        );
        rollbackFailure.preserveStaging = true;
        throw rollbackFailure;
      }
      throw publicationError;
    }

    const retainedFilenames = new Set(stagedPosterFilenames);
    const posterEntries = await readdir(posterDirectory, {
      withFileTypes: true,
    });
    const staleCleanupFailures = [];
    for (const entry of posterEntries) {
      if (
        entry.isFile() &&
        isManagedMeetupPosterFilename(entry.name) &&
        !retainedFilenames.has(entry.name)
      ) {
        try {
          await unlink(path.join(posterDirectory, entry.name));
        } catch {
          staleCleanupFailures.push(entry.name);
        }
      }
    }
    if (staleCleanupFailures.length > 0) {
      console.warn(
        `Published Meetup enrichment but retained ${staleCleanupFailures.length} stale managed poster file(s).`,
      );
    }
  } finally {
    for (const publicationFile of publicationFiles) {
      await unlinkIfPresent(publicationFile.publishTempPath);
    }
  }
}

async function preparePublicationFile({
  backupDirectory,
  filename,
  kind,
  publishToken,
  sourcePath,
  targetPath,
}) {
  const backupPath = path.join(backupDirectory, `${kind}-${filename}`);
  let targetExisted = false;
  try {
    const targetMetadata = await lstat(targetPath);
    if (!targetMetadata.isFile()) {
      throw new Error(`Refusing to replace non-file output ${targetPath}.`);
    }
    targetExisted = true;
    await copyFile(targetPath, backupPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const publishTempPath = path.join(
    path.dirname(targetPath),
    `.${filename}.${publishToken}.publish`,
  );
  try {
    await copyFile(sourcePath, publishTempPath);
  } catch (error) {
    await unlinkIfPresent(publishTempPath);
    throw error;
  }
  return Object.freeze({
    backupPath,
    filename,
    kind,
    publishTempPath,
    targetExisted,
    targetPath,
  });
}

async function rollbackPromotedFiles(publicationFiles, publishToken) {
  const rollbackErrors = [];
  for (const publicationFile of publicationFiles) {
    try {
      if (!publicationFile.targetExisted) {
        await unlinkIfPresent(publicationFile.targetPath);
        continue;
      }
      const rollbackTempPath = path.join(
        path.dirname(publicationFile.targetPath),
        `.${publicationFile.filename}.${publishToken}.rollback`,
      );
      try {
        await copyFile(publicationFile.backupPath, rollbackTempPath);
        await rename(rollbackTempPath, publicationFile.targetPath);
      } finally {
        await unlinkIfPresent(rollbackTempPath);
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function validateEventInventory(events) {
  if (!Array.isArray(events)) {
    throw new Error("Meetup event inventory must be an array.");
  }
  const eventIds = new Set();
  for (const entry of events) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("Meetup event inventory entry was invalid.");
    }
    const [groupSlug, eventId] = entry;
    if (!ALLOWED_MEETUP_GROUP_SLUGS.includes(groupSlug)) {
      throw new Error(`Meetup group ${String(groupSlug)} was not allowlisted.`);
    }
    if (typeof eventId !== "string" || !/^[0-9]{6,20}$/u.test(eventId)) {
      throw new Error(`Meetup event ID ${String(eventId)} was invalid.`);
    }
    if (eventIds.has(eventId)) {
      throw new Error(`Duplicate Meetup event ID ${eventId}.`);
    }
    eventIds.add(eventId);
  }
}

export function assertCanonicalMeetupEventResponseUrl(
  input,
  groupSlug,
  eventId,
) {
  const expectedUrl =
    `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
  let actualUrl;
  try {
    actualUrl = new URL(input);
  } catch {
    throw new Error(`Meetup event ${eventId} returned an invalid final URL.`);
  }
  if (actualUrl.href !== expectedUrl) {
    throw new Error(`Meetup event ${eventId} returned an unexpected final URL.`);
  }
}

export function assertCanonicalMeetupEventDocument(
  html,
  groupSlug,
  eventId,
) {
  const expectedUrl =
    `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
  const canonicalTag = (html.match(/<link\b[^>]*>/giu) ?? []).find((tag) =>
    /\brel=["']canonical["']/iu.test(tag),
  );
  const canonicalUrl = canonicalTag
    ? /\bhref=["']([^"']+)["']/iu.exec(canonicalTag)?.[1]
    : null;
  if (canonicalUrl !== expectedUrl) {
    throw new Error(
      `Meetup event ${eventId} declared an unexpected canonical URL.`,
    );
  }
}

export function assertAllowedMeetupPosterResponseUrl(input, eventId) {
  let actualUrl;
  try {
    actualUrl = new URL(input);
  } catch {
    throw new Error(`Meetup poster ${eventId} returned an invalid final URL.`);
  }
  if (
    actualUrl.protocol !== "https:" ||
    actualUrl.hostname !== "secure.meetupstatic.com" ||
    actualUrl.username ||
    actualUrl.password ||
    actualUrl.port
  ) {
    throw new Error(`Meetup poster ${eventId} returned from an unexpected host.`);
  }
}

export function isManagedMeetupPosterFilename(filename) {
  return MANAGED_POSTER_FILENAME_PATTERN.test(filename);
}

function readMeetupEvent(html, expectedId) {
  const match =
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/iu.exec(
      html,
    );
  if (!match) throw new Error(`Meetup event ${expectedId} has no page data.`);
  const event = JSON.parse(match[1])?.props?.pageProps?.event;
  if (!event || String(event.id ?? event.token ?? "") !== expectedId) {
    throw new Error(`Meetup event ${expectedId} identity did not match.`);
  }
  return event;
}

function readPosterSource(input, eventId) {
  const value = readText(input, "poster source", 1_000);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "secure.meetupstatic.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/photos\/event\/[0-9a-f/]+\/highres_[0-9]+\.jpe?g$/iu.test(
      url.pathname,
    )
  ) {
    throw new Error(`Meetup poster ${eventId} source was not allowlisted.`);
  }
  return url.href;
}

export function normalizePublicDescription(input) {
  const source = readText(input, "event description", MAX_DESCRIPTION_LENGTH)
    .normalize("NFKC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (
    source.length < 10 ||
    source.length > MAX_DESCRIPTION_LENGTH ||
    UNSAFE_CONTROL_PATTERN.test(source) ||
    EMAIL_PATTERN.test(source) ||
    RAW_HTML_PATTERN.test(source) ||
    MARKDOWN_IMAGE_PATTERN.test(source) ||
    /\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=/iu.test(
      source,
    )
  ) {
    throw new Error("Meetup description failed the public-safe allowlist.");
  }

  const blocks = parsePublicDescriptionBlocks(source);
  const plainText = descriptionBlocksToPlainText(blocks);
  if (
    blocks.length < 1 ||
    blocks.length > MAX_DESCRIPTION_BLOCKS ||
    plainText.length < 10 ||
    plainText.length > MAX_DESCRIPTION_LENGTH ||
    UNSAFE_CONTROL_PATTERN.test(plainText) ||
    EMAIL_PATTERN.test(plainText) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(plainText)
  ) {
    throw new Error("Meetup description failed the public-safe allowlist.");
  }
  return Object.freeze({ blocks: Object.freeze(blocks), plainText });
}

function parsePublicDescriptionBlocks(source) {
  const blocks = [];
  let inlineNodeCount = 0;
  let paragraphLines = [];
  let list = null;

  const parseInlines = (value) => {
    const inlines = parsePublicDescriptionInlines(value);
    inlineNodeCount += inlines.length;
    if (inlineNodeCount > MAX_DESCRIPTION_INLINE_NODES) {
      throw new Error("Meetup description exceeded the public structure limit.");
    }
    return Object.freeze(inlines);
  };
  const pushBlock = (block) => {
    blocks.push(Object.freeze(block));
    if (blocks.length > MAX_DESCRIPTION_BLOCKS) {
      throw new Error("Meetup description exceeded the public structure limit.");
    }
  };
  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
    paragraphLines = [];
    if (text) pushBlock({ content: parseInlines(text), type: "paragraph" });
  };
  const flushList = () => {
    if (list === null) return;
    pushBlock({ items: Object.freeze(list.items), type: list.type });
    list = null;
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const strongHeading = /^\*\*([^*].*?)\*\*$/u.exec(line);
    const markdownHeading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (strongHeading || markdownHeading) {
      flushParagraph();
      flushList();
      const headingText = strongHeading?.[1] ?? markdownHeading?.[2] ?? "";
      const sourceLevel = markdownHeading?.[1]?.length ?? 2;
      pushBlock({
        content: parseInlines(headingText),
        level: sourceLevel <= 2 ? 3 : 4,
        type: "heading",
      });
      continue;
    }

    const unorderedItem = /^\\?(?:[*+-]|•)\s+(.+)$/u.exec(line);
    const orderedItem = /^\d+[.)]\s+(.+)$/u.exec(line);
    if (unorderedItem || orderedItem) {
      flushParagraph();
      const type = unorderedItem ? "unordered-list" : "ordered-list";
      if (list !== null && list.type !== type) flushList();
      list ??= { items: [], type };
      list.items.push(parseInlines(unorderedItem?.[1] ?? orderedItem?.[1] ?? ""));
      if (list.items.length > MAX_DESCRIPTION_LIST_ITEMS) {
        throw new Error("Meetup description exceeded the public list limit.");
      }
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return mergeStandaloneDescriptionCallToActionBlocks(blocks);
}

function parsePublicDescriptionInlines(value) {
  const inlines = [];
  const pattern = /\[([^\]\n]{1,500})\]\((https?:\/\/[^)\s]{1,2048})\)|\*\*([^*\n]+)\*\*|(?<![\[(])https?:\/\/[^\s<>()]+/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushPublicTextInline(inlines, value.slice(cursor, index));
    if (match[1] !== undefined && match[2] !== undefined) {
      pushPublicLinkInline(inlines, match[1], match[2]);
    } else if (match[3] !== undefined) {
      const text = normalizeDescriptionInlineText(match[3]);
      if (text) inlines.push(Object.freeze({ text, type: "strong" }));
    } else {
      pushPublicLinkInline(inlines, match[0], match[0]);
    }
    cursor = index + match[0].length;
  }
  pushPublicTextInline(inlines, value.slice(cursor));
  if (inlines.length === 0) {
    throw new Error("Meetup description contained an empty public block.");
  }
  return inlines;
}

function pushPublicTextInline(inlines, input) {
  const text = normalizeDescriptionInlineText(input);
  if (!text) return;
  const previous = inlines.at(-1);
  if (previous?.type === "text") {
    inlines[inlines.length - 1] = Object.freeze({
      text: `${previous.text}${text}`,
      type: "text",
    });
  } else {
    inlines.push(Object.freeze({ text, type: "text" }));
  }
}

function pushPublicLinkInline(inlines, rawLabel, rawHref) {
  const href = normalizePublicDescriptionLink(rawHref);
  const label = normalizeDescriptionInlineText(rawLabel);
  if (href === null) {
    const safeLabel = FORBIDDEN_PUBLIC_TEXT_PATTERN.test(label)
      ? "External resource"
      : label;
    pushPublicTextInline(inlines, safeLabel);
    return;
  }
  const host = new URL(href).hostname;
  const displayHost = host.replace(/^(?:m\.|www\.)/u, "");
  const usesGenericLabel = FORBIDDEN_PUBLIC_TEXT_PATTERN.test(label);
  const previous = inlines.at(-1);
  const callToAction = usesGenericLabel
    ? descriptionCallToAction(
        previous?.type === "text" ? previous.text : "",
      )
    : null;
  if (callToAction !== null) {
    inlines.pop();
    if (callToAction.prefix) {
      pushPublicTextInline(inlines, callToAction.prefix);
    }
  }
  const text =
    callToAction?.label ?? (usesGenericLabel ? `Open ${displayHost}` : label);
  inlines.push(Object.freeze({ href, text, type: "link" }));
}

function mergeStandaloneDescriptionCallToActionBlocks(blocks) {
  const merged = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    const callToAction = standaloneDescriptionCallToAction(block);
    const link = standaloneGenericDescriptionLink(next);
    if (callToAction !== null && link !== null) {
      const content = Object.freeze([
        ...(callToAction.prefix
          ? [Object.freeze({ text: callToAction.prefix, type: "text" })]
          : []),
        Object.freeze({ ...link, text: callToAction.label, type: "link" }),
      ]);
      merged.push(
        Object.freeze(
          block.type === "heading"
            ? { content, level: block.level, type: block.type }
            : { content, type: "paragraph" },
        ),
      );
      index += 1;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function standaloneDescriptionCallToAction(block) {
  if (!block || "items" in block || block.content.length !== 1) return null;
  const inline = block.content[0];
  return inline.type === "text"
    ? descriptionCallToAction(inline.text)
    : null;
}

function standaloneGenericDescriptionLink(block) {
  if (!block || block.type !== "paragraph" || block.content.length !== 1) {
    return null;
  }
  const inline = block.content[0];
  return inline.type === "link" && isGenericDescriptionLinkText(inline.text)
    ? inline
    : null;
}

function descriptionCallToAction(input) {
  const normalized = input.trimEnd();
  if (!normalized.endsWith(":")) return null;
  const candidate = normalized.slice(0, -1);
  const suffix = /(Buy\b[^:]{0,80}\bhere|Google Maps|(?:Official|Public|Reservation|Planning|Ticket|Tickets|YouTube|Video|Event|Film|Source) [^.!?:]{1,60}|(?:\d+-minute )?written summary)$/iu.exec(
    candidate,
  );
  const suffixIndex = suffix?.index ?? null;
  const wholeLabel = candidate.trim();
  const start =
    suffixIndex ??
    (wholeLabel.length <= 80 &&
    !/[.!?]/u.test(wholeLabel) &&
    !/^[,;:]/u.test(wholeLabel)
      ? candidate.indexOf(wholeLabel)
      : null);
  if (start === null) return null;
  const label = candidate.slice(start).trim();
  if (label.length < 3 || label.length > 80) return null;
  const rawPrefix = candidate.slice(0, start);
  const prefixIsOnlySpacing = rawPrefix.trim().length === 0;
  return Object.freeze({
    label: `${prefixIsOnlySpacing ? rawPrefix : ""}${label}`,
    prefix: prefixIsOnlySpacing ? "" : rawPrefix,
  });
}

function isGenericDescriptionLinkText(input) {
  return /^Open [a-z0-9.-]+$/iu.test(input);
}

function normalizeDescriptionInlineText(input) {
  return input
    .normalize("NFKC")
    .replace(/\\([*_[\]`|])/gu, "$1")
    .replace(/\s+/gu, " ");
}

function normalizePublicDescriptionLink(input) {
  if (typeof input !== "string" || input.length > MAX_DESCRIPTION_LINK_LENGTH) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS.has(host)
  ) {
    return null;
  }
  parsed.hostname = host;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|g_st|ouid|rtpof|sd|usp)$/iu.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  const allowedQueryKeys = PUBLIC_DESCRIPTION_LINK_QUERY_KEYS[host];
  for (const key of parsed.searchParams.keys()) {
    if (!allowedQueryKeys?.has(key)) return null;
  }
  const normalized = parsed.toString();
  return normalized.length <= MAX_DESCRIPTION_LINK_LENGTH ? normalized : null;
}

function descriptionBlocksToPlainText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === "unordered-list" || block.type === "ordered-list") {
        return block.items
          .map((item, index) => {
            const marker = block.type === "ordered-list" ? `${index + 1}.` : "•";
            return `${marker} ${descriptionInlinesToText(item)}`;
          })
          .join("\n");
      }
      return descriptionInlinesToText(block.content);
    })
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function descriptionInlinesToText(inlines) {
  return inlines.map((inline) => inline.text).join("").trim();
}

function normalizePublicVenue(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Meetup venue failed the public-safe allowlist.");
  }
  const name = normalizeOptionalPublicSafeSingleLine(
    input.name,
    "venue name",
    200,
  );
  // A venue object without a public name is treated as deliberately hidden.
  // Do not inspect or infer a location from its other fields.
  if (name === null) return null;
  return Object.freeze({
    address: normalizeOptionalPublicSafeSingleLine(
      input.address,
      "venue address",
      300,
    ),
    city: normalizeOptionalPublicSafeSingleLine(
      input.city,
      "venue city",
      120,
    ),
    name,
    state: normalizeOptionalPublicSafeSingleLine(
      input.state,
      "venue state",
      120,
    ),
  });
}

function normalizeOptionalPublicSafeSingleLine(input, label, maximum) {
  if (input === null || input === undefined) return null;
  if (typeof input === "string" && input.trim() === "") return null;
  return normalizePublicSafeSingleLine(input, label, maximum);
}

function normalizePublicSafeSingleLine(
  input,
  label,
  maximum,
  minimum = 1,
) {
  if (typeof input !== "string") {
    throw new Error(`Meetup ${label} was missing.`);
  }
  const value = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    value.length < minimum ||
    value.length > maximum ||
    UNSAFE_CONTROL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(value)
  ) {
    throw new Error(`Meetup ${label} failed the public-safe allowlist.`);
  }
  return value;
}

function deriveSummary(description) {
  const lower = description.toLocaleLowerCase("en-CA");
  const marker = "short summary";
  const markerIndex = lower.indexOf(marker);
  let body = markerIndex >= 0
    ? description.slice(markerIndex + marker.length)
    : description;
  const stopIndex = body.search(
    /\n(?:A few questions|Questions|How the evening|How the event|How it will|The plan|Reading for|What to bring|Tickets|Location|When and where|A note)/iu,
  );
  if (stopIndex > 0) body = body.slice(0, stopIndex);
  const collapsed = body.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= 360) return collapsed;
  const candidate = collapsed.slice(0, 360);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! "),
  );
  return sentenceEnd >= 180
    ? candidate.slice(0, sentenceEnd + 1)
    : `${candidate.slice(0, 357).trimEnd()}...`;
}

function readText(input, label, maximum) {
  if (typeof input !== "string") {
    throw new Error(`Meetup ${label} was missing.`);
  }
  const value = input.trim();
  if (value.length < 1 || value.length > maximum) {
    throw new Error(`Meetup ${label} had an invalid length.`);
  }
  return value;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const refreshedEventCount = await refreshCuratedMeetupEnrichment();
  console.log(
    `Refreshed ${refreshedEventCount} verified Meetup event enrichments.`,
  );
}
