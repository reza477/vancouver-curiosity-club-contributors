import NextLink from "next/link";
import type { ComponentProps } from "react";
import { publicRoutePrefetch } from "@/lib/public-prefetch";

type NextLinkProps = ComponentProps<typeof NextLink>;

/** Public-site Link with a single, auditable speculative-prefetch policy. */
export function PublicRouteLink({
  href,
  prefetch,
  ...props
}: NextLinkProps) {
  return (
    <NextLink
      {...props}
      href={href}
      prefetch={publicRoutePrefetch(href, prefetch)}
    />
  );
}
