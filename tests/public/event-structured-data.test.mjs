import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicEventJsonLd,
} from "../../lib/server/public/event-structured-data.ts";
import {
  buildPublicPageMetadataForOrigin,
} from "../../lib/server/public/metadata.ts";

const PRIVATE_MEETING_SENTINEL =
  "https://private-meeting.synthetic.invalid/secret";
const PUBLIC_ONLINE_URL =
  "https://events.synthetic.invalid/public-room";

test("Event semantics stay in JSON-LD while Open Graph uses its supported website type", () => {
  const canonicalUrl = "https://site.synthetic.invalid/events/public-event";
  const metadata = buildPublicPageMetadataForOrigin(
    {
      description: "Only confirmed public event details.",
      pathname: "/events/public-event",
      title: "Public Event",
    },
    new URL("https://site.synthetic.invalid"),
  );
  const document = buildPublicEventJsonLd(
    eventFixture(),
    canonicalUrl,
    "Confirmed Site Identity",
  );

  assert.equal(metadata.openGraph?.type, "website");
  assert.equal(document["@type"], "Event");
  assert.equal(document.url, canonicalUrl);
});

test("Event JSON-LD maps public attendance locations without private meeting data", async (t) => {
  await t.test("online uses only the exact public VirtualLocation", () => {
    const document = buildPublicEventJsonLd(
      eventFixture({
        attendanceMode: "online",
        privateMeetingDetails: PRIVATE_MEETING_SENTINEL,
        publicOnlineUrl: PUBLIC_ONLINE_URL,
        venue: null,
      }),
      "https://site.synthetic.invalid/events/online-event",
      "Confirmed Site Identity",
    );
    assert.deepEqual(document.location, {
      "@type": "VirtualLocation",
      url: PUBLIC_ONLINE_URL,
    });
    assert.equal(document.eventAttendanceMode, "https://schema.org/OnlineEventAttendanceMode");
    assert.doesNotMatch(JSON.stringify(document), /private-meeting|secret/iu);
  });

  await t.test("hybrid emits public Place and VirtualLocation in order", () => {
    const document = buildPublicEventJsonLd(
      eventFixture({
        attendanceMode: "hybrid",
        privateMeetingDetails: PRIVATE_MEETING_SENTINEL,
        publicOnlineUrl: PUBLIC_ONLINE_URL,
      }),
      "https://site.synthetic.invalid/events/hybrid-event",
      "Confirmed Site Identity",
    );
    assert.deepEqual(document.location, [
      {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          name: "100 Public Test Street",
        },
        name: "Approved Public Room",
      },
      {
        "@type": "VirtualLocation",
        url: PUBLIC_ONLINE_URL,
      },
    ]);
    assert.equal(document.eventAttendanceMode, "https://schema.org/MixedEventAttendanceMode");
    assert.doesNotMatch(JSON.stringify(document), /private-meeting|secret/iu);
  });

  await t.test("in-person emits only Place and ignores online fields", () => {
    const document = buildPublicEventJsonLd(
      eventFixture({
        attendanceMode: "in-person",
        privateMeetingDetails: PRIVATE_MEETING_SENTINEL,
        publicOnlineUrl: PUBLIC_ONLINE_URL,
      }),
      "https://site.synthetic.invalid/events/in-person-event",
      "Confirmed Site Identity",
    );
    assert.deepEqual(document.location, {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        name: "100 Public Test Street",
      },
      name: "Approved Public Room",
    });
    assert.equal(document.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
    assert.equal(JSON.stringify(document).includes(PUBLIC_ONLINE_URL), false);
    assert.doesNotMatch(JSON.stringify(document), /private-meeting|secret/iu);
  });

  await t.test("cancelled events remain explicitly cancelled", () => {
    const document = buildPublicEventJsonLd(
      eventFixture({
        attendanceMode: "online",
        isCancelled: true,
        privateMeetingDetails: PRIVATE_MEETING_SENTINEL,
        publicOnlineUrl: PUBLIC_ONLINE_URL,
        status: "cancelled",
        venue: null,
      }),
      "https://site.synthetic.invalid/events/cancelled-event",
      "Confirmed Site Identity",
    );
    assert.equal(
      document.eventStatus,
      "https://schema.org/EventCancelled",
    );
    assert.deepEqual(document.location, {
      "@type": "VirtualLocation",
      url: PUBLIC_ONLINE_URL,
    });
    assert.doesNotMatch(JSON.stringify(document), /private-meeting|secret/iu);
  });

  await t.test("rights-safe event artwork becomes an absolute Event image", () => {
    const document = buildPublicEventJsonLd(
      eventFixture({ artwork: eventArtworkFixture() }),
      "https://site.synthetic.invalid/events/public-event",
      "Confirmed Site Identity",
    );
    assert.equal(
      document.image,
      "https://site.synthetic.invalid/event-posters/public-event.jpeg",
    );

    const withoutArtwork = buildPublicEventJsonLd(
      eventFixture({ artwork: null }),
      "https://site.synthetic.invalid/events/public-event",
      "Confirmed Site Identity",
    );
    assert.equal(
      Object.hasOwn(withoutArtwork, "image"),
      false,
      "structured data must not invent a placeholder image",
    );
  });
});

function eventArtworkFixture() {
  return {
    altText: "A rights-approved public event poster.",
    credit: "Vancouver Curiosity Club",
    dimensions: {
      large: { height: 900, width: 1_600 },
      medium: { height: 540, width: 960 },
      small: { height: 270, width: 480 },
    },
    focalPoint: { x: 5_000, y: 5_000 },
    srcSet: {
      large: "/event-posters/public-event.jpeg",
      medium: "/event-posters/public-event-medium.jpeg",
      small: "/event-posters/public-event-small.jpeg",
    },
    url: "/event-posters/public-event.jpeg",
  };
}

function eventFixture(overrides = {}) {
  return {
    arrivalInstructions: null,
    artwork: null,
    attendanceMode: "hybrid",
    availabilityState: "open",
    capacity: null,
    category: null,
    club: {
      name: "Public Club",
      slug: "public-club",
    },
    costText: null,
    description: "Only confirmed public details.",
    externalMapUrl: null,
    isCancelled: false,
    lane: null,
    metaDescription: null,
    organizers: [{ displayName: "Public Host" }],
    preparationInformation: null,
    privateMeetingDetails: PRIVATE_MEETING_SENTINEL,
    publicAccessNote: null,
    publicOnlineUrl: PUBLIC_ONLINE_URL,
    rsvpMode: "coming_soon",
    rsvpUrl: null,
    schedule: {
      endsAtUtc: "2030-01-02T04:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2030-01-02T02:00:00.000Z",
      timeZone: "America/Vancouver",
    },
    seoTitle: null,
    slug: "public-event",
    status: "confirmed",
    summary: "A public event summary.",
    title: "Public Event",
    venue: {
      address: "100 Public Test Street",
      name: "Approved Public Room",
    },
    verifiedAccessibilityNotes: null,
    weatherNote: null,
    whatToBring: null,
    ...overrides,
  };
}
