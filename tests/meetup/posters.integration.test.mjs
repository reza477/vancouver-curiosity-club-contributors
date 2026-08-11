import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { synchronizedMeetupPosterResponse } from "../../lib/server/meetup/poster-response.ts";
import { getSynchronizedMeetupPoster } from "../../lib/server/meetup/posters.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const GROUP_SLUG = "synthetic-public-group";
const EVENT_ID = "9001";
const EVENT_URL = `https://www.meetup.com/${GROUP_SLUG}/events/${EVENT_ID}/`;
const POSTER_SOURCE_URL =
  "https://secure.meetupstatic.com/photos/event/a/b/c/highres_535545462.jpeg";
const STAGING_POSTER_SOURCE_URL =
  "https://secure.meetupstatic.com/photos/event/d/e/f/highres_999999999.jpeg";

function loadGeneratedMigrations() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
}

function createPosterDatabase() {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_owner', 'email:owner@synthetic.invalid',
      'owner@synthetic.invalid', 'Synthetic Owner', 'active', 1, 1
    );

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'org_poster', 'Poster Test Organization', 'poster-test-organization',
      'America/Vancouver', 1, 'profile_owner', 'profile_owner', 1, 1
    );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club_poster', 'org_poster', 'Poster Test Club', 'poster-test-club',
      'profile_owner', 1, 1
    );

    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event_poster', 'org_poster', 'club_poster', 'Poster Test Event',
      'poster-test-event', 'draft', 'public', 'timed',
      1786323600000, 1786330800000, 'America/Vancouver', '[]', 1,
      'unreviewed', 1, 'profile_owner', 'profile_owner', 1, 1
    );

    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url, enabled,
      refresh_interval_minutes, active_generation_id,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source_poster', 'org_poster', 'club_poster', 'meetup_ics',
      'https://www.meetup.com/${GROUP_SLUG}/events/ical/', 1, 15,
      'generation_active', 'profile_owner', 'profile_owner', 1, 1
    );

    INSERT INTO meetup_sync_generations (
      id, organization_id, sync_source_id, previous_generation_id,
      snapshot_hash, expected_item_count, processed_item_count,
      rejected_item_count, state, removed_count, created_at, updated_at,
      published_at, failed_at
    ) VALUES
      (
        'generation_active', 'org_poster', 'source_poster', NULL,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        1, 1, 0, 'published', 0, 1, 1, 1, NULL
      ),
      (
        'generation_staging', 'org_poster', 'source_poster',
        'generation_active',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1, 1, 0, 'staging', 0, 2, 2, NULL, NULL
      );

    INSERT INTO meetup_event_snapshots (
      id, organization_id, sync_source_id, generation_id, external_id,
      event_id, ordinal, event_slug, title, event_url, status, time_kind, starts_at_utc,
      ends_at_utc, timezone, source_fingerprint, source_sequence,
      source_last_modified_at, created_at, updated_at
    ) VALUES
      (
        'snapshot_active', 'org_poster', 'source_poster',
        'generation_active', 'active-event', 'event_poster', 0,
        'poster-test-event', 'Active Poster Event', '${EVENT_URL}',
        'confirmed', 'timed', 1786323600000, 1786330800000,
        'America/Vancouver', 'active-fingerprint', 1, 1, 1, 1
      ),
      (
        'snapshot_staging', 'org_poster', 'source_poster',
        'generation_staging', 'staging-event', 'event_poster', 0,
        'poster-test-event', 'Staging Poster Event', '${EVENT_URL}',
        'confirmed', 'timed', 1786323600000,
        1786330800000, 'America/Vancouver', 'staging-fingerprint', 2, 2, 2, 2
      );

    INSERT INTO meetup_event_snapshot_public_contents (
      snapshot_id, public_summary, public_description,
      public_description_blocks_json, poster_source_url, poster_alt_text,
      poster_credit, created_at, updated_at
    ) VALUES
      (
        'snapshot_active', 'Active poster summary.',
        'Active poster description.',
        '[{"type":"paragraph","content":[{"type":"text","text":"Active poster description."}]}]',
        '${POSTER_SOURCE_URL}', 'Active event poster.',
        'Meetup poster credit', 1, 1
      ),
      (
        'snapshot_staging', 'Staging poster summary.',
        'Staging poster description.',
        '[{"type":"paragraph","content":[{"type":"text","text":"Staging poster description."}]}]',
        '${STAGING_POSTER_SOURCE_URL}', 'Staging poster sentinel.',
        'Staging credit sentinel', 2, 2
      );
  `);
  return database;
}

async function createImageFixtures() {
  const jpeg = await sharp({
    create: {
      width: 1_600,
      height: 900,
      channels: 3,
      background: { r: 23, g: 42, b: 77 },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
  const webp480 = await sharp(jpeg)
    .resize({ width: 480 })
    .webp({ quality: 85 })
    .toBuffer();
  const webp479 = await sharp(jpeg)
    .resize({ width: 479 })
    .webp({ quality: 85 })
    .toBuffer();
  const jpeg480 = await sharp(jpeg)
    .resize({ width: 480, height: 270, fit: "cover" })
    .jpeg({ quality: 88 })
    .toBuffer();
  const webp1600 = await sharp(jpeg480)
    .resize({ width: 1_600, height: 900, fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
  return { jpeg, jpeg480, webp479, webp480, webp1600 };
}

function responseWithUrl(body, sourceUrl, init) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: sourceUrl,
  });
  return response;
}

function jpegFetcher(bytes, calls, responseUrl = POSTER_SOURCE_URL) {
  return async (url, init) => {
    calls.push({ init, url: String(url) });
    return responseWithUrl(bytes, responseUrl, {
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "image/jpeg",
      },
      status: 200,
    });
  };
}

function imagesBinding(outputBytes, calls, { status = 200 } = {}) {
  return {
    input(stream) {
      calls.push({ kind: "input", stream });
      return {
        transform(options) {
          calls.push({ kind: "transform", options });
          return {
            async output(options) {
              calls.push({ kind: "output", options });
              return {
                response() {
                  return new Response(outputBytes, {
                    headers: { "content-type": "image/webp" },
                    status,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

class MemoryPosterBucket {
  constructor() {
    this.objects = new Map();
    this.gets = [];
    this.puts = [];
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  async get(key) {
    this.gets.push(key);
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = Uint8Array.from(stored);
    return {
      arrayBuffer: async () => bytes.slice().buffer,
      body: new Response(bytes).body,
      size: bytes.byteLength,
    };
  }

  async put(key, value, options) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, Uint8Array.from(bytes));
    this.puts.push({ key, options, size: bytes.byteLength });
  }
}

function assertSafeError(error, code, status) {
  assert.equal(error?.name, "SafeApplicationError");
  assert.equal(error?.code, code);
  assert.equal(error?.status, status);
  return true;
}

test("active published Meetup poster is transformed once, cached in R2, and isolated from staging", async (t) => {
  const database = createPosterDatabase();
  t.after(() => database.close());
  const { jpeg, webp480 } = await createImageFixtures();
  const bucket = new MemoryPosterBucket();
  const fetchCalls = [];
  const imageCalls = [];

  const first = await getSynchronizedMeetupPoster(
    database,
    bucket,
    imagesBinding(webp480, imageCalls),
    {
      eventId: EVENT_ID,
      fetcher: jpegFetcher(jpeg, fetchCalls),
      groupSlug: GROUP_SLUG,
      variant: "small",
    },
  );
  const sourceDigest = createHash("sha256")
    .update(POSTER_SOURCE_URL)
    .digest("hex");
  const expectedKey = `meetup-posters/${sourceDigest}/480.webp`;
  assert.equal(first.etag, sourceDigest);
  assert.equal(first.mimeType, "image/webp");
  assert.deepEqual(
    new Uint8Array(first.body),
    new Uint8Array(webp480),
  );
  assert.deepEqual(fetchCalls, [
    {
      init: {
        cache: "no-store",
        headers: {
          Accept: "image/jpeg",
          "User-Agent":
            "Vancouver-Curiosity-Club-Meetup-Poster-Sync/1.0",
        },
        redirect: "manual",
      },
      url: POSTER_SOURCE_URL,
    },
  ]);
  assert.deepEqual(
    imageCalls.filter((call) => call.kind !== "input"),
    [
      {
        kind: "transform",
        options: { fit: "cover", height: 270, width: 480 },
      },
      { kind: "output", options: { format: "image/webp", quality: 85 } },
    ],
  );
  assert.deepEqual(bucket.puts, [
    {
      key: expectedKey,
      options: { httpMetadata: { contentType: "image/webp" } },
      size: webp480.byteLength,
    },
  ]);

  const second = await getSynchronizedMeetupPoster(
    database,
    bucket,
    {
      input() {
        throw new Error("A cache hit must not invoke Images.");
      },
    },
    {
      eventId: EVENT_ID,
      fetcher: async () => {
        throw new Error("A cache hit must not fetch Meetup.");
      },
      groupSlug: GROUP_SLUG,
      variant: "small",
    },
  );
  assert.deepEqual(new Uint8Array(second.body), new Uint8Array(webp480));
  assert.deepEqual(bucket.gets, [expectedKey, expectedKey]);
  assert.equal(fetchCalls[0].url, POSTER_SOURCE_URL);
  assert.notEqual(fetchCalls[0].url, STAGING_POSTER_SOURCE_URL);
});

test("every poster route serves the exact dimensions advertised by its public srcset", async (t) => {
  const database = createPosterDatabase();
  t.after(() => database.close());
  const { jpeg480, webp1600 } = await createImageFixtures();
  const imageCalls = [];
  const poster = await getSynchronizedMeetupPoster(
    database,
    new MemoryPosterBucket(),
    imagesBinding(webp1600, imageCalls),
    {
      eventId: EVENT_ID,
      fetcher: jpegFetcher(jpeg480, []),
      groupSlug: GROUP_SLUG,
      variant: "large",
    },
  );
  const metadata = await sharp(Buffer.from(poster.body)).metadata();
  assert.deepEqual(
    { height: metadata.height, width: metadata.width },
    { height: 900, width: 1_600 },
  );
  assert.deepEqual(
    imageCalls.find((call) => call.kind === "transform")?.options,
    { fit: "cover", height: 900, width: 1_600 },
  );
});

test("a cancelled Meetup detail keeps its poster only after an earlier published occurrence", async (t) => {
  const database = createPosterDatabase();
  t.after(() => database.close());
  const { jpeg, webp480 } = await createImageFixtures();
  database.exec(`
    INSERT INTO meetup_sync_generations (
      id, organization_id, sync_source_id, previous_generation_id,
      snapshot_hash, expected_item_count, processed_item_count,
      rejected_item_count, state, removed_count, created_at, updated_at,
      published_at, failed_at
    ) VALUES (
      'generation_previous', 'org_poster', 'source_poster', NULL,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      1, 1, 0, 'published', 0, 0, 0, 0, NULL
    );
    INSERT INTO meetup_event_snapshots (
      id, organization_id, sync_source_id, generation_id, external_id,
      event_id, ordinal, event_slug, title, event_url, status, time_kind,
      starts_at_utc, ends_at_utc, timezone, source_fingerprint,
      source_sequence, source_last_modified_at, created_at, updated_at
    ) VALUES (
      'snapshot_previous', 'org_poster', 'source_poster',
      'generation_previous', 'active-event', 'event_poster', 0,
      'poster-test-event', 'Previously Active Poster Event', '${EVENT_URL}',
      'confirmed', 'timed', 1786323600000, 1786330800000,
      'America/Vancouver', 'previous-fingerprint', 0, 0, 0, 0
    );
    UPDATE meetup_event_snapshots
    SET status = 'cancelled'
    WHERE id = 'snapshot_active';
  `);

  const fetchCalls = [];
  const poster = await getSynchronizedMeetupPoster(
    database,
    new MemoryPosterBucket(),
    imagesBinding(webp480, []),
    {
      eventId: EVENT_ID,
      fetcher: jpegFetcher(jpeg, fetchCalls),
      groupSlug: GROUP_SLUG,
      variant: "small",
    },
  );
  assert.equal(poster.mimeType, "image/webp");
  assert.equal(fetchCalls.length, 1);

  database.exec(`
    DELETE FROM meetup_event_snapshots WHERE id = 'snapshot_previous';
    DELETE FROM meetup_sync_generations WHERE id = 'generation_previous';
  `);
  await assert.rejects(
    getSynchronizedMeetupPoster(
      database,
      new MemoryPosterBucket(),
      imagesBinding(webp480, []),
      {
        eventId: EVENT_ID,
        fetcher: jpegFetcher(jpeg, []),
        groupSlug: GROUP_SLUG,
        variant: "small",
      },
    ),
    (error) => assertSafeError(error, "not_found", 404),
  );
});

test("poster lookup fails closed for inactive records and non-allowlisted source URLs", async (t) => {
  const database = createPosterDatabase();
  t.after(() => database.close());
  const bucket = new MemoryPosterBucket();
  let fetchCount = 0;
  const unreachableFetcher = async () => {
    fetchCount += 1;
    throw new Error("The source must be rejected before fetch.");
  };
  const unreachableImages = {
    input() {
      throw new Error("The source must be rejected before transform.");
    },
  };

  database.exec(`
    UPDATE meetup_event_snapshot_public_contents
    SET poster_source_url = 'https://images.example.test/photos/event/a/b/highres_1.jpeg'
    WHERE snapshot_id = 'snapshot_active'
  `);
  await assert.rejects(
    getSynchronizedMeetupPoster(database, bucket, unreachableImages, {
      eventId: EVENT_ID,
      fetcher: unreachableFetcher,
      groupSlug: GROUP_SLUG,
      variant: "small",
    }),
    (error) => assertSafeError(error, "not_found", 404),
  );
  assert.equal(fetchCount, 0);

  database.exec(`
    UPDATE meetup_event_snapshot_public_contents
    SET poster_source_url = '${POSTER_SOURCE_URL}'
    WHERE snapshot_id = 'snapshot_active';
    UPDATE sync_sources SET enabled = 0 WHERE id = 'source_poster';
  `);
  await assert.rejects(
    getSynchronizedMeetupPoster(database, bucket, unreachableImages, {
      eventId: EVENT_ID,
      fetcher: unreachableFetcher,
      groupSlug: GROUP_SLUG,
      variant: "small",
    }),
    (error) => assertSafeError(error, "not_found", 404),
  );
  assert.equal(fetchCount, 0);
});

test("poster fetch redirects and failed or malformed transforms return a bounded unavailable error", async (t) => {
  const { jpeg, webp479, webp480 } = await createImageFixtures();

  await t.test("redirected source", async (subtest) => {
    const database = createPosterDatabase();
    subtest.after(() => database.close());
    await assert.rejects(
      getSynchronizedMeetupPoster(
        database,
        new MemoryPosterBucket(),
        imagesBinding(webp480, []),
        {
          eventId: EVENT_ID,
          fetcher: jpegFetcher(
            jpeg,
            [],
            "https://secure.meetupstatic.com/photos/event/a/b/c/highres_2.jpeg",
          ),
          groupSlug: GROUP_SLUG,
          variant: "small",
        },
      ),
      (error) => assertSafeError(error, "service_unavailable", 503),
    );
  });

  await t.test("failed transform", async (subtest) => {
    const database = createPosterDatabase();
    subtest.after(() => database.close());
    const bucket = new MemoryPosterBucket();
    await assert.rejects(
      getSynchronizedMeetupPoster(
        database,
        bucket,
        imagesBinding(webp480, [], { status: 502 }),
        {
          eventId: EVENT_ID,
          fetcher: jpegFetcher(jpeg, []),
          groupSlug: GROUP_SLUG,
          variant: "small",
        },
      ),
      (error) => assertSafeError(error, "service_unavailable", 503),
    );
    assert.equal(bucket.puts.length, 0);
  });

  await t.test("wrong transform dimensions", async (subtest) => {
    const database = createPosterDatabase();
    subtest.after(() => database.close());
    const bucket = new MemoryPosterBucket();
    await assert.rejects(
      getSynchronizedMeetupPoster(
        database,
        bucket,
        imagesBinding(webp479, []),
        {
          eventId: EVENT_ID,
          fetcher: jpegFetcher(jpeg, []),
          groupSlug: GROUP_SLUG,
          variant: "small",
        },
      ),
      (error) => assertSafeError(error, "service_unavailable", 503),
    );
    assert.equal(bucket.puts.length, 0);
  });
});

test("the binding-injected poster response serves cacheable bytes and conditional requests", async (t) => {
  const database = createPosterDatabase();
  t.after(() => database.close());
  const { webp480 } = await createImageFixtures();
  const bucket = new MemoryPosterBucket();
  const sourceDigest = createHash("sha256")
    .update(POSTER_SOURCE_URL)
    .digest("hex");
  const objectKey = `meetup-posters/${sourceDigest}/480.webp`;
  await bucket.put(objectKey, webp480, {
    httpMetadata: { contentType: "image/webp" },
  });
  const dependencies = {
    bucket,
    database,
    images: {
      input() {
        throw new Error("A cached poster must not invoke Images.");
      },
    },
  };
  const input = {
    eventId: EVENT_ID,
    groupSlug: GROUP_SLUG,
    variant: "small",
  };
  const etag = `"${sourceDigest}-small"`;

  const response = await synchronizedMeetupPosterResponse(
    new Request(`https://example.test/meetup-posters/${GROUP_SLUG}/${EVENT_ID}/small`),
    dependencies,
    input,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("content-disposition"), "inline");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=3600, stale-while-revalidate=86400",
  );
  assert.equal(response.headers.get("etag"), etag);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array(webp480),
  );

  const conditional = await synchronizedMeetupPosterResponse(
    new Request(
      `https://example.test/meetup-posters/${GROUP_SLUG}/${EVENT_ID}/small`,
      { headers: { "If-None-Match": etag } },
    ),
    dependencies,
    input,
  );
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.get("etag"), etag);
  assert.equal((await conditional.arrayBuffer()).byteLength, 0);
});

