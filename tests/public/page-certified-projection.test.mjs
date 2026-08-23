import assert from "node:assert/strict";
import test from "node:test";
import { getPublicPageContent } from "../../lib/server/public/catalog.ts";

function projection({ sections = [section()], slug = "about" } = {}) {
  return {
    eventSelectionProofs: [],
    metadata: {
      metaDescription: "How Vancouver Curiosity Club builds community.",
      openGraphAssetId: null,
      seoTitle: "About Vancouver Curiosity Club",
    },
    page: {
      currentRevision: 7,
      slug,
      title: "About",
    },
    sections,
  };
}

function section(index = 1) {
  return {
    contentJson: JSON.stringify({
      heading: `Section ${index}`,
      text: `Public section ${index} content.`,
    }),
    sectionKey: `section-${index}`,
    sectionType: "prose",
    sortOrder: index * 10,
  };
}

function recordingDatabase(value) {
  const calls = [];
  return {
    calls,
    database: {
      prepare(sql) {
        const call = { bindings: [], sql };
        calls.push(call);
        return {
          bind(...bindings) {
            call.bindings = bindings;
            return this;
          },
          async first() {
            return value === null ? null : { projection_json: value };
          },
        };
      },
    },
  };
}

test("public page hot path reads one bounded certified projection", async () => {
  const sections = Array.from({ length: 24 }, (_, index) =>
    section(index + 1),
  );
  const recorded = recordingDatabase(JSON.stringify(projection({ sections })));
  const page = await getPublicPageContent(recorded.database, "about");

  assert.equal(recorded.calls.length, 1);
  assert.deepEqual(recorded.calls[0].bindings, [
    "vancouver-curiosity-and-education-society",
    "about",
  ]);
  assert.equal(page.sections.length, 24);
  assert.equal(page.sections[0].key, "section-1");
  assert.equal(page.sections[23].key, "section-24");

  const sql = recorded.calls[0].sql;
  assert.match(sql, /cms_public_materialization_receipts/u);
  assert.match(sql, /canonical_byte_size BETWEEN 2 AND 131072/u);
  assert.match(sql, /page\.status = 'published'/u);
  assert.match(sql, /page\.visibility = 'public'/u);
  assert.doesNotMatch(sql, /page_sections/u);
  assert.doesNotMatch(sql, /page_public_metadata/u);
  assert.doesNotMatch(sql, /json_each/u);
  assert.ok(
    sql.length < 6_000,
    `the certified page read grew to ${sql.length} SQL characters`,
  );
});

test("public page projection parsing fails closed on malformed receipts", async () => {
  const invalid = [
    "{",
    JSON.stringify(projection({ slug: "contact" })),
    JSON.stringify(
      projection({
        sections: Array.from({ length: 25 }, (_, index) =>
          section(index + 1),
        ),
      }),
    ),
    JSON.stringify(
      projection({ sections: [section(1), { ...section(2), sectionKey: "section-1" }] }),
    ),
    JSON.stringify(
      projection({ sections: [section(2), section(1)] }),
    ),
    JSON.stringify(
      projection({ sections: [{ ...section(1), sectionType: "script" }] }),
    ),
    JSON.stringify({ ...projection(), metadata: null }),
    JSON.stringify({
      ...projection(),
      page: { ...projection().page, currentRevision: 0 },
    }),
  ];

  for (const value of invalid) {
    const recorded = recordingDatabase(value);
    assert.equal(await getPublicPageContent(recorded.database, "about"), null);
    assert.equal(recorded.calls.length, 1);
  }
});

test("public page projection exposes no private event-selection proof", async () => {
  const value = projection();
  value.eventSelectionProofs = [
    {
      requestedId: "private-id",
      slug: "public-event",
      sourceIdentity: "private-source",
      sourceVersion: "private-version",
    },
  ];
  const recorded = recordingDatabase(JSON.stringify(value));
  const serialized = JSON.stringify(
    await getPublicPageContent(recorded.database, "about"),
  );
  assert.doesNotMatch(
    serialized,
    /private-id|private-source|private-version|eventSelectionProofs/u,
  );
});
