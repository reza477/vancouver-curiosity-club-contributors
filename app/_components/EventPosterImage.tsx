"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type EventPosterImageProps = Readonly<
  Omit<ComponentPropsWithoutRef<"img">, "alt" | "onError" | "src"> & {
    alt: string;
    fallback: ReactNode;
    src: string;
  }
>;

/**
 * Keeps public event artwork honest when an owned or synchronized image can no
 * longer be decoded. The browser swaps the failed image for the same branded
 * fallback used when an event has no poster, instead of leaving a blank frame.
 */
export function EventPosterImage({
  alt,
  fallback,
  src,
  ...imageProps
}: EventPosterImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) return fallback;

  const renderedImageProps = dynamicMeetupPoster(src)
    ? Object.freeze({ ...imageProps, sizes: undefined, srcSet: undefined })
    : imageProps;
  const modernSources = localPosterModernSources(
    src,
    renderedImageProps.srcSet,
  );

  // The public poster URLs intentionally bypass Next/Image so a revoked or
  // malformed response reaches this decode-error boundary immediately.
  const image = (
    <img
      {...renderedImageProps}
      alt={alt}
      onError={() => {
        setFailedSrc(src);
      }}
      src={src}
    />
  );

  if (!modernSources) return image;

  return (
    <picture>
      <source srcSet={modernSources.avif} type="image/avif" />
      <source srcSet={modernSources.webp} type="image/webp" />
      {image}
    </picture>
  );
}

function dynamicMeetupPoster(src: string): boolean {
  return src.startsWith("/meetup-posters/");
}

function localPosterModernSources(
  src: string,
  srcSet: string | undefined,
): Readonly<{ avif: string; webp: string }> | null {
  const candidates = srcSet ?? src;
  const urls = candidates
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/u, 1)[0])
    .filter(Boolean);
  if (
    urls.length === 0 ||
    urls.some(
      (url) =>
        !/^\/event-posters\/[a-z0-9][a-z0-9-]*\.jpeg$/u.test(url),
    )
  ) {
    return null;
  }

  return Object.freeze({
    avif: replacePosterExtension(candidates, "avif"),
    webp: replacePosterExtension(candidates, "webp"),
  });
}

function replacePosterExtension(srcSet: string, extension: "avif" | "webp") {
  return srcSet.replace(/\.jpeg(?=\s|,|$)/gu, `.${extension}`);
}
