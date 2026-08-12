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

  // The public poster URLs intentionally bypass Next/Image so a revoked or
  // malformed response reaches this decode-error boundary immediately.
  return (
    <img
      {...imageProps}
      alt={alt}
      onError={() => {
        setFailedSrc(src);
      }}
      src={src}
    />
  );
}
