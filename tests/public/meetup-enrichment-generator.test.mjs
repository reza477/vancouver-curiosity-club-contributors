import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import sharp from "sharp";
import {
  assertAllowedMeetupPosterResponseUrl,
  assertCanonicalMeetupEventDocument,
  assertCanonicalMeetupEventResponseUrl,
  isManagedMeetupPosterFilename,
  normalizePublicDescription,
  refreshCuratedMeetupEnrichment,
} from "../../scripts/refresh-curated-meetup-enrichment.mjs";

const TEST_GROUP = "vancouver-meetup-group";
const TEST_EVENT_ID = "999999001";
const TEST_EVENT_URL =
  `https://www.meetup.com/${TEST_GROUP}/events/${TEST_EVENT_ID}/`;
const TEST_POSTER_URL =
  "https://secure.meetupstatic.com/photos/event/a/b/c/d/highres_999999001.jpeg";
const WORK_DIRECTORY = path.resolve(process.cwd(), "work");

test("the generator rejects unallowlisted groups and duplicate IDs before fetching", async () => {
  await withTemporaryWorkspace(async (workspaceRoot) => {
    for (const [events, expectedError] of [
      [
        [["not-an-approved-meetup-group", "999999002"]],
        /not-an-approved-meetup-group was not allowlisted/u,
      ],
      [
        [
          ["vancouver-meetup-group", "999999003"],
          ["vancouver-literature-and-film", "999999003"],
        ],
        /Duplicate Meetup event ID 999999003/u,
      ],
    ]) {
      let fetchCalls = 0;
      await assert.rejects(
        refreshCuratedMeetupEnrichment({
          events,
          fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error("fetch must not run");
          },
          workspaceRoot,
        }),
        expectedError,
      );
      assert.equal(fetchCalls, 0);
      await assertNoStagingDirectories(workspaceRoot);
    }
  });
});

test("redirect targets must retain the exact event identity and poster host", () => {
  assert.doesNotThrow(() =>
    assertCanonicalMeetupEventResponseUrl(
      TEST_EVENT_URL,
      TEST_GROUP,
      TEST_EVENT_ID,
    ),
  );
  for (const invalidEventUrl of [
    `https://meetup.com/${TEST_GROUP}/events/${TEST_EVENT_ID}/`,
    `https://www.meetup.com/vancouver-literature-and-film/events/${TEST_EVENT_ID}/`,
    `https://www.meetup.com/${TEST_GROUP}/events/999999004/`,
    `${TEST_EVENT_URL}?tracking=1`,
    TEST_EVENT_URL.slice(0, -1),
  ]) {
    assert.throws(
      () =>
        assertCanonicalMeetupEventResponseUrl(
          invalidEventUrl,
          TEST_GROUP,
          TEST_EVENT_ID,
        ),
      /unexpected final URL/u,
    );
  }

  assert.doesNotThrow(() =>
    assertCanonicalMeetupEventDocument(
      `<link rel="canonical" href="${TEST_EVENT_URL}">`,
      TEST_GROUP,
      TEST_EVENT_ID,
    ),
  );
  assert.throws(
    () =>
      assertCanonicalMeetupEventDocument(
        `<link rel="canonical" href="https://www.meetup.com/${TEST_GROUP}/events/rtvjztyjclbpb/">`,
        TEST_GROUP,
        TEST_EVENT_ID,
      ),
    /unexpected canonical URL/u,
  );

  assert.doesNotThrow(() =>
    assertAllowedMeetupPosterResponseUrl(TEST_POSTER_URL, TEST_EVENT_ID),
  );
  for (const invalidPosterUrl of [
    "https://secure.meetupstatic.com.attacker.invalid/photos/event/a/highres_1.jpeg",
    "https://attacker.invalid/photos/event/a/highres_1.jpeg",
    "http://secure.meetupstatic.com/photos/event/a/highres_1.jpeg",
  ]) {
    assert.throws(
      () =>
        assertAllowedMeetupPosterResponseUrl(
          invalidPosterUrl,
          TEST_EVENT_ID,
        ),
      /unexpected host/u,
    );
  }
});

