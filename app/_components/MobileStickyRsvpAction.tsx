"use client";

import { useEffect, useRef, useState } from "react";

const MOBILE_RSVP_QUERY = "(max-width: 38rem)";

export function MobileStickyRsvpAction({
  eventTitle,
  href,
}: Readonly<{
  eventTitle: string;
  href: string;
}>) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [sticky, setSticky] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const mobileQuery = window.matchMedia(MOBILE_RSVP_QUERY);
    let observer: IntersectionObserver | null = null;

    const stopObserving = () => {
      observer?.disconnect();
      observer = null;
    };

    const observe = () => {
      stopObserving();
      if (!mobileQuery.matches) return;

      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        setSticky(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
      observer.observe(sentinel);
    };

    const handleViewportChange = () => {
      if (!mobileQuery.matches) setSticky(false);
      observe();
    };

    observe();
    mobileQuery.addEventListener("change", handleViewportChange);

    return () => {
      stopObserving();
      mobileQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  return (
    <>
      <span
        aria-hidden="true"
        className="event-detail__rsvp-sentinel"
        ref={sentinelRef}
      />
      <a
        aria-label={`RSVP for ${eventTitle} on Meetup (opens in a new tab)`}
        className="primary-action"
        data-mobile-sticky={sticky ? "true" : "false"}
        href={href}
        rel="noreferrer noopener"
        target="_blank"
      >
        RSVP on Meetup <span aria-hidden="true">↗</span>
      </a>
    </>
  );
}
