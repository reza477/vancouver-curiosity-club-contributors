"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route_render_failed", {
      digest: error.digest ?? "unavailable",
    });
  }, [error.digest]);

  return (
    <main className="error-shell">
      <section className="error-panel" aria-labelledby="route-error-title">
        <p className="section-kicker">A field note went missing</p>
        <h1 id="route-error-title">This page could not be prepared.</h1>
        <p>
          Nothing was submitted. Try the page again, or return to the public
          foundation.
        </p>
        <div className="error-actions">
          <button type="button" onClick={reset}>
            Try again
          </button>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}

