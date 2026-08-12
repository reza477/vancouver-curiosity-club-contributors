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
        "Books, film, philosophy, debate, psychology, artificial intelligence, technology, and serious discussion.",
      name: "Think",
      slug: "think",
      sortOrder: 10,
    }),
    Object.freeze({
      description:
        "Meditation, journaling, poetry, creative workshops, reflective practice, and silent reading.",
      name: "Reset & Make",
      slug: "reset-and-make",
      sortOrder: 20,
    }),
    Object.freeze({
      description:
        "Walks, hikes, art, culture, neighbourhood outings, and discovering Vancouver.",
      name: "Explore",
      slug: "explore",
      sortOrder: 30,
    }),
    Object.freeze({
      description:
        "Restaurant outings, karaoke, casual social events, and playful community gatherings.",
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
        eyebrow: "What is this club?",
        heading: "Curiosity is better in company.",
        text: "Vancouver Curiosity Club is a Vancouver community built around intelligent, approachable events, shared experiences, and substantive conversation.",
        paragraphs: [
          "Some gatherings begin with a book, film, philosophical question, new technology, or work of art. Others take us on walks, into neighbourhoods and restaurants, or into quieter practices such as journaling, meditation, poetry, and silent reading.",
          "You do not need to arrive as an expert. Come with a question, an interest, or simply the willingness to join the conversation.",
        ],
      }),
    ]),
    page("get-involved", "Get Involved", [
      section("intro", "intro", 10, {
        heading: "Bring something to the club",
        text: "You can attend, share an event idea, volunteer, host a gathering, or begin a conversation about partnering.",
        paragraphs: [
          "Attending a published event is the simplest way in. The Volunteer and Venue or Community Partnership forms store the details you choose to send in the private organizer inbox.",
          "Submitting a form does not reserve a date, guarantee publication, enroll you in marketing, or send an email confirmation.",
        ],
      }),
    ]),
    page("host-an-event", "Host an Event", [
      section("intro", "intro", 10, {
        heading: "Interested in hosting?",
        text: "Use the Host an Event form to share a proposed title or topic, a short event idea, format, optional preferred club or program, and optional timing.",
        paragraphs: [
          "Submitting stores the proposal in the private organizer inbox. It does not create or publish an event, reserve a date, promise scheduling, or send an email confirmation.",
          "A useful starting idea has a clear question or activity, a reason to gather, and enough practical detail for an organizer to assess later.",
        ],
      }),
    ]),
    page("contact", "Contact", [
      section("intro", "intro", 10, {
        heading: "Send a private inquiry",
        text: "The Contact form stores your name, reply email, topic, and message in the private organizer inbox. It does not enroll you in marketing or send an email confirmation.",
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
        text: "You can browse public pages and send a form without creating an attendee account. We collect only the information you choose to send and use it to review your request and reply.",
        paragraphs: [
          "Form submissions are stored in a private organizer inbox. Access is restricted to authorized Vancouver Curiosity Club organizers, and the information is not used to enroll you in marketing.",
          "Event RSVP and ticket buttons may open Meetup or another external service. Information you enter there is handled by that service under its own privacy practices; Vancouver Curiosity Club does not collect or receive your RSVP through this website.",
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
