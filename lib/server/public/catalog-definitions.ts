export const PUBLIC_ORGANIZATION_SLUG =
  "vancouver-curiosity-and-education-society";

export type PublicCatalogLaneDefinition = Readonly<{
  description: string;
  name: string;
  slug: string;
  sortOrder: number;
}>;

export type PublicCatalogClubDefinition = Readonly<{
  description: string;
  featured: boolean;
  laneSlug: string;
  meetupGroupSlug: string | null;
  name: string;
  publicGroupUrl: string | null;
  publicationStatus: "draft" | "published";
  slug: string;
}>;

export type PublicCatalogPageSectionDefinition = Readonly<{
  content: Readonly<Record<string, unknown>>;
  key: string;
  sortOrder: number;
  type: string;
}>;

export type PublicCatalogPageDefinition = Readonly<{
  sections: readonly PublicCatalogPageSectionDefinition[];
  slug: string;
  title: string;
}>;

export const PUBLIC_CATALOG_LANES: readonly PublicCatalogLaneDefinition[] =
  Object.freeze([
    Object.freeze({
      description:
        "Talks, reading, film, ideas, and conversations worth continuing.",
      name: "Think",
      slug: "think",
      sortOrder: 10,
    }),
    Object.freeze({
      description:
        "Reflective and creative gatherings that make room to pause or make something.",
      name: "Reset & Make",
      slug: "reset-and-make",
      sortOrder: 20,
    }),
    Object.freeze({
      description:
        "Curiosity taken into the city through walks, visits, and shared discovery.",
      name: "Explore",
      slug: "explore",
      sortOrder: 30,
    }),
    Object.freeze({
      description:
        "Food, games, and playful reasons to spend time together.",
      name: "Eat & Play",
      slug: "eat-and-play",
      sortOrder: 40,
    }),
  ]);

export const PUBLIC_CATALOG_CLUBS: readonly PublicCatalogClubDefinition[] =
  Object.freeze([
    Object.freeze({
      description:
        "A Vancouver gathering place for talks, discussions, and shared learning across subjects.",
      featured: true,
      laneSlug: "think",
      meetupGroupSlug: "vancouver-meetup-group",
      name: "Vancouver Curiosity Club",
      publicGroupUrl:
        "https://www.meetup.com/vancouver-meetup-group/",
      publicationStatus: "published",
      slug: "vancouver-curiosity-club",
    }),
    Object.freeze({
      description:
        "A program for reading, watching, and discussing literature and film together.",
      featured: true,
      laneSlug: "think",
      meetupGroupSlug: "vancouver-literature-and-film",
      name: "Vancouver Literature and Film",
      publicGroupUrl:
        "https://www.meetup.com/vancouver-literature-and-film/",
      publicationStatus: "published",
      slug: "vancouver-literature-and-film",
    }),
    Object.freeze({
      description:
        "A program for conversations and events around fantasy and science fiction.",
      featured: true,
      laneSlug: "think",
      meetupGroupSlug: "vancouver-fantasy-scifi-meetup-group",
      name: "Vancouver Fantasy & Sci-Fi Group",
      publicGroupUrl:
        "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/",
      publicationStatus: "published",
      slug: "vancouver-fantasy-scifi-group",
    }),
    Object.freeze({
      description:
        "A draft program for curious meals and playful food discovery.",
      featured: false,
      laneSlug: "eat-and-play",
      meetupGroupSlug: null,
      name: "Off-Radar Eats",
      publicGroupUrl: null,
      publicationStatus: "draft",
      slug: "off-radar-eats",
    }),
    Object.freeze({
      description:
        "A draft program for quiet reflection, meditation, and journaling.",
      featured: false,
      laneSlug: "reset-and-make",
      meetupGroupSlug: null,
      name: "Contemplative Meditation + Journaling Circle",
      publicGroupUrl: null,
      publicationStatus: "draft",
      slug: "contemplative-meditation-journaling-circle",
    }),
  ]);

