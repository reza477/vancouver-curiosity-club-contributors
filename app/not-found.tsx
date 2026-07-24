import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-shell">
      <section className="error-panel" aria-labelledby="not-found-title">
        <p className="section-kicker">Field note 404</p>
        <h1 id="not-found-title">There is nothing at this address.</h1>
        <p>The public foundation is still available from the home page.</p>
        <div className="error-actions">
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}