test("only exact numeric Meetup poster filenames are managed", () => {
  for (const filename of [
    "meetup-123456.jpeg",
    "meetup-123456-480.jpeg",
    "meetup-123456-960.jpeg",
  ]) {
    assert.equal(isManagedMeetupPosterFilename(filename), true, filename);
  }
  for (const filename of [
    "manual-poster.jpeg",
    "meetup-event.jpeg",
    "meetup-123456.jpg",
    "meetup-123456-1600.jpeg",
    "meetup-123456-960.jpeg.bak",
  ]) {
    assert.equal(isManagedMeetupPosterFilename(filename), false, filename);
  }
});

test("a fully validated generation publishes staged outputs and then removes only stale managed files", async () => {
  await withTemporaryWorkspace(async (workspaceRoot) => {
    const posterDirectory = path.join(
      workspaceRoot,
      "public",
      "event-posters",
    );
    const manifestPath = path.join(
      workspaceRoot,
      "lib",
      "meetup-event-enrichment.generated.json",
    );
    await mkdir(posterDirectory, { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, "old manifest\n", "utf8");
    await writeFile(
      path.join(posterDirectory, "meetup-888888888.jpeg"),
      "stale managed poster",
      "utf8",
    );
    await writeFile(
      path.join(posterDirectory, "meetup-888888888-480.jpeg"),
      "stale managed poster",
      "utf8",
    );
    await writeFile(
      path.join(posterDirectory, "meetup-888888888-1600.jpeg"),
      "manual width variant",
      "utf8",
    );
    await writeFile(
      path.join(posterDirectory, "manual-poster.jpeg"),
      "manual poster",
      "utf8",
    );

    const count = await refreshCuratedMeetupEnrichment({
      events: [[TEST_GROUP, TEST_EVENT_ID]],
      fetchImpl: createMockFetch(),
      workspaceRoot,
    });
    assert.equal(count, 1);

    const manifestText = await readFile(manifestPath, "utf8");
    assert.equal(manifestText.endsWith("\n"), true);
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.schemaVersion, 3);
    assert.equal(manifest.events.length, 1);
    assert.equal(manifest.events[0].eventId, TEST_EVENT_ID);
    assert.equal(manifest.events[0].eventUrl, TEST_EVENT_URL);
    assert.ok(manifest.events[0].descriptionBlocks.length >= 1);
    assert.deepEqual(manifest.events[0].poster.variants, {
      small: {
        height: 270,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}-480.jpeg`,
        width: 480,
      },
      medium: {
        height: 540,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}-960.jpeg`,
        width: 960,
      },
      large: {
        height: 675,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}.jpeg`,
        width: 1200,
      },
    });

    for (const [filename, width, height] of [
      [`meetup-${TEST_EVENT_ID}-480.jpeg`, 480, 270],
      [`meetup-${TEST_EVENT_ID}-960.jpeg`, 960, 540],
      [`meetup-${TEST_EVENT_ID}.jpeg`, 1200, 675],
    ]) {
      const metadata = await sharp(path.join(posterDirectory, filename)).metadata();
      assert.equal(metadata.width, width, filename);
      assert.equal(metadata.height, height, filename);
    }

    await assertMissing(path.join(posterDirectory, "meetup-888888888.jpeg"));
    await assertMissing(
      path.join(posterDirectory, "meetup-888888888-480.jpeg"),
    );
    assert.equal(
      await readFile(
        path.join(posterDirectory, "meetup-888888888-1600.jpeg"),
        "utf8",
      ),
      "manual width variant",
    );
    assert.equal(
      await readFile(path.join(posterDirectory, "manual-poster.jpeg"), "utf8"),
      "manual poster",
    );
    await assertNoStagingDirectories(workspaceRoot);
  });
});

test("Meetup Markdown becomes bounded semantic blocks with allowlisted public links", () => {
  const result = normalizePublicDescription(`**Short summary**
A sufficiently detailed public event description.

**Questions**
* What should we discuss?
* What might change our minds?

**Ticket note**
Buy your VIFF ticket here:
[https://viff.org/whats-on/example/book/abc](https://viff.org/whats-on/example/book/abc)`);

  assert.deepEqual(result.blocks, [
    {
      content: [{ text: "Short summary", type: "text" }],
      level: 3,
      type: "heading",
    },
    {
      content: [
        {
          text: "A sufficiently detailed public event description.",
          type: "text",
        },
      ],
      type: "paragraph",
    },
    {
      content: [{ text: "Questions", type: "text" }],
      level: 3,
      type: "heading",
    },
    {
      items: [
        [{ text: "What should we discuss?", type: "text" }],
        [{ text: "What might change our minds?", type: "text" }],
      ],
      type: "unordered-list",
    },
    {
      content: [{ text: "Ticket note", type: "text" }],
      level: 3,
      type: "heading",
    },
    {
      content: [
        {
          href: "https://viff.org/whats-on/example/book/abc",
          text: "Buy your VIFF ticket here",
          type: "link",
        },
      ],
      type: "paragraph",
    },
  ]);
  assert.match(result.plainText, /Buy your VIFF ticket here/u);
  assert.doesNotMatch(result.plainText, /Open viff\.org/u);
  assert.doesNotMatch(result.plainText, /https?:\/\//u);

  const standaloneCallToAction = normalizePublicDescription(`Short summary
A safe event description with a separate source link.

Reading Magnifica Humanitas - my summary of it:

[https://drive.google.com/file/d/example/view](https://drive.google.com/file/d/example/view)`);
  assert.deepEqual(standaloneCallToAction.blocks.at(-1), {
    content: [
      {
        href: "https://drive.google.com/file/d/example/view",
        text: "Reading Magnifica Humanitas - my summary of it",
        type: "link",
      },
    ],
    type: "paragraph",
  });
  assert.doesNotMatch(
    standaloneCallToAction.plainText,
    /Open drive\.google\.com/u,
  );

  const unapproved = normalizePublicDescription(
    "Short summary\nA safe event description.\n\nResource\n[Open it](https://zoom.us/j/123456)",
  );
  assert.equal(
    JSON.stringify(unapproved.blocks).includes('"type":"link"'),
    false,
  );
  assert.match(unapproved.plainText, /Open it/u);

  for (const unsafe of [
    "Short summary\nA safe description.\n\n<script>alert(1)</script>",
    "Short summary\nA safe description.\n\n![remote](https://viff.org/image.jpg)",
    "Short summary\nContact person@example.invalid for details.",
    "Short summary\n[Open](javascript:alert(1)) for details.",
  ]) {
    assert.throws(
      () => normalizePublicDescription(unsafe),
      /description failed the public-safe allowlist/u,
    );
  }
});

test("a validation failure discards staged files and leaves published files untouched", async () => {
  await withTemporaryWorkspace(async (workspaceRoot) => {
    const posterDirectory = path.join(
      workspaceRoot,
      "public",
      "event-posters",
    );
    const manifestPath = path.join(
      workspaceRoot,
      "lib",
      "meetup-event-enrichment.generated.json",
    );
    const stalePosterPath = path.join(
      posterDirectory,
      "meetup-888888888.jpeg",
    );
    await mkdir(posterDirectory, { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, "old manifest\n", "utf8");
    await writeFile(stalePosterPath, "stale but retained", "utf8");

    await assert.rejects(
      refreshCuratedMeetupEnrichment({
        events: [[TEST_GROUP, TEST_EVENT_ID]],
        fetchImpl: createMockFetch({
          description:
            "Contact private-person@example.invalid for the hidden details.",
        }),
        workspaceRoot,
      }),
      /description failed the public-safe allowlist/u,
    );

    assert.equal(await readFile(manifestPath, "utf8"), "old manifest\n");
    assert.equal(await readFile(stalePosterPath, "utf8"), "stale but retained");
    await assertMissing(
      path.join(posterDirectory, `meetup-${TEST_EVENT_ID}.jpeg`),
    );
    await assertMissing(
      path.join(posterDirectory, `meetup-${TEST_EVENT_ID}-480.jpeg`),
    );
    await assertMissing(
      path.join(posterDirectory, `meetup-${TEST_EVENT_ID}-960.jpeg`),
    );
    await assertNoStagingDirectories(workspaceRoot);
  });
});

test("a smaller valid Meetup poster stays native-size instead of being upscaled", async () => {
  await withTemporaryWorkspace(async (workspaceRoot) => {
    const count = await refreshCuratedMeetupEnrichment({
      events: [[TEST_GROUP, TEST_EVENT_ID]],
      fetchImpl: createMockFetch({ posterHeight: 450, posterWidth: 800 }),
      workspaceRoot,
    });
    assert.equal(count, 1);

    const manifest = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "lib",
          "meetup-event-enrichment.generated.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.events[0].poster.variants, {
      large: {
        height: 450,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}.jpeg`,
        width: 800,
      },
      medium: {
        height: 450,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}-960.jpeg`,
        width: 800,
      },
      small: {
        height: 270,
        localPath: `/event-posters/meetup-${TEST_EVENT_ID}-480.jpeg`,
        width: 480,
      },
    });
    const posterFiles = (await readdir(
      path.join(workspaceRoot, "public", "event-posters"),
    )).sort();
    assert.deepEqual(posterFiles, [
      `meetup-${TEST_EVENT_ID}-480.jpeg`,
      `meetup-${TEST_EVENT_ID}-960.jpeg`,
      `meetup-${TEST_EVENT_ID}.jpeg`,
    ]);
    await assertNoStagingDirectories(workspaceRoot);
  });
});

test("an image smaller than the card target keeps the controlled fallback", async () => {
  await withTemporaryWorkspace(async (workspaceRoot) => {
    const count = await refreshCuratedMeetupEnrichment({
      events: [[TEST_GROUP, TEST_EVENT_ID]],
      fetchImpl: createMockFetch({ posterHeight: 180, posterWidth: 320 }),
      workspaceRoot,
    });
    assert.equal(count, 1);
    const manifest = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "lib",
          "meetup-event-enrichment.generated.json",
        ),
        "utf8",
      ),
    );
    assert.equal(manifest.events[0].poster, null);
    assert.deepEqual(
      await readdir(path.join(workspaceRoot, "public", "event-posters")),
      [],
    );
    await assertNoStagingDirectories(workspaceRoot);
  });
});

