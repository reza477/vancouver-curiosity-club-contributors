import Link from "next/link";

export default function Home() {
  const sampleEvents = [
    {
      title: "The Hidden Life of Urban Crows",
      lane: "Sample talk",
      colour: "teal",
    },
    {
      title: "Why We Remember Music",
      lane: "Sample salon",
      colour: "amber",
    },
    {
      title: "Night Walk: Moss, Light & Rain",
      lane: "Sample field note",
      colour: "cobalt",
    },
  ] as const;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <Link
          className="wordmark"
          href="/"
          aria-label="Vancouver Curiosity Club home"
        >
          <span className="wordmark-mark" aria-hidden="true">
            VCC
          </span>
          <span>Vancouver Curiosity Club</span>
        </Link>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#about">About</a>
          <a href="#sample-calendar">Sample calendar</a>
          <Link className="portal-link" href="/organizer">
            Organizer portal
            <span aria-hidden="true"> ↗</span>
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span aria-hidden="true">01</span>
              Curiosity, in company
            </p>
            <h1 id="hero-title">
              Curiosity,
              <span>in company</span>
            </h1>

            <div className="hero-deck">
              <p className="tagline">A social calendar with a brain.</p>
              <p className="intro">
                Talks, walks, workshops, and odd little investigations for
                people who like learning out loud.
              </p>
            </div>
          </div>

          <div
            className="field-composition"
            aria-hidden="true"
            data-note="Field note"
          >
            <span className="shape shape-leaf" />
            <span className="shape shape-sun" />
            <span className="shape shape-half" />
            <span className="shape shape-mountain" />
            <span className="shape shape-strike" />
            <span className="composition-rule" />
          </div>
        </section>

        <section
          className="calendar-preview"
          id="sample-calendar"
          aria-labelledby="calendar-title"
        >
          <div className="calendar-heading">
            <p className="section-kicker">Development preview</p>
            <h2 id="calendar-title">Sample calendar</h2>
            <p>
              These are fictional examples for testing the visual system. No
              event is scheduled and no registration is open.
            </p>
          </div>

          <ul className="event-list" aria-label="Development sample events">
            {sampleEvents.map((event, index) => (
              <li key={event.title}>
                <article className="event-row">
                  <p className="event-number" aria-label={`Sample ${index + 1}`}>
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <div className="event-title">
                    <p>Sample event</p>
                    <h3>{event.title}</h3>
                  </div>
                  <div className="event-detail">
                    <span>Date to be announced</span>
                    <span>Venue to be announced</span>
                  </div>
                  <p className="event-lane">
                    <span
                      className={`lane-dot lane-dot-${event.colour}`}
                      aria-hidden="true"
                    />
                    {event.lane}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="editorial-grid"
          id="about"
          aria-label="About the foundation"
        >
          <article className="editorial-card editorial-card-primary">
            <p className="section-kicker">The idea</p>
            <h2>Learning is better when it leaves the room with you.</h2>
            <p>
              Vancouver Curiosity Club is being shaped as an editorial home for
              shared questions, close looking, and thoughtful gatherings.
            </p>
            <a href="#principles">
              Read the field notes
              <span aria-hidden="true"> →</span>
            </a>
          </article>

          <article className="editorial-card editorial-card-secondary">
            <p className="section-kicker">Publication standard</p>
            <h2>Clear before clever.</h2>
            <p>
              Confirmed listings will separate the essentials—time, place,
              format, and access notes—from the story that makes an event worth
              leaving home for.
            </p>
            <a href="#sample-calendar">
              See the sample system
              <span aria-hidden="true"> ↑</span>
            </a>
          </article>
        </section>

        <section
          className="principles"
          id="principles"
          aria-labelledby="principles-title"
        >
          <div>
            <p className="section-kicker">Field notes · 001</p>
            <h2 id="principles-title">A public foundation, still in progress.</h2>
          </div>
          <div className="principles-copy">
            <p>
              This Phase 1 page establishes the club’s visual language. Public
              events, organizer profiles, photographs, community links, and
              legal details will appear only after they are supplied and
              verified.
            </p>
            <p className="status-note">
              No claims, dates, registrations, or people on this page should be
              read as production content.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <p className="footer-wordmark">Vancouver Curiosity Club</p>
          <p>A social calendar with a brain.</p>
        </div>
        <div className="footer-meta">
          <p>Vancouver, British Columbia</p>
          <p>Phase 1 foundation preview</p>
        </div>
      </footer>
    </>
  );
}
