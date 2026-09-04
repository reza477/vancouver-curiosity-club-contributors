import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("the primary Contact link uses a full document navigation", async () => {
  const header = await readFile(
    new URL("app/_components/SiteHeader.tsx", projectRoot),
    "utf8",
  );
  const navigationLinks = sourceSection(
    header,
    "function NavigationLinks",
    "export function normalizedPrimaryNavigation",
  );

  assert.match(
    navigationLinks,
    /item\.href === "\/contact"[\s\S]*?<a[\s\S]*?href=\{item\.href\}[\s\S]*?>[\s\S]*?\{item\.label\}[\s\S]*?<\/a>/u,
    "Contact must bypass the client RSC transition and remain a real link",
  );
  assert.match(
    navigationLinks,
    /<a[\s\S]*?aria-current=\{current\}[\s\S]*?data-primary-destination=\{item\.label\.toLowerCase\(\)\}[\s\S]*?onClick=\{onNavigate\}/u,
    "the reliable Contact link must keep its active state, audit marker, and mobile-menu close behavior",
  );
  assert.match(
    navigationLinks,
    /return item\.href\.startsWith\("\/"\) \? \([\s\S]*?<Link[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
    "other internal destinations must retain selective framework prefetching",
  );
});

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}