test("poster and manifest promotion failures restore every previously published file", async (context) => {
  for (const failureKind of ["poster", "manifest"]) {
    await context.test(`${failureKind} promotion failure`, async () => {
      await withTemporaryWorkspace(async (workspaceRoot) => {
        const posterDirectory = path.join(
          workspaceRoot,
          "public",
          "event-posters",
        );
        const manifestPath = path.join(
          workspaceRoot,
          "lib",
          "meetup-event-enrichment.generated.json",
        );
        const oldManifest = "previously published manifest\n";
        const oldPosterContents = new Map([
          [`meetup-${TEST_EVENT_ID}-480.jpeg`, "previous small poster"],
          [`meetup-${TEST_EVENT_ID}-960.jpeg`, "previous medium poster"],
          [`meetup-${TEST_EVENT_ID}.jpeg`, "previous large poster"],
        ]);
        const stalePosterPath = path.join(
          posterDirectory,
          "meetup-888888888.jpeg",
        );
        await mkdir(posterDirectory, { recursive: true });
        await mkdir(path.dirname(manifestPath), { recursive: true });
        await writeFile(manifestPath, oldManifest, "utf8");
        for (const [filename, contents] of oldPosterContents) {
          await writeFile(
            path.join(posterDirectory, filename),
            contents,
            "utf8",
          );
        }
        await writeFile(stalePosterPath, "stale poster must remain", "utf8");

        let posterPromotionCount = 0;
        await assert.rejects(
          refreshCuratedMeetupEnrichment({
            beforePromote: ({ kind }) => {
              if (kind === "poster") posterPromotionCount += 1;
              if (
                (failureKind === "poster" &&
                  kind === "poster" &&
                  posterPromotionCount === 2) ||
                (failureKind === "manifest" && kind === "manifest")
              ) {
                throw new Error(`Injected ${failureKind} promotion failure.`);
              }
            },
            events: [[TEST_GROUP, TEST_EVENT_ID]],
            fetchImpl: createMockFetch(),
            workspaceRoot,
          }),
          new RegExp(`Injected ${failureKind} promotion failure`, "u"),
        );

        assert.equal(await readFile(manifestPath, "utf8"), oldManifest);
        for (const [filename, contents] of oldPosterContents) {
          assert.equal(
            await readFile(path.join(posterDirectory, filename), "utf8"),
            contents,
            filename,
          );
        }
        assert.equal(
          await readFile(stalePosterPath, "utf8"),
          "stale poster must remain",
        );
        await assertNoPublicationSidecars(posterDirectory);
        await assertNoPublicationSidecars(path.dirname(manifestPath));
        await assertNoStagingDirectories(workspaceRoot);
      });
    });
  }
});

