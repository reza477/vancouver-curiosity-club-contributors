import { navigateClientSide } from "vinext/shims/navigation";
import { PUBLIC_ARTWORK_MOTION_ENABLED } from "./public-artwork-motion";

let cancelCurrent: ((supersede: boolean) => void) | null = null;
let currentOwner: object | null = null;

export function eventPosterPath(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    return url.origin === origin && /^\/events\/[^/]+\/?$/u.test(url.pathname) && !url.hash
      ? url.pathname.replace(/\/$/u, "") : null;
  } catch { return null; }
}

export function cancelPosterNavigationMotion() { cancelCurrent?.(true); }
export function skipPosterNavigationMotion() { cancelCurrent?.(false); }

/** Navigation owns history; the optional snapshot never owns navigation. */
export function openConnectedPoster(link: HTMLAnchorElement): boolean {
  const path = eventPosterPath(link.href, location.origin);
  const source = link.querySelector<HTMLImageElement>("img");
  const hasClientRouter = typeof (window as Window & { __VINEXT_RSC_NAVIGATE__?: unknown }).__VINEXT_RSC_NAVIGATE__ === "function";
  if (!PUBLIC_ARTWORK_MOTION_ENABLED || document.documentElement.dataset.navigationMotionReady !== "true" ||
      !hasClientRouter || !path || link.target || link.hasAttribute("download") ||
      !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !source?.complete || !source.naturalWidth) return false;
  cancelCurrent?.(true);
  const owner = {};
  currentOwner = owner;
  let cancelled = false;
  let superseded = false;
  let destination: HTMLImageElement | null = null;
  let information: HTMLElement | null = null;
  let timer: number | undefined;
  let releaseCommit: (() => void) | null = null;
  const clearNames = () => {
    if (currentOwner === owner) {
      source.style.removeProperty("view-transition-name");
      destination?.style.removeProperty("view-transition-name");
      information?.style.removeProperty("view-transition-name");
      delete document.documentElement.dataset.posterNavigation;
      currentOwner = null;
    }
  };
  source.style.viewTransitionName = "event-poster";
  document.documentElement.dataset.posterNavigation = "active";
  let transition: ViewTransition;
  try { transition = document.startViewTransition(async () => {
    // skipTransition still calls this deferred update. A newer click or Back
    // must win even when it arrives before this callback starts.
    if (superseded) return;
    if (cancelled) {
      void navigateClientSide(link.href, "push", true).catch(() => {});
      return;
    }
    // Vinext 0.0.50 resolves navigation on a paint frame. View Transitions
    // suspend those frames while updating, so awaiting that promise deadlocks.
    // Observe the committed destination DOM instead; the router still owns
    // the single history push and all error/redirect handling.
    const detail = await new Promise<HTMLElement | null>((resolve) => {
      const observer = new MutationObserver(check);
      function finish(value: HTMLElement | null) { observer.disconnect(); releaseCommit = null; resolve(value); }
      function check() {
        const candidate = document.querySelector<HTMLElement>("[data-event-detail-slug]");
        if (location.pathname.replace(/\/$/u, "") === path && candidate && `/events/${candidate.dataset.eventDetailSlug}` === path) finish(candidate);
      }
      releaseCommit = () => finish(null);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-event-detail-slug"] });
      void navigateClientSide(link.href, "push", true).then(check, () => releaseCommit?.());
    });
    if (cancelled || !detail) { transition.skipTransition(); return; }
    // Match an ordinary new-page navigation before the new snapshot is taken.
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    source.style.removeProperty("view-transition-name");
    destination = detail.querySelector<HTMLImageElement>(".event-detail__artwork-frame img");
    if (!destination) { transition.skipTransition(); return; }
    // Never hold the destination hostage to a slow or failed poster request.
    const ready = await Promise.race([
      destination.decode().then(() => true, () => false),
      new Promise<false>((resolve) => { timer = window.setTimeout(() => resolve(false), 180); }),
    ]);
    window.clearTimeout(timer);
    if (cancelled || !ready || !destination.isConnected) { transition.skipTransition(); return; }
    const bounds = destination.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) { transition.skipTransition(); return; }
    destination.style.viewTransitionName = "event-poster";
    information = detail.querySelector<HTMLElement>(".event-detail__summary");
    if (information) information.style.viewTransitionName = "event-information";
  }); } catch {
    clearNames();
    return false;
  }
  const cancel = (supersede: boolean) => { superseded ||= supersede; cancelled = true; releaseCommit?.(); transition.skipTransition(); clearNames(); };
  cancelCurrent = cancel;
  // Slow navigation continues normally, without a frozen snapshot or second push.
  const deadline = window.setTimeout(() => cancel(false), 1200);
  void transition.ready.then(() => window.clearTimeout(deadline), () => {});
  void transition.finished.catch(() => {}).finally(() => {
    window.clearTimeout(deadline);
    window.clearTimeout(timer);
    clearNames();
    if (cancelCurrent === cancel) cancelCurrent = null;
  });
  return true;
}
