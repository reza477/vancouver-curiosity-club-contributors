"use client";

import { useState } from "react";

export function ShareControls({
  title,
  url,
}: Readonly<{ title: string; url: string | null }>) {
  const [message, setMessage] = useState("");
  if (!url) return null;
  const shareUrl = url;
  const emailHref = `mailto:?subject=${encodeURIComponent(
    title,
  )}&body=${encodeURIComponent(shareUrl)}`;

  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url: shareUrl });
        setMessage("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setMessage("Link copied.");
      }
    } catch {
      setMessage("The link was not shared.");
    }
  }

  return (
    <section className="share-controls" aria-label="Share this event">
      <button type="button" onClick={share}>
        Share
      </button>
      <a href={emailHref}>Email link</a>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
