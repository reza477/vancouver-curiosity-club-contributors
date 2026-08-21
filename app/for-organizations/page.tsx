/* eslint-disable @next/next/no-css-tags -- This route owns a bounded stylesheet that must not inflate Home. */
import type { Metadata } from "next";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import type { PublicCatalogDto } from "@/lib/server/public/catalog";
import { getRequestPublicCatalog } from "@/lib/server/public/request-cache";
import { selectCanonicalPublicCommunities } from "@/lib/public-community-order";
import { buildPublicPageMetadataForOrigin } from "@/lib/server/public/metadata";
import { getTrustedRequestOrigin } from "@/lib/server/public/origin";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

const metadataDescription =
  "Ways organizations, venues, funders, and supporters can work with Vancouver Curiosity Club.";

export async function generateMetadata(): Promise<Metadata> {
  const [catalog, origin] = await Promise.all([
    loadCatalog(),
    getTrustedRequestOrigin(),
  ]);
  if (!catalog) {
    return {
      title: "For Organizations",
      description: metadataDescription,
      robots: { index: false, follow: false },
    };
  }
  return buildPublicPageMetadataForOrigin(
    {
      description: metadataDescription,
      pathname: "/for-organizations",
      siteName: catalog.site.brandName,
      title: "For Organizations",
    },
    origin,
  );
}

const collaborationOptions = [
  {
    title: "Program funding or sponsorship",
    body: "Support the practical costs behind thoughtful, publicly accessible programming.",
  },
  {
    title: "Venue and space partnerships",
    body: "Help make suitable gathering spaces available for talks, workshops, discussions, and activities.",
  },
  {
    title: "Co-presented public programs",
    body: "Develop a public event around a subject or experience that fits both organizations.",
  },
  {
    title: "Educational or cultural collaboration",
    body: "Connect relevant expertise, facilitators, collections, or learning opportunities with the public.",
  },
  {
    title: "Community outreach and referrals",
    body: "Help appropriate audiences find programs that may interest them.",
  },
  {
    title: "Appropriate in-kind support",
    body: "Contribute materials, services, or practical resources suited to a confirmed program need.",
  },
] as const;

