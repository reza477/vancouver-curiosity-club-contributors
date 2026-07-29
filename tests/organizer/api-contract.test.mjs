import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readOrganizerMutationBody } from "../../app/api/organizer/_body.ts";
import { classifySafeError } from "../../lib/validation/server-observability.ts";

const ROUTES = [
  "activity/route.ts",
  "calendar/route.ts",
  "clubs/route.ts",
  "clubs/[id]/route.ts",
  "clubs/[id]/archive/route.ts",
  "conflicts/route.ts",
  "conflicts/preview/route.ts",
  "conflicts/incidents/[id]/review/route.ts",
  "conflicts/reviews/[id]/decision/route.ts",
  "invitations/route.ts",
  "invitations/[id]/revoke/route.ts",
  "imports/route.ts",
  "imports/inspect/route.ts",
  "imports/[id]/route.ts",
  "imports/[id]/approve/route.ts",
  "imports/[id]/apply-next/route.ts",
  "imports/[id]/redact/route.ts",
  "events/route.ts",
  "events/[id]/route.ts",
  "events/[id]/actions/route.ts",
  "events/[id]/publication/route.ts",
  "events/[id]/publication/actions/route.ts",
  "events/[id]/delete/route.ts",
  "events/[id]/duplicate/route.ts",
  "events/[id]/restore/route.ts",
  "notifications/route.ts",
  "notifications/[id]/route.ts",
  "notifications/preferences/route.ts",
  "notifications/read-all/route.ts",
  "profile/route.ts",
  "settings/route.ts",
  "settings/conflict-policy/route.ts",
  "settings/publication-policy/route.ts",
  "team/route.ts",
  "team/[id]/route.ts",
  "team/ownership/route.ts",
  "venues/route.ts",
  "venues/[id]/route.ts",
  "venues/[id]/archive/route.ts",
];

const MUTATION_ROUTES = [
  "clubs/route.ts",
  "clubs/[id]/route.ts",
  "clubs/[id]/archive/route.ts",
  "conflicts/preview/route.ts",
  "conflicts/incidents/[id]/review/route.ts",
  "conflicts/reviews/[id]/decision/route.ts",
  "invitations/route.ts",
  "invitations/[id]/revoke/route.ts",
  "imports/[id]/approve/route.ts",
  "imports/[id]/apply-next/route.ts",
  "imports/[id]/redact/route.ts",
  "events/route.ts",
  "events/[id]/route.ts",
  "events/[id]/actions/route.ts",
  "events/[id]/publication/route.ts",
  "events/[id]/publication/actions/route.ts",
  "events/[id]/delete/route.ts",
  "events/[id]/duplicate/route.ts",
  "events/[id]/restore/route.ts",
  "notifications/[id]/route.ts",
  "notifications/preferences/route.ts",
  "notifications/read-all/route.ts",
  "profile/route.ts",
  "settings/route.ts",
  "settings/conflict-policy/route.ts",
  "settings/publication-policy/route.ts",
  "team/[id]/route.ts",
  "team/ownership/route.ts",
  "venues/route.ts",
  "venues/[id]/route.ts",
  "venues/[id]/archive/route.ts",
];

function routeSource(relativePath) {
  return readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      relativePath,
    ),
    "utf8",
  );
}

