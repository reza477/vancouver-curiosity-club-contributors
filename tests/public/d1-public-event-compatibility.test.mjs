import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_ENRICHMENT_SQL,
  PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL,
  getAuthorizedOrganizerEventPublicPreview,
  getEditorialPublicEvents,
  getPublicEventBySlug,
  getPublicEventExportRecordBySlug,
  getPublicEventsBySlugs,
  listPublishedEventSelections,
  listPublicEventCategoryOptions,
  listPublicEventSitemapEntries,
  listRelatedPublicEvents,
  listUpcomingPublicEvents,
  listUpcomingPublicMeetupEvents,
  queryPublicCalendarMonth,
  queryPublicEventSlice,
  queryPublicEvents,
  queryPublicEventsForExport,
  revalidatePublicEventExportRecords,
  resolveEditorialPublishedEventSelections,
  resolvePublishedEventSelections,
} from "../../lib/server/public/events.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";

const MAX_D1_STATEMENT_BYTES = 100_000;
const ORGANIZATION_ID = "org-d1-public-compatibility";
const TODAY_DATE = "2026-07-27";
const NOW_UTC_MS = Date.parse("2026-07-27T12:00:00.000Z");

const workerScript = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    try {
      if (input.mode === "batch") {
        const result = await env.DB.batch(
          input.statements.map((sql) => env.DB.prepare(sql)),
        );
        return Response.json({ ok: true, result });
      }
      let statement = env.DB.prepare(input.sql);
      if (input.bindings.length > 0) {
        statement = statement.bind(...input.bindings);
      }
      const result =
        input.mode === "first"
          ? await statement.first()
          : input.mode === "run"
            ? await statement.run()
            : await statement.all();
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  },
};
`;

test("public event statements compile and execute through real Miniflare D1", async (t) => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  t.after(async () => {
    await miniflare.dispose();
  });
  const request = async (payload) => {
    const response = await miniflare.dispatchFetch("http://d1.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    assert.equal(body.ok, true, body.error);
    return body.result;
  };
  for (
    const name of (await readdir(join(process.cwd(), "drizzle")))
      .filter((candidate) => candidate.endsWith(".sql"))
      .sort()
  ) {
    const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
    for (const statement of productionMigrationFragments(sql)) {
      await request({
        bindings: [],
        mode: "run",
        sql: statement,
      });
    }
  }

  const preparedSql = [];
  let maximumStatementBytes = 0;
  let maximumBindings = 0;
  const database = {
    prepare(sql) {
      const byteLength = new TextEncoder().encode(sql).byteLength;
      assert.ok(
        byteLength < MAX_D1_STATEMENT_BYTES,
        `D1 statement is ${byteLength} bytes`,
      );
      maximumStatementBytes = Math.max(maximumStatementBytes, byteLength);
      preparedSql.push(sql);
      return {
        bind(...bindings) {
          maximumBindings = Math.max(maximumBindings, bindings.length);
          assert.ok(bindings.length < 100);
          return {
            async all() {
              return request({ bindings, mode: "all", sql });
            },
            async first() {
              return request({ bindings, mode: "first", sql });
            },
            async run() {
              return request({ bindings, mode: "run", sql });
            },
          };
        },
      };
    },
  };

  const queryInput = {
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    page: 1,
    pageSize: 12,
    todayDate: TODAY_DATE,
    view: "upcoming",
  };
  assert.equal((await queryPublicEvents(database, queryInput)).totalCount, 0);
  assert.deepEqual(await queryPublicEventSlice(database, queryInput), {
    events: [],
    hasMore: false,
    page: 1,
    pageSize: 12,
    view: "upcoming",
  });
  assert.deepEqual(
    await queryPublicCalendarMonth(database, {
      fromDate: "2026-08-01",
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      todayDate: TODAY_DATE,
      toDate: "2026-08-31",
    }),
    { events: [], hasMore: false },
  );
  assert.deepEqual(
    await queryPublicEventsForExport(database, {
      ...queryInput,
      maxEvents: 500,
    }),
    [],
  );
  assert.equal(
    await revalidatePublicEventExportRecords(database, {
      organizationId: ORGANIZATION_ID,
      records: [
        {
          clubProjectionToken: "[]",
          event: { slug: "missing-event" },
          programProjectionToken: null,
          sourceIdentity: "legacy:missing-event",
          sourceVersion: 1,
        },
      ],
    }),
    false,
  );
  assert.equal(
    await getPublicEventExportRecordBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug: "missing-event",
    }),
    null,
  );
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug: "missing-event",
    }),
    null,
  );
  assert.deepEqual(
    await getPublicEventsBySlugs(database, {
      organizationId: ORGANIZATION_ID,
      slugs: ["missing-event"],
    }),
    [],
  );
  assert.deepEqual(
    await listPublishedEventSelections(database, {
      organizationId: ORGANIZATION_ID,
    }),
    [],
  );
  assert.deepEqual(
    await resolvePublishedEventSelections(database, {
      organizationId: ORGANIZATION_ID,
      selectionIds: ["organizer:missing-event"],
    }),
    [],
  );
  assert.deepEqual(
    await resolveEditorialPublishedEventSelections(database, {
      organizationId: ORGANIZATION_ID,
      selectionIds: ["organizer:missing-event"],
    }),
    [],
  );
  assert.deepEqual(
    await getEditorialPublicEvents(database, {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      requestedSlugs: ["missing-event"],
      todayDate: TODAY_DATE,
    }),
    { defaultUpcoming: [], selected: [] },
  );
  assert.deepEqual(
    await listRelatedPublicEvents(database, {
      limit: 3,
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      slug: "missing-event",
      todayDate: TODAY_DATE,
    }),
    [],
  );
  assert.deepEqual(
    await listPublicEventSitemapEntries(database, {
      organizationId: ORGANIZATION_ID,
    }),
    [],
  );
  assert.deepEqual(
    await listPublicEventCategoryOptions(database, ORGANIZATION_ID),
    [],
  );
  assert.deepEqual(
    await listUpcomingPublicEvents(database, {
      fromUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      todayDate: TODAY_DATE,
    }),
    [],
  );
  assert.deepEqual(
    await listUpcomingPublicMeetupEvents(database, {
      fromUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      todayDate: TODAY_DATE,
    }),
    [],
  );
  assert.equal(
    await getAuthorizedOrganizerEventPublicPreview(database, {
      membershipId: "membership-missing",
      organizationId: ORGANIZATION_ID,
      organizerEventId: "event-missing",
      profileId: "profile-missing",
    }),
    null,
  );
  await database
    .prepare(AUTHORIZED_ORGANIZER_EVENT_PUBLIC_PREVIEW_ENRICHMENT_SQL)
    .bind(
      "membership-missing",
      "profile-missing",
      ORGANIZATION_ID,
      "event-missing",
    )
    .all();
  assert.equal(
    await database
      .prepare(
        `${PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL}
         SELECT count(*) AS selection_count
         FROM public_events`,
      )
      .bind(
        ORGANIZATION_ID,
        ORGANIZATION_ID,
        ORGANIZATION_ID,
        ORGANIZATION_ID,
        ORGANIZATION_ID,
      )
      .first()
      .then((row) => Number(row?.selection_count ?? -1)),
    0,
  );

  assert.ok(preparedSql.length >= 14);
  const finalExportRevalidationSql = preparedSql.find((sql) =>
    sql.includes("requested_public_event AS"),
  );
  assert.ok(finalExportRevalidationSql);
  assert.ok(
    new TextEncoder().encode(finalExportRevalidationSql).byteLength < 90_000,
  );
  assert.ok(
    maximumStatementBytes < 90_000,
    `maximum public statement was ${maximumStatementBytes} bytes`,
  );
  assert.ok(maximumBindings < 100);
});
