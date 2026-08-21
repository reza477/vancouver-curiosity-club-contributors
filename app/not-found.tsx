import type { Metadata } from "next";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import { getTrustedRequestPathname } from "@/lib/server/public/origin";
import {
  publicServiceSurfaceForPathname,
  type PublicServiceSurface,
} from "@/lib/server/public/service-failure";

export const metadata: Metadata = {
  title: "Page not found",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default async function NotFound() {
  const surface = publicServiceSurfaceForPathname(
    await getTrustedRequestPathname(),
  );
  if (surface) return <PublicServiceFailure surface={surface} />;

  return (
    <main className="error-shell public-not-found">
      <section className="error-panel" aria-labelledby="not-found-title">
        <p className="section-kicker">Page not found</p>
        <h1 id="not-found-title">This trail ends here.</h1>
        <p>
          The address may have changed, or the page may not be publicly
          available. The event calendar and club pages are still nearby.
        </p>
        <div className="error-actions">
          <Link href="/events">
            Explore events
          </Link>
          <Link href="/clubs">Browse clubs</Link>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}

function PublicServiceFailure({
  surface,
}: Readonly<{ surface: PublicServiceSurface }>) {
  const isEvents = surface === "events";
  return (
    <main className="error-shell public-service-failure">
      <section
        className="error-panel"
        aria-labelledby="service-failure-title"
        role="alert"
      >
        <p className="section-kicker">
          {isEvents ? "Calendar unavailable" : "Public site unavailable"}
        </p>
        <h1 id="service-failure-title">
          {isEvents
            ? "The event calendar could not be prepared."
            : "This part of the website could not be prepared."}
        </h1>
        <p>
          No event, person, legal detail, or community fact is being guessed.
          Please try again in a moment.
        </p>
        <div className="error-actions">
          <Link href={isEvents ? "/events" : "/"}>
            Try this page again
          </Link>
          {isEvents ? <Link href="/">Return home</Link> : null}
        </div>
      </section>
    </main>
  );
}