export const PUBLIC_CATALOG_PAGES: readonly PublicCatalogPageDefinition[] =
  Object.freeze([
    page("home", "Vancouver Curiosity Club", [
      section("hero", "hero", 10, {
        eyebrow: "Vancouver, British Columbia",
        heading: "Follow a question somewhere interesting.",
        text: "Thoughtful Vancouver events for people who like learning in company.",
      }),
      section("attending", "prose", 20, {
        heading: "Come curious",
        paragraphs: [
          "Expect a clear reason to gather, room for conversation, and no requirement to arrive as an expert.",
          "Each listing carries the facts we know. When a detail is undecided, we say so.",
        ],
      }),
      section("invitation", "callout", 30, {
        heading: "Help make the calendar",
        text: "Have an idea, want to host, volunteer, or explore a community partnership? Start with the ways to get involved.",
      }),
      section("community", "prose", 40, {
        heading: "Continue on the confirmed group pages",
        text: "The exact Meetup discussion URL is not confirmed, so this site lists only the three verified public group destinations.",
      }),
    ]),
    page("events", "Events", [
      section("intro", "intro", 10, {
        heading: "Events",
        text: "Browse the genuinely published gatherings on the calendar.",
      }),
    ]),
    page("clubs", "Clubs", [
      section("intro", "intro", 10, {
        heading: "Clubs",
        text: "Different doors into one curious Vancouver community.",
      }),
    ]),
    page("community", "Community", [
      section("intro", "intro", 10, {
        heading: "Community",
        text: "Find the club on its confirmed Meetup group pages and choose the conversations that interest you.",
      }),
    ]),
    page("about", "About", [
      section("intro", "intro", 10, {
        heading: "A community organized around curiosity",
        text: "Vancouver Curiosity Club brings people together to learn, discuss, explore, make, and play.",
        paragraphs: [
          "The calendar is intentionally broad: ideas can meet books, films, neighbourhood discoveries, reflective practice, food, and games.",
          "The common thread is a thoughtful reason to be in the room together.",
        ],
      }),
    ]),
    page("get-involved", "Get Involved", [
      section("intro", "intro", 10, {
        heading: "Bring something to the club",
        text: "You can attend, share an event idea, volunteer, host a gathering, or begin a conversation about partnering.",
        paragraphs: [
          "Attending a published event is the simplest way in. Volunteer, host, and partner conversations currently begin through one of the confirmed Meetup group pages.",
          "No public intake form is enabled in this phase, and an idea does not reserve a date or guarantee publication.",
        ],
      }),
    ]),
    page("host-an-event", "Host an Event", [
      section("intro", "intro", 10, {
        heading: "Interested in hosting?",
        text: "Event-hosting tools are not open yet. For now, read the club’s approach and connect through a confirmed Meetup group page.",
        paragraphs: [
          "This page is informational. It does not submit an event, reserve a date, or promise that an idea will be scheduled.",
          "A useful starting idea has a clear question or activity, a reason to gather, and enough practical detail for an organizer to assess later.",
        ],
      }),
    ]),
    page("contact", "Contact", [
      section("intro", "intro", 10, {
        heading: "Find us on Meetup",
        text: "No public contact form or confirmed public email is available yet. Use one of the confirmed Meetup group destinations.",
      }),
    ]),
    page("conduct", "Code of Conduct", [
      section("intro", "intro", 10, {
        heading: "Make curiosity generous",
        text: "Treat people with respect, make room for different ways of participating, and challenge ideas without demeaning people.",
        paragraphs: [
          "Harassment, intimidation, discrimination, and deliberate disruption are not welcome.",
          "Respect personal boundaries and privacy. Follow host and venue instructions, and raise concerns with an organizer through the relevant confirmed Meetup group.",
        ],
      }),
    ]),
    page("accessibility", "Accessibility", [
      section("intro", "intro", 10, {
        heading: "Website accessibility",
        text: "This website is designed for keyboard use, readable zoom, clear focus, reduced motion, and responsive layouts.",
        paragraphs: [
          "Venue accessibility varies. We publish specific access information only when it has been confirmed for an event.",
          "If a listing does not contain an accessibility detail, it has not been confirmed here; use the official RSVP destination to ask the event organizer.",
        ],
      }),
    ]),
    page("privacy", "Privacy", [
      section("intro", "intro", 10, {
        heading: "Privacy, in plain language",
        text: "Public pages can be browsed without an attendee account. This phase has no enabled public submission form.",
        paragraphs: [
          "The site is hosted with ChatGPT Sites and uses Sites-managed D1 for structured data and R2 for approved files.",
          "Organizer access will use Sign in with ChatGPT, which shares authenticated identity information with the organizer portal. Public event facts imported from Meetup link back to the official RSVP page.",
          "This starter notice needs legal review before a public launch.",
        ],
      }),
    ]),
  ]);

export const PUBLIC_SITE_IDENTITY = Object.freeze({
  brandName: "Vancouver Curiosity Club",
  locationLabel: "Vancouver, British Columbia",
  mission:
    "Thoughtful events for people who like learning in company.",
  tagline: "A social calendar with a brain.",
});

export const PUBLIC_COMMUNITY_LINKS = Object.freeze(
  PUBLIC_CATALOG_CLUBS.flatMap((club, index) =>
    club.publicationStatus === "published" && club.publicGroupUrl
      ? [
          Object.freeze({
            label: `${club.name} on Meetup`,
            linkType: "meetup_group",
            sortOrder: (index + 1) * 10,
            url: club.publicGroupUrl,
          }),
        ]
      : [],
  ),
);

function page(
  slug: string,
  title: string,
  sections: readonly PublicCatalogPageSectionDefinition[],
): PublicCatalogPageDefinition {
  return Object.freeze({
    sections: Object.freeze(sections),
    slug,
    title,
  });
}

function section(
  key: string,
  type: string,
  sortOrder: number,
  content: Readonly<Record<string, unknown>>,
): PublicCatalogPageSectionDefinition {
  return Object.freeze({
    content: Object.freeze(content),
    key,
    sortOrder,
    type,
  });
}