test("session role comes from the final-sealed profile read", () => {
  const source = routeSource("session/route.ts");
  assert.match(source, /await authorizeOrganizerAccess\(/u);
  assert.match(source, /const profile = await getOrganizerProfile\(/u);
  assert.match(source, /role:\s*profile\.role/u);
  assert.doesNotMatch(source, /role:\s*membership\.role/u);
});

test("every organizer JSON route revalidates trusted server membership and uses private response helpers", () => {
  for (const relativePath of ROUTES) {
    const source = routeSource(relativePath);
    assert.match(
      source,
      /requireOrganizerApiActor\(/u,
      `${relativePath} must authorize server-side`,
    );
    assert.match(
      source,
      /privateOrganizerJson|organizerApiError/u,
      `${relativePath} must use private response helpers`,
    );
    assert.doesNotMatch(
      source,
      /request\.(?:headers|cookies).*?(?:email|role|organization)/isu,
      `${relativePath} must not derive authorization claims from requests`,
    );
  }
});

test("every organizer mutation authenticates before bounded same-origin body parsing", () => {
  for (const relativePath of MUTATION_ROUTES) {
    const source = routeSource(relativePath);
    const mutationExportIndex = Math.max(
      source.lastIndexOf("export async function POST"),
      source.lastIndexOf("export async function PATCH"),
    );
    const authorizationIndex = source.indexOf(
      "requireOrganizerApiActor(",
      mutationExportIndex,
    );
    const bodyIndex = source.indexOf(
      "readOrganizerMutationBody(",
      mutationExportIndex,
    );
    assert.ok(
      authorizationIndex >= 0 && bodyIndex > authorizationIndex,
      `${relativePath} must authenticate before reading its body`,
    );
  }

  const shared = readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      "_shared.ts",
    ),
    "utf8",
  );
  assert.match(shared, /privateJsonHeaders\(\)/u);
  const bodyReader = readFileSync(
    join(
      process.cwd(),
      "app",
      "api",
      "organizer",
      "_body.ts",
    ),
    "utf8",
  );
  assert.match(bodyReader, /requireSameOriginMutation\(request\)/u);
  assert.match(
    bodyReader,
    /readBoundedUtf8Body\(request,\s*maxBytes\)/u,
  );
  assert.match(
    bodyReader,
    /validationIssue\(\s*"body",\s*"invalid_json"/u,
  );
  const observability = readFileSync(
    join(
      process.cwd(),
      "lib",
      "validation",
      "server-observability.ts",
    ),
    "utf8",
  );
  assert.match(
    observability,
    /"X-Robots-Tag":\s*"noindex, nofollow, noarchive"/u,
  );
});

test("organizer mutation bodies distinguish CSRF denial from 422 body validation", async () => {
  const sameOrigin = "https://workspace.example";
  assert.deepEqual(
    await readOrganizerMutationBody(
      new Request(`${sameOrigin}/api/organizer/events`, {
        body: JSON.stringify({ title: "Private idea" }),
        headers: { origin: sameOrigin },
        method: "POST",
      }),
      1_024,
    ),
    { title: "Private idea" },
  );

  for (const request of [
    new Request(`${sameOrigin}/api/organizer/events`, {
      body: "{",
      headers: { origin: sameOrigin },
      method: "POST",
    }),
    new Request(`${sameOrigin}/api/organizer/events`, {
      body: "{}",
      headers: {
        "content-length": "2048",
        origin: sameOrigin,
      },
      method: "POST",
    }),
    new Request(`${sameOrigin}/api/organizer/events`, {
      body: new Uint8Array([0xff]),
      headers: { origin: sameOrigin },
      method: "POST",
    }),
  ]) {
    await assert.rejects(
      readOrganizerMutationBody(request, 1_024),
      (error) => {
        const safe = classifySafeError(error);
        return safe.code === "validation_failed" && safe.status === 422;
      },
    );
  }

  await assert.rejects(
    readOrganizerMutationBody(
      new Request(`${sameOrigin}/api/organizer/events`, {
        body: "{}",
        method: "POST",
      }),
      1_024,
    ),
    (error) => {
      const safe = classifySafeError(error);
      return safe.code === "authorization_denied" && safe.status === 403;
    },
  );
});

test("invitation list and activity DTOs never pass database metadata or token fields through", () => {
  const invitations = readFileSync(
    join(
      process.cwd(),
      "lib",
      "server",
      "organizer",
      "invitations.ts",
    ),
    "utf8",
  );
  const activity = readFileSync(
    join(
      process.cwd(),
      "lib",
      "server",
      "organizer",
      "activity.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    invitations,
    /InvitationDto[\s\S]{0,600}(?:token|tokenHash)\s*:/u,
  );
  assert.doesNotMatch(activity, /metadataJson|metadata_json AS/u);
  assert.match(activity, /ORGANIZER_AUDIT_ACTIONS/u);
});
