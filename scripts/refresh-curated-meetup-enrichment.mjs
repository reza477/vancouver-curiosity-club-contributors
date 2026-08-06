import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const WORKSPACE_ROOT = process.cwd();
const MANIFEST_PATH = path.join(
  WORKSPACE_ROOT,
  "lib",
  "meetup-event-enrichment.generated.json",
);
const POSTER_DIRECTORY = path.join(
  WORKSPACE_ROOT,
  "public",
  "event-posters",
);

const EVENTS = Object.freeze([
  ["vancouver-fantasy-scifi-meetup-group", "315294572"],
  ["vancouver-fantasy-scifi-meetup-group", "315823229"],
  ["vancouver-literature-and-film", "315508432"],
  ["vancouver-literature-and-film", "315508537"],
  ["vancouver-literature-and-film", "315510842"],
  ["vancouver-literature-and-film", "315675534"],
  ["vancouver-literature-and-film", "315772444"],
  ["vancouver-literature-and-film", "315772533"],
  ["vancouver-literature-and-film", "315772658"],
  ["vancouver-literature-and-film", "315772811"],
  ["vancouver-literature-and-film", "315777434"],
  ["vancouver-meetup-group", "315592402"],
  ["vancouver-meetup-group", "315772775"],
]);

const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_POSTER_BYTES = 10 * 1024 * 1024;
const MIN_POSTER_WIDTH = 1_200;
const FORBIDDEN_PUBLIC_TEXT_PATTERN =
  /(?:https?:\/\/|\bwww\.|\b(?:mailto|tel|sms|javascript|data):|\b(?:zoom\.us|meet\.google|teams\.microsoft\.com|webex\.com|discord\.gg)\b|\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=)/iu;
const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const REQUEST_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml",
  "user-agent":
    "VancouverCuriosityClub/1.0 (owner-authorized public event reconciliation)",
});

await mkdir(POSTER_DIRECTORY, { recursive: true });
const manifestEvents = [];

for (const [groupSlug, eventId] of EVENTS) {
  const eventUrl = `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
  const response = await fetch(eventUrl, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Meetup event ${eventId} returned ${response.status}.`);
  }
  const event = readMeetupEvent(await response.text(), eventId);
  const actualGroupSlug = readText(event.group?.urlname, "group slug", 120);
  if (actualGroupSlug !== groupSlug) {
    throw new Error(
      `Meetup event ${eventId} resolved to unexpected group ${actualGroupSlug}.`,
    );
  }

  const sourceUrl = readPosterSource(event.featuredEventPhoto?.source, eventId);
  const posterResponse = await fetch(sourceUrl, {
    headers: { "user-agent": REQUEST_HEADERS["user-agent"] },
  });
  if (!posterResponse.ok) {
    throw new Error(`Meetup poster ${eventId} returned ${posterResponse.status}.`);
  }
  const contentType = posterResponse.headers.get("content-type") ?? "";
  if (!/^image\/jpeg(?:;|$)/iu.test(contentType)) {
    throw new Error(`Meetup poster ${eventId} was not a JPEG.`);
  }
  const posterBytes = Buffer.from(await posterResponse.arrayBuffer());
  if (posterBytes.length < 1 || posterBytes.length > MAX_POSTER_BYTES) {
    throw new Error(`Meetup poster ${eventId} has an invalid byte size.`);
  }
  const metadata = await sharp(posterBytes, { failOn: "warning" }).metadata();
  if (
    metadata.format !== "jpeg" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < MIN_POSTER_WIDTH ||
    metadata.width / metadata.height < 1.7 ||
    metadata.width / metadata.height > 1.82
  ) {
    throw new Error(`Meetup poster ${eventId} has unsafe dimensions.`);
  }

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
        : `meetup-${eventId}-${width}.jpeg`;
    const output = await sharp(posterBytes, { failOn: "warning" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 88 })
      .toBuffer({ resolveWithObject: true });
    await writeFile(path.join(POSTER_DIRECTORY, filename), output.data);
    variants[size] = Object.freeze({
      height: output.info.height,
      localPath: `/event-posters/${filename}`,
      width: output.info.width,
    });
  }

  const description = normalizePublicDescription(event.description);
  const venue = normalizePublicVenue(event.venue);
  const summary = normalizePublicSafeSingleLine(
    deriveSummary(description),
    "event summary",
    500,
    10,
  );
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
  manifestEvents.push(
    Object.freeze({
      description,
      eventId,
      eventUrl,
      groupSlug,
      poster: Object.freeze({
        altText: posterAltText,
        credit: posterCredit,
        sourceHeight: metadata.height,
        sourceUrl,
        sourceWidth: metadata.width,
        variants: Object.freeze(variants),
      }),
      summary,
      venue,
    }),
  );
}

manifestEvents.sort((left, right) => left.eventId.localeCompare(right.eventId));
await writeFile(
  MANIFEST_PATH,
  `${JSON.stringify({ schemaVersion: 1, events: manifestEvents }, null, 2)}\n`,
  "utf8",
);

console.log(
  `Refreshed ${manifestEvents.length} verified Meetup event enrichments.`,
);

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

function normalizePublicDescription(input) {
  const raw = readText(input, "event description", MAX_DESCRIPTION_LENGTH)
    .normalize("NFKC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*[*-]\s+/gmu, "• ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (
    raw.length < 10 ||
    raw.length > MAX_DESCRIPTION_LENGTH ||
    UNSAFE_CONTROL_PATTERN.test(raw) ||
    EMAIL_PATTERN.test(raw) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(raw)
  ) {
    throw new Error("Meetup description failed the public-safe allowlist.");
  }
  return raw;
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
