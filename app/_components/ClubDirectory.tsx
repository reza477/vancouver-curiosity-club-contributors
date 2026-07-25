import Link from "next/link";
import type { PublicClubDto } from "@/lib/server/public/catalog";

export function ClubDirectory({
  clubs,
}: Readonly<{ clubs: readonly PublicClubDto[] }>) {
  if (clubs.length === 0) {
    return (
      <section className="public-empty-state" aria-labelledby="clubs-empty">
        <p className="section-kicker">Published clubs</p>
        <h2 id="clubs-empty">No public club pages are available yet.</h2>
        <p>Draft programs are not displayed.</p>
      </section>
    );
  }

  return (
    <section className="club-directory" aria-labelledby="clubs-heading">
      <header>
        <p className="section-kicker">Published clubs</p>
        <h2 id="clubs-heading">Choose a curiosity trail.</h2>
      </header>
      <div className="club-directory__list">
        {clubs.map((club, index) => (
          <article className="club-directory__card" key={club.slug}>
            <p className="club-directory__number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </p>
            <p className="club-directory__lane">{club.lane.name}</p>
            <h3>
              <Link href={`/clubs/${club.slug}`}>{club.name}</Link>
            </h3>
            {club.description ? <p>{club.description}</p> : null}
            <div className="club-directory__actions">
              <Link href={`/clubs/${club.slug}`}>Read the club note</Link>
              {club.publicGroupUrl ? (
                <a
                  href={club.publicGroupUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Official Meetup group
                  <span aria-hidden="true"> ↗</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
