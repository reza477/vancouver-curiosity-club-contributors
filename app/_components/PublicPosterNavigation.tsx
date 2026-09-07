"use client";

import { useEffect } from "react";
import { cancelPosterNavigationMotion } from "@/lib/public-poster-navigation";

export function PublicPosterNavigation() {
  useEffect(() => {
    // Noncritical animation CSS loads after hydration, outside the initial
    // public stylesheet budget. Baseline links/menu states need no extra asset.
    void import("../styles/connected-navigation.css").then(() => {
      document.documentElement.dataset.navigationMotionReady = "true";
    }).catch(() => { /* Ordinary navigation remains available if CSS fails. */ });
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) cancelPosterNavigationMotion();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", cancelPosterNavigationMotion);
    window.addEventListener("pagehide", cancelPosterNavigationMotion);
    preference.addEventListener("change", cancelPosterNavigationMotion);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", cancelPosterNavigationMotion);
      window.removeEventListener("pagehide", cancelPosterNavigationMotion);
      preference.removeEventListener("change", cancelPosterNavigationMotion);
      // Vinext can remount this boundary during the destination commit.
      // The transition owns its bounded cleanup; cancelling here would abort
      // the very navigation it is connecting. Click/Back/pagehide still cancel.
    };
  }, []);
  return null;
}