export default async function ForOrganizationsPage() {
  const catalog = await loadCatalog();
  if (!catalog) {
    return (
      <main className="for-organizations-page">
        <link
          rel="stylesheet"
          href="/styles/organizations.css"
          precedence="organizations"
        />
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { label: "For Organizations" },
          ]}
        />
        <section
          className="public-service-state"
          aria-labelledby="organizations-unavailable-title"
        >
          <p className="section-kicker">Temporarily unavailable</p>
          <h1 id="organizations-unavailable-title">
            Organization information could not be prepared.
          </h1>
          <p>Please try again shortly.</p>
        </section>
      </main>
    );
  }

  const lanes = catalog.lanes.slice(0, 4);
  const clubs = selectCanonicalPublicCommunities(catalog.clubs);

  return (
    <main className="for-organizations-page">
      <link
        rel="stylesheet"
        href="/styles/organizations.css"
        precedence="organizations"
      />
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: "For Organizations" },
        ]}
      />
      <PageMasthead
        eyebrow="For organizations"
        title="Work with Vancouver Curiosity Club"
        deck="We create thoughtful public programs across learning, culture, creativity, and shared experience—and welcome conversations about how this work can grow."
      />

      <section
        className="organizations-introduction"
        aria-labelledby="organizations-who-title"
      >
        <div>
          <p className="section-kicker">Who we are</p>
          <h2 id="organizations-who-title">
            A Vancouver community organization built around public participation.
          </h2>
        </div>
        <div>
          <p>
            Vancouver Curiosity Club brings people together through prepared,
            approachable gatherings. Shared subjects and activities make
            conversation easier to begin, while recurring programs give people
            reasons to return.
          </p>
          <p>
            This website is the umbrella public home for several communities
            with different programming interests. Event listings remain open
            for anyone who wants to see the work in action.
          </p>
          <Link href="/about">Read about our mission</Link>
        </div>
      </section>

      <section
        className="organizations-programs"
        aria-labelledby="organizations-programs-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">Public programs</p>
          <h2 id="organizations-programs-title">Subjects and formats with several ways in.</h2>
        </div>
        <div className="organizations-programs__grid">
          {lanes.map((lane) => (
            <article key={lane.slug}>
              <h3>{lane.name}</h3>
              {lane.description ? <p>{lane.description}</p> : null}
              <Link href={`/events?lane=${encodeURIComponent(lane.slug)}`}>
                View {lane.name} events
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section
        className="organizations-communities"
        aria-labelledby="organizations-communities-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">Communities we serve</p>
          <h2 id="organizations-communities-title">
            {clubs.length === 3 ? "Three public communities." : "Public communities."}
          </h2>
        </div>
        <ul>
          {clubs.map((club) => (
            <li key={club.slug}>
              <div>
                <h3>{club.name}</h3>
                {club.description ? <p>{club.description}</p> : null}
              </div>
              <Link href={`/clubs/${club.slug}`}>View community</Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="organizations-collaboration"
        aria-labelledby="organizations-collaboration-title"
      >
        <div className="organizations-heading">
          <p className="section-kicker">Ways to collaborate</p>
          <h2 id="organizations-collaboration-title">Possible forms of support and partnership.</h2>
          <p>
            Each conversation starts with shared objectives, practical fit,
            and public benefit.
          </p>
        </div>
        <div className="organizations-collaboration__grid">
          {collaborationOptions.map((option, index) => (
            <article key={option.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{option.title}</h3>
              <p>{option.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="organizations-information"
        aria-labelledby="organizations-information-title"
      >
        <div>
          <p className="section-kicker">Verified public information</p>
          <h2 id="organizations-information-title">What is available now.</h2>
        </div>
        <div>
          <ul>
            <li>Based in {catalog.site.locationLabel}</li>
            <li>{lanes.length} published program streams</li>
            <li>{clubs.length} public event communities</li>
            <li>A current public event calendar</li>
            <li>Published conduct, accessibility, and privacy information</li>
            {catalog.site.legalName ? (
              <li>Verified legal name: {catalog.site.legalName}</li>
            ) : null}
            {catalog.site.institutionalFacts.foundedYear !== null ? (
              <li>
                Verified founding year:{" "}
                {catalog.site.institutionalFacts.foundedYear}
              </li>
            ) : null}
            {catalog.site.institutionalFacts.attendanceTotal !== null &&
            catalog.site.institutionalFacts.attendanceTotalAsOf ? (
              <li>
                Verified attendance total:{" "}
                {new Intl.NumberFormat("en-CA").format(
                  catalog.site.institutionalFacts.attendanceTotal,
                )}{" "}
                through {catalog.site.institutionalFacts.attendanceTotalAsOf}
              </li>
            ) : null}
            {catalog.site.institutionalFacts.memberTotal !== null &&
            catalog.site.institutionalFacts.memberTotalAsOf ? (
              <li>
                Verified member total:{" "}
                {new Intl.NumberFormat("en-CA").format(
                  catalog.site.institutionalFacts.memberTotal,
                )}{" "}
                as of {catalog.site.institutionalFacts.memberTotalAsOf}
              </li>
            ) : null}
          </ul>
        </div>
      </section>

      <section
        className="organizations-reference"
        aria-labelledby="organizations-reference-title"
      >
        <div>
          <p className="section-kicker">Review the public work</p>
          <h2 id="organizations-reference-title">Events, standards, and access information.</h2>
        </div>
        <nav aria-label="Organization reference links">
          <Link href="/events">Public events</Link>
          <Link href="/about">About</Link>
          <Link href="/conduct">Code of Conduct</Link>
          <Link href="/accessibility">Accessibility</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </section>

      <section
        className="organizations-contact"
        aria-labelledby="organizations-contact-title"
      >
        <div>
          <p className="section-kicker">Start a conversation</p>
          <h2 id="organizations-contact-title">
            Tell us what kind of partnership you have in mind.
          </h2>
          <p>
            Tell us about your organization, what you are working on, and the
            kind of collaboration you have in mind.
          </p>
        </div>
        <Link
          className="primary-action"
          href="/contact?topic=partnerships#contact-form"
        >
          Discuss a partnership
        </Link>
      </section>
    </main>
  );
}

async function loadCatalog(): Promise<PublicCatalogDto | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    return await getRequestPublicCatalog(database);
  } catch {
    writeSafeLog("error", "public_organizations_page_unavailable", {
      code: "service_unavailable",
      operation: "read_public_catalog",
      route: "/for-organizations",
      status: 503,
    });
    return null;
  }
}
