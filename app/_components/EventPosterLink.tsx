"use client";

import { PublicRouteLink } from "./PublicRouteLink";
import type { ComponentProps } from "react";
import { openConnectedPoster } from "@/lib/public-poster-navigation";

export function EventPosterLink({ onClick, ...props }: ComponentProps<typeof PublicRouteLink>) {
  return <PublicRouteLink {...props} data-connected-poster-link onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openConnectedPoster(event.currentTarget)) event.preventDefault();
  }} />;
}
