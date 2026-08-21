import assert from "node:assert/strict";
import test from "node:test";
import {
  institutionalEventTitle,
  resolveInstitutionalEventTitle,
} from "../../lib/public-event-display-title.ts";

const canonicalOfficeSpace = Object.freeze({
  rsvpUrl:
    "https://www.meetup.com/vancouver-literature-and-film/events/316159440/",
  title:
    "🖨️💼 Office Space at VIFF - work is fake and the printer deserved it",
});

test("an exact reviewed Meetup title receives its separate institutional display title", () => {
  assert.deepEqual(resolveInstitutionalEventTitle(canonicalOfficeSpace), {
    status: "approved",
    title: "Office Space — Movie Outing at VIFF",
  });
  assert.equal(
    canonicalOfficeSpace.title,
    "🖨️💼 Office Space at VIFF - work is fake and the printer deserved it",
  );
});

test("an upstream title edit makes the UI override stale instead of guessing", () => {
  const changed = Object.freeze({
    ...canonicalOfficeSpace,
    title: "Office Space at VIFF — updated on Meetup",
  });
  assert.deepEqual(resolveInstitutionalEventTitle(changed), {
    status: "stale-override",
    title: changed.title,
  });
});

test("aliases and ordinary events retain their canonical titles", () => {
  for (const event of [
    Object.freeze({
      ...canonicalOfficeSpace,
      rsvpUrl:
        "https://www.meetup.com/vancouver-meetup-group/events/316159366/",
    }),
    Object.freeze({
      rsvpUrl: "https://www.meetup.com/example/events/123456789/",
      title: "🌙 A canonical Meetup title",
    }),
    Object.freeze({ rsvpUrl: null, title: "An organizer event" }),
  ]) {
    assert.equal(institutionalEventTitle(event), event.title);
    assert.equal(resolveInstitutionalEventTitle(event).status, "canonical");
  }
});
