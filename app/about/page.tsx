import { notFound } from "next/navigation";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { PUBLIC_ABOUT_MISSION_COPY } from "@/lib/public-mission-copy";

const route = "/about";
const slug = "about";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    descriptionOverride: PUBLIC_ABOUT_MISSION_COPY.metadataDescription,
    fallbackTitle: "About",
    path: route,
    route,
    slug,
  });
}

export default async function AboutPage() {
  const loaded = await loadEditorialPage(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="About" />;
  }

  return (
    <main className="about-page" data-page-slug={loaded.page.slug}>
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: loaded.page.title },
        ]}
      />

      <header className="about-hero" aria-labelledby="about-title">
        <p className="section-kicker">{PUBLIC_ABOUT_MISSION_COPY.eyebrow}</p>
        <h1 id="about-title">{PUBLIC_ABOUT_MISSION_COPY.heading}</h1>
        <p>{PUBLIC_ABOUT_MISSION_COPY.introduction}</p>
      </header>

      <section className="about-feel" aria-labelledby="about-feel-title">
        <div>
          <p className="section-kicker">Our mission</p>
          <h2 id="about-feel-title">
            Make meaningful community easier to find.
          </h2>
        </div>
        <p>
          Our mission is to create welcoming, well-prepared spaces where
          curiosity becomes conversation, participation, and belonging. Books,
          films, ideas, city walks, creative practice, food, and play give
          people a genuine reason to gather—and an easier way to connect.
        </p>
      </section>

      <section className="about-audience" aria-labelledby="about-audience-title">
        <div>
          <p className="section-kicker">How the work helps</p>
          <h2 id="about-audience-title">
            A shared interest can become a way into community.
          </h2>
        </div>
        <ul>
          <li>A clear, lower-pressure first step into local community</li>
          <li>Conversation with enough structure to move beyond small talk</li>
          <li>
            Recurring reasons to participate, contribute, and form lasting ties
          </li>
        </ul>
      </section>

      <section className="about-solo" aria-labelledby="about-solo-title">
        <div>
          <p className="section-kicker">Built for continuity</p>
          <h2 id="about-solo-title">
            A community designed to keep showing up.
          </h2>
        </div>
        <p>
          This is an ongoing Vancouver community, not a one-off event series.
          We are building for the long term through recurring programs, a
          dependable public calendar, clear participation standards,
          responsible privacy practices, and partnerships that can support
          steady growth.
        </p>
      </section>

      <section className="about-closing" aria-labelledby="about-closing-title">
        <div>
          <p className="section-kicker">Work with us</p>
          <h2 id="about-closing-title">
            Help create the conditions for connection.
          </h2>
        </div>
        <div>
          <p>
            Community organizations, venues, educators, funders, and
            mission-aligned companies can help expand access to space,
            materials, outreach, facilitation, and the practical
            infrastructure behind recurring gatherings. We welcome thoughtful
            partnerships and conversations about financial support.
          </p>
          <div className="about-closing__actions">
            <Link className="primary-action" href="/get-involved#partner">
              Discuss a partnership
            </Link>
            <Link href="/events">See the work in action</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
