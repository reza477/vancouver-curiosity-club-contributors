"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("application_render_failed", {
      digest: error.digest ?? "unavailable",
    });
  }, [error.digest]);

  return (
    <html lang="en-CA">
      <body
        style={{
          background: "#fbf7f0",
          color: "#131c33",
          fontFamily: "Arial, Helvetica, sans-serif",
          margin: 0,
        }}
      >
        <main
          style={{
            display: "grid",
            minHeight: "100svh",
            padding: "2rem",
            placeItems: "center",
          }}
        >
          <section style={{ maxWidth: "42rem" }}>
            <p>Vancouver Curiosity Club</p>
            <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400 }}>
              The site could not finish loading.
            </h1>
            <p>Nothing was submitted. Please try again.</p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#b8402b",
                border: 0,
                color: "#fbf7f0",
                cursor: "pointer",
                font: "inherit",
                padding: "0.8rem 1rem",
              }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