function createMockFetch({
  description =
    "Short summary\nA sufficiently detailed public event description for testing.\n\nQuestions\nWhat should we discuss?",
  posterHeight = 675,
  posterWidth = 1200,
} = {}) {
  let posterBytesPromise;
  return async (url) => {
    if (url === TEST_EVENT_URL) {
      return Object.freeze({
        headers: Object.freeze({ get: () => "text/html" }),
        ok: true,
        status: 200,
        text: async () =>
          `<link rel="canonical" href="${TEST_EVENT_URL}"><script id="__NEXT_DATA__">${JSON.stringify({
            props: {
              pageProps: {
                event: {
                  description,
                  featuredEventPhoto: { source: TEST_POSTER_URL },
                  group: { urlname: TEST_GROUP },
                  id: TEST_EVENT_ID,
                  title: "Generator hardening test event",
                  venue: {
                    address: "350 West Georgia Street",
                    city: "Vancouver",
                    name: "Vancouver Central Library",
                    state: "BC",
                  },
                },
              },
            },
          })}</script>`,
        url: TEST_EVENT_URL,
      });
    }
    if (url === TEST_POSTER_URL) {
      posterBytesPromise ??= sharp({
        create: {
          background: { alpha: 1, b: 32, g: 64, r: 96 },
          channels: 4,
          height: posterHeight,
          width: posterWidth,
        },
      })
        .jpeg()
        .toBuffer();
      const bytes = await posterBytesPromise;
      return Object.freeze({
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        headers: Object.freeze({ get: () => "image/jpeg" }),
        ok: true,
        status: 200,
        url: TEST_POSTER_URL,
      });
    }
    throw new Error(`Unexpected mock fetch URL: ${url}`);
  };
}

async function withTemporaryWorkspace(callback) {
  await mkdir(WORK_DIRECTORY, { recursive: true });
  const workspaceRoot = await mkdtemp(
    path.join(WORK_DIRECTORY, "meetup-enrichment-generator-"),
  );
  try {
    await callback(workspaceRoot);
  } finally {
    assert.equal(
      workspaceRoot.startsWith(`${WORK_DIRECTORY}${path.sep}`),
      true,
    );
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

async function assertMissing(filePath) {
  await assert.rejects(access(filePath), { code: "ENOENT" });
}

async function assertNoStagingDirectories(workspaceRoot) {
  const entries = await readdir(workspaceRoot);
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith(".meetup-enrichment-")),
    [],
  );
}

async function assertNoPublicationSidecars(directory) {
  const entries = await readdir(directory);
  assert.deepEqual(
    entries.filter(
      (entry) => entry.endsWith(".publish") || entry.endsWith(".rollback"),
    ),
    [],
  );
}
