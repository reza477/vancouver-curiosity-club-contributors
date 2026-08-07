import { notFound } from "next/navigation";
import Link from "next/link";
import {
  buildEditorialMetadata,
  EditorialPage,
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
    <EditorialPage page={loaded.page} tone="community">
      <section className="about-club" aria-labelledby="about-club-title">
        <div className="about-club__introduction">
          <p className="section-kicker">What is this club?</p>
          <h2 id="about-club-title">Curiosity is better in company.</h2>
          <div>
            <p>
              Vancouver Curiosity Club is a Vancouver community built around
              intelligent, approachable events, shared experiences, and
              substantive conversation.
            </p>
            <p>
              Some gatherings begin with a book, film, philosophical question,
              new technology, or work of art. Others take us on walks, into
              neighbourhoods and restaurants, or into quieter practices such
              as journaling, meditation, poetry, and silent reading.
            </p>
            <p>
              You do not need to arrive as an expert. Come with a question, an
              interest, or simply the willingness to join the conversation.
            </p>
          </div>
        </div>

        <div className="about-club__lanes" aria-labelledby="about-lanes-title">
          <div>
            <p className="section-kicker">Four ways in</p>
            <h2 id="about-lanes-title">Choose what catches your attention.</h2>
          </div>
          <div className="about-club__lane-grid">
            <article data-event-lane="think">
              <h3>Think</h3>
              <p>
                Books, film, philosophy, debate, psychology, artificial
                intelligence, technology, and serious discussion.
              </p>
            </article>
            <article data-event-lane="reset-and-make">
              <h3>Reset &amp; Make</h3>
              <p>
                Meditation, journaling, poetry, creative workshops, reflective
                practice, and silent reading.
              </p>
            </article>
            <article data-event-lane="explore">
              <h3>Explore</h3>
              <p>
                Walks, hikes, art, culture, neighbourhood outings, and
                discovering Vancouver.
              </p>
            </article>
            <article data-event-lane="eat-and-play">
              <h3>Eat &amp; Play</h3>
              <p>
                Restaurant outings, karaoke, casual social events, and playful
                community gatherings.
              </p>
            </article>
          </div>
        </div>

        <div className="about-club__invitation">
          <div>
            <p className="section-kicker">Start simply</p>
            <h2>Open an event that sounds interesting.</h2>
          </div>
          <div>
            <p>
              The month view is the main doorway into the club. Open an event
              for its full description, time, public location, poster, and
              official signup link. Public visitors do not need an account.
            </p>
            <p>
              Signup stays on the official platform shown for each event, such
              as Meetup. Organizer access is separate and invitation-only.
            </p>
            <Link className="primary-action" href="/">
              Browse this month
            </Link>
          </div>
        </div>
      </section>
    </EditorialPage>
  );
}
