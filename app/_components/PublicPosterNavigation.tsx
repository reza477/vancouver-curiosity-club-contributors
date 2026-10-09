"use client";

import { useEffect } from "react";
import { cancelPosterNavigationMotion, skipPosterNavigationMotion } from "@/lib/public-poster-navigation";

// Share the in-flight result across Vinext boundary remounts. A second CSS
// import must not report readiness before the first network load has finished.
let navigationStyles: Promise<unknown> | undefined;

export function PublicPosterNavigation() {
  useEffect(() => {
    // Noncritical animation CSS loads after hydration, outside the initial
    // public stylesheet budget. Baseline links/menu states need no extra asset.
    navigationStyles ??= import("../styles/connected-navigation.css");
    void navigationStyles.then(() => {
      document.documentElement.dataset.navigationMotionReady = "true";
    }).catch(() => { /* Ordinary navigation remains available if CSS fails. */ });
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          (link.target && link.target !== "_self") || link.hasAttribute("download")) {
        skipPosterNavigationMotion();
      } else {
        cancelPosterNavigationMotion();
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", cancelPosterNavigationMotion);
    window.addEventListener("pagehide", cancelPosterNavigationMotion);
    preference.addEventListener("change", skipPosterNavigationMotion);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", cancelPosterNavigationMotion);
      window.removeEventListener("pagehide", cancelPosterNavigationMotion);
      preference.removeEventListener("change", skipPosterNavigationMotion);
      // Vinext can remount this boundary during the destination commit.
      // The transition owns its bounded cleanup; cancelling here would abort
      // the very navigation it is connecting. Click/Back/pagehide still cancel.
    };
  }, []);
  return null;
}
