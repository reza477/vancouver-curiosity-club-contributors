import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROUTE_ROOT = join(
  process.cwd(),
  "app",
  "api",
  "organizer",
  "content",
);

test("CMS routes stay force-dynamic, server-authorized, private, and bounded", () => {
  const sources = [
    route("route.ts"),
    route("[entityType]", "route.ts"),
    route("[entityType]", "[id]", "route.ts"),
    route("[entityType]", "[id]", "publish", "route.ts"),
    route("[entityType]", "[id]", "unpublish", "route.ts"),
    route("[entityType]", "[id]", "archive", "route.ts"),
    route("[entityType]", "[id]", "safe-delete", "route.ts"),
    route("[entityType]", "[id]", "restore", "route.ts"),
    route("revisions", "[id]", "route.ts"),
  ];
  for (const source of sources) {
    assert.match(source, /dynamic = "force-dynamic"/u);
    assert.match(source, /requireOrganizerApiActor/u);
    assert.match(source, /privateOrganizerJson/u);
    assert.match(source, /organizerApiError/u);
    assert.doesNotMatch(
      source,
      /organizationId|actorProfileId|normalizedEmail|objectKey|object_key/u,
    );
  }
  const create = route("[entityType]", "route.ts");
  const entity = route("[entityType]", "[id]", "route.ts");
  assert.match(create, /readOrganizerMutationBody\(request, 140_000\)/u);
  assert.match(entity, /readOrganizerMutationBody\(request, 140_000\)/u);
  for (const source of [
    route("[entityType]", "[id]", "publish", "route.ts"),
    route("[entityType]", "[id]", "unpublish", "route.ts"),
    route("[entityType]", "[id]", "archive", "route.ts"),
    route("[entityType]", "[id]", "safe-delete", "route.ts"),
    route("[entityType]", "[id]", "restore", "route.ts"),
  ]) {
    assert.match(source, /readOrganizerMutationBody\(request, 4_096\)/u);
  }
});

test("legal confirmation and revocation remain Owner-only and no-referrer", () => {
  for (const action of ["confirm", "revoke"]) {
    const source = route("legal", action, "route.ts");
    assert.match(source, /dynamic = "force-dynamic"/u);
    assert.match(source, /requireOrganizerApiActor\(\["owner"\]\)/u);
    assert.match(source, /readOrganizerMutationBody\(request, 4_096\)/u);
    assert.match(source, /noReferrer: true/u);
  }
});

test("private revision preview has no share token and applies no-referrer headers", () => {
  const source = route("revisions", "[id]", "route.ts");
  assert.match(source, /readCmsRevisionPreview/u);
  assert.match(source, /noReferrer: true/u);
  assert.doesNotMatch(
    source,
    /shareToken|previewToken|searchParams|objectKey|object_key/u,
  );
});

function route(...parts) {
  return readFileSync(join(ROUTE_ROOT, ...parts), "utf8");
}