test("the Worker intercepts synchronized poster routes with runtime bindings before app work", async () => {
  const workerSource = await readFile(
    join(process.cwd(), "worker", "index.ts"),
    "utf8",
  );
  const routeSource = await readFile(
    join(
      process.cwd(),
      "app",
      "meetup-posters",
      "[groupSlug]",
      "[eventId]",
      "[variant]",
      "route.ts",
    ),
    "utf8",
  );

  assert.match(
    workerSource,
    /const SYNCHRONIZED_MEETUP_POSTER_PATH\s*=\s*\/\^\\\/meetup-posters\\\/\(\[a-z0-9-\]\+\)\\\/\(\[0-9\]\+\)\\\/\(small\|medium\|large\)\$\/u/u,
  );
  const posterInterceptionIndex = workerSource.indexOf(
    "const synchronizedPosterMatch",
  );
  const invariantIndex = workerSource.indexOf(
    "const invariantStatus = await ensureDatabaseInvariants",
  );
  const handlerIndex = workerSource.indexOf("await handler.fetch");
  assert.ok(posterInterceptionIndex >= 0);
  assert.ok(
    posterInterceptionIndex < invariantIndex,
    "poster delivery must not wait for database-wide invariants",
  );
  assert.ok(
    posterInterceptionIndex < handlerIndex,
    "poster delivery must bypass the framework route handler",
  );
  assert.match(
    workerSource,
    /if \(synchronizedPosterMatch\) \{[\s\S]*?synchronizedMeetupPosterResponse\(\s*request,\s*\{\s*bucket: env\.MEDIA,\s*database: env\.DB,\s*images: env\.IMAGES,?\s*\},[\s\S]*?eventId: synchronizedPosterMatch\[2\],[\s\S]*?groupSlug: synchronizedPosterMatch\[1\],[\s\S]*?variant: synchronizedPosterMatch\[3\],[\s\S]*?safeErrorResponse\(error,[\s\S]*?return secureResponse\(/u,
  );
  assert.match(
    routeSource,
    /synchronizedMeetupPosterResponse\([\s\S]*?bucket:\s*getRuntimeMediaBucket\(\),[\s\S]*?database:\s*getRuntimeAuthConfiguration\(\)\.database,[\s\S]*?images:\s*getRuntimeImagesBinding\(\)/u,
  );
  assert.match(routeSource, /safeErrorResponse\(error/u);
});

test("public poster route keeps bytes first-party, cacheable, conditional, and nosniff", async () => {
  const routeSource = await readFile(
    join(
      process.cwd(),
      "app",
      "meetup-posters",
      "[groupSlug]",
      "[eventId]",
      "[variant]",
      "route.ts",
    ),
    "utf8",
  );
  const responseSource = await readFile(
    join(
      process.cwd(),
      "lib",
      "server",
      "meetup",
      "poster-response.ts",
    ),
    "utf8",
  );
  assert.match(routeSource, /synchronizedMeetupPosterResponse\(/u);
  assert.match(routeSource, /getRuntimeMediaBucket\(\)/u);
  assert.match(routeSource, /getRuntimeImagesBinding\(\)/u);
  assert.match(responseSource, /getSynchronizedMeetupPoster\(/u);
  assert.match(responseSource, /request\.headers\.get\("if-none-match"\) === etag/u);
  assert.match(responseSource, /status:\s*304/u);
  assert.match(
    responseSource,
    /"Cache-Control":\s*"public, max-age=3600, stale-while-revalidate=86400"/u,
  );
  assert.match(responseSource, /"Content-Disposition":\s*"inline"/u);
  assert.match(responseSource, /"X-Content-Type-Options":\s*"nosniff"/u);
  assert.match(routeSource, /safeErrorResponse\(error/u);
  assert.doesNotMatch(
    `${routeSource}\n${responseSource}`,
    /secure\.meetupstatic\.com/u,
  );
});
