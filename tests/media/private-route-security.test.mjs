import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import test from "node:test";
import {
  countD1Statements,
  interceptD1Statements,
} from "../auth/intercept-d1.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

let runtimeBindingReads = 0;
const ROUTE_BINDINGS = {};
const ROUTE_ENVIRONMENT = new Proxy({}, {
  get(_target, property) {
    runtimeBindingReads += 1;
    return Reflect.get(ROUTE_BINDINGS, property);
  },
});
const ROUTE_HEADERS = {
  "oai-authenticated-user-email": "owner@phase8-media.invalid",
  "oai-authenticated-user-full-name": "Phase%208%20Media%20Owner",
  "oai-authenticated-user-full-name-encoding":
    "percent-encoded-utf-8",
};

globalThis.__VCC_PHASE8_MEDIA_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_PHASE8_MEDIA_ROUTE_HEADERS__ = ROUTE_HEADERS;
nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_PHASE8_MEDIA_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "next/headers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function headers() { return new Headers(globalThis.__VCC_PHASE8_MEDIA_ROUTE_HEADERS__); }",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const privateVariantRoute = await import(
  "../../app/api/organizer/media/[id]/variants/[variant]/route.ts?phase8-private-media-cross-site"
);
const mediaCollectionRoute = await import(
  "../../app/api/organizer/media/route.ts?phase8-private-media-list-seal"
);

test("private media bytes reject cross-site GETs before runtime bindings or R2 access", async () => {
  runtimeBindingReads = 0;
  const response = await privateVariantRoute.GET(
    new Request(
      "https://vcc.example/api/organizer/media/asset-private/variants/webp_480?eventId=event-private",
      {
        headers: {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      },
    ),
    {
      params: Promise.resolve({
        id: "asset-private",
        variant: "webp_480",
      }),
    },
  );

  assert.equal(response.status, 403);
  assert.equal(runtimeBindingReads, 0);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /private,\s*no-store/iu,
  );
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.deepEqual(await response.json(), {
    error: {
      code: "authorization_denied",
      message:
        "This ChatGPT identity does not have access to the organizer portal.",
    },
  });
});

test("media collection GET seals suspension and organization reassignment after both private reads", async (t) => {
  await t.test("suspension before the route seal returns no mixed private payload", async (t) => {
    const database = createMediaRouteDatabase();
    t.after(() => database.close());
    const intercepted = exactRouteSealRace(database, () => {
      database.exec(`
        UPDATE profiles
        SET status = 'suspended', updated_at = updated_at + 1
        WHERE id = 'profile_media_owner'
      `);
    });
    ROUTE_BINDINGS.DB = intercepted.database;
    ROUTE_BINDINGS.INITIAL_OWNER_EMAIL = null;

    const response = await mediaCollectionRoute.GET();

    assert.equal(intercepted.fired(), true);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "authorization_denied",
        message:
          "This ChatGPT identity does not have access to the organizer portal.",
      },
    });
  });

  await t.test("cross-organization reassignment before the route seal returns no mixed private payload", async (t) => {
    const database = createMediaRouteDatabase();
    t.after(() => database.close());
    const intercepted = exactRouteSealRace(database, () => {
      database.exec(`
        UPDATE organization_memberships
        SET organization_id = 'org_media_other',
            updated_at = updated_at + 1
        WHERE id = 'membership_media_owner'
      `);
    });
    ROUTE_BINDINGS.DB = intercepted.database;
    ROUTE_BINDINGS.INITIAL_OWNER_EMAIL = null;

    const response = await mediaCollectionRoute.GET();

    assert.equal(intercepted.fired(), true);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "authorization_denied",
        message:
          "This ChatGPT identity does not have access to the organizer portal.",
      },
    });
  });

  await t.test("healthy route uses the exact seven-statement read envelope", async (t) => {
    const database = createMediaRouteDatabase();
    t.after(() => database.close());
    const counted = countD1Statements(database);
    ROUTE_BINDINGS.DB = counted.database;
    ROUTE_BINDINGS.INITIAL_OWNER_EMAIL = null;

    const response = await mediaCollectionRoute.GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      assets: [],
      cleanupPending: [],
    });
    assert.equal(counted.count(), 7);
  });
});

function exactRouteSealRace(database, hook) {
  const exactMembershipRead = (sql) =>
    sql.includes("FROM organization_memberships AS membership") &&
    sql.includes("AND membership.organization_id = ?");
  return interceptD1Statements(database, {
    after: exactMembershipRead,
    before: exactMembershipRead,
    hook,
  });
}

function createMediaRouteDatabase() {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_media_owner', 'email:owner@phase8-media.invalid',
      'owner@phase8-media.invalid', 'Phase 8 Media Owner',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'org_media_main', 'Media main', 'media-main',
        'America/Vancouver', 1, 'profile_media_owner',
        'profile_media_owner', 1, 1
      ),
      (
        'org_media_other', 'Media other', 'media-other',
        'America/Vancouver', 1, 'profile_media_owner',
        'profile_media_owner', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_media_owner', 'org_media_main',
      'profile_media_owner', 'owner@phase8-media.invalid',
      'owner', 'active', 'profile_media_owner', 1, 1
    );
  `);
  return database;
}

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(migrationDirectory, name), "utf8"),
    )
    .join("\n");
}

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}
