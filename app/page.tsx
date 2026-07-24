import Link from "next/link";

export default function Home() {
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
          <span className="wordmark-mark" aria-hidden="true" />
          <span>Vancouver Curiosity Club</span>
        </Link>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#about">About</a>
          <Link href="/calendar">Calendar</Link>
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
          id="calendar"
          aria-labelledby="calendar-title"
        >
          <div className="calendar-heading">
            <p className="section-kicker">Public calendar</p>
            <h2 id="calendar-title">What&apos;s actually happening.</h2>
            <p>
              The calendar reports its real connection and refresh state. It
              shows verified source details only—never placeholder events.
            </p>
          </div>

          <article className="calendar-callout">
            <p className="calendar-state-label">
              <span aria-hidden="true" />
              Source-aware listings
            </p>
            <h3>Meet the calendar where it is.</h3>
            <p>
              See whether the official source is connected, when it last
              refreshed, and which source-backed listings remain available
              when a refresh does not complete. Status is aggregate and never
              exposes a saved feed address.
            </p>
            <Link className="calendar-cta" href="/calendar">
              Open the public calendar
              <span aria-hidden="true"> →</span>
            </Link>
            <dl className="calendar-facts">
              <div>
                <dt>Source</dt>
                <dd>Official feeds only</dd>
              </div>
              <div>
                <dt>Refresh</dt>
                <dd>One bounded feed check per view</dd>
              </div>
              <div>
                <dt>Background sync</dt>
                <dd>Not scheduled</dd>
              </div>
            </dl>
          </article>
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
            <Link href="/calendar">
              Read the calendar
              <span aria-hidden="true"> →</span>
            </Link>
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
              This foundation establishes the club&apos;s visual language.
              Public events appear only when a verified source provides them.
              Organizer profiles, photographs, community links, and legal
              details remain owner-controlled.
            </p>
            <p className="status-note">
              Open the public calendar for the current connection state and
              source-backed listings.
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
          <p>Independent learning, in company</p>
        </div>
      </footer>
    </>
  );
}
