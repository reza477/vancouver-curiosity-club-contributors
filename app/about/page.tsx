import { notFound } from "next/navigation";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";

const route = "/about";
const slug = "about";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
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
        <p className="section-kicker">About the club</p>
        <h1 id="about-title">Curiosity is better in company.</h1>
        <p>
          Vancouver Curiosity Club brings people together through books,
          films, ideas, city walks, creative practice, food, and play. Each
          gathering gives an interesting conversation somewhere to begin.
        </p>
      </header>

      <section className="about-feel" aria-labelledby="about-feel-title">
        <div>
          <p className="section-kicker">What the community feels like</p>
          <h2 id="about-feel-title">
            Thoughtful without being formal. Social without small-talk
            pressure.
          </h2>
        </div>
        <p>
          People follow a question together, make room for different
          perspectives, and let conversation turn into connection. Expertise
          is welcome, but it is never the price of entry.
        </p>
      </section>

      <section className="about-audience" aria-labelledby="about-audience-title">
        <div>
          <p className="section-kicker">Who it is for</p>
          <h2 id="about-audience-title">People who want to stay curious.</h2>
        </div>
        <ul>
          <li>Readers, film lovers, makers, walkers, and big-question people</li>
          <li>Newcomers looking for a gentle way into Vancouver community</li>
          <li>Anyone who misses conversations that go somewhere</li>
        </ul>
      </section>

      <section className="about-solo" aria-labelledby="about-solo-title">
        <div>
          <p className="section-kicker">Coming on your own</p>
          <h2 id="about-solo-title">Your first event can be simple.</h2>
        </div>
        <p>
          Pick the gathering that genuinely interests you and show up as you
          are. You do not need to know anyone already, bring a friend, or have
          the cleverest answer in the room.
        </p>
      </section>

      <section className="about-closing" aria-labelledby="about-closing-title">
        <div>
          <p className="section-kicker">Come to the next one</p>
          <h2 id="about-closing-title">Follow the question that catches you.</h2>
        </div>
        <Link className="primary-action" href="/events">
          See upcoming gatherings
        </Link>
      </section>
    </main>
  );
}
