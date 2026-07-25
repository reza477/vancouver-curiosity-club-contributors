import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function NotFound() {
  return (
    <main className="error-shell public-not-found">
      <section className="error-panel" aria-labelledby="not-found-title">
        <p className="section-kicker">Field note 404</p>
        <h1 id="not-found-title">This trail ends here.</h1>
        <p>
          The address may have changed, or the page may not be publicly
          available. The published calendar and club notes are still nearby.
        </p>
        <div className="error-actions">
          <Link href="/events">Explore events</Link>
          <Link href="/clubs">Browse clubs</Link>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}
