"use client";

import { useEffect } from "react";

import {
  PUBLIC_ARTWORK_MOTION,
  PUBLIC_ARTWORK_MOTION_ENABLED,
} from "@/lib/public-artwork-motion";

const REVEAL_SELECTOR = "[data-artwork-reveal]";
const STAGE_SELECTOR = "[data-living-poster-stage]";
const HERO_POSTER_SELECTOR = ".home-hero__poster";

export function PublicArtworkMotion() {
  useEffect(() => {
    if (!PUBLIC_ARTWORK_MOTION_ENABLED) return undefined;

    let cleanup = () => {};
    const startTimer = window.setTimeout(() => {
      cleanup = initializeArtworkMotion();
    }, 180);

    return () => {
      window.clearTimeout(startTimer);
      cleanup();
    };
  }, []);

  return null;
}

function initializeArtworkMotion(): () => void {
  const documentElement = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const stageMedia = window.matchMedia(PUBLIC_ARTWORK_MOTION.stageMediaQuery);
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let lifecycleGeneration = 0;

  documentElement.dataset.artworkMotionReady = "true";

  const revealElements = Array.from(
    document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
  );
  if (!reducedMotion.matches && revealElements.length > 0) {
    const revealWhenReady = async (element: HTMLElement) => {
      const operationGeneration = lifecycleGeneration;
      await decodeDescendantImages(element);
      if (disposed || operationGeneration !== lifecycleGeneration) return;
      element.dataset.artworkRevealState = "visible";
    };
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          revealObserver.unobserve(element);
          void revealWhenReady(element);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    for (const element of revealElements) {
      const bounds = element.getBoundingClientRect();
      const initiallyVisible =
        bounds.top < window.innerHeight && bounds.bottom > 0;
      element.dataset.artworkRevealState = initiallyVisible
        ? "visible"
        : "pending";
      if (element.dataset.artworkRevealState === "pending") {
        revealObserver.observe(element);
      }
    }
    cleanups.push(() => revealObserver.disconnect());
  }

  const heroPosters = Array.from(
    document.querySelectorAll<HTMLElement>(HERO_POSTER_SELECTOR),
  );
  for (const poster of heroPosters) {
    const image = poster.querySelector<HTMLImageElement>("img");
    if (!image) continue;
    const operationGeneration = lifecycleGeneration;
    void decodeImage(image).then((ready) => {
      if (!ready || disposed || operationGeneration !== lifecycleGeneration)
        return;
      poster.dataset.artworkImageReady = "true";
    });
  }
  cleanups.push(() => {
    for (const poster of heroPosters) delete poster.dataset.artworkImageReady;
  });

  const stages = Array.from(
    document.querySelectorAll<HTMLElement>(STAGE_SELECTOR),
  );
  let stageCleanup = () => {};

  const configureStages = () => {
    stageCleanup();
    if (!stageMedia.matches || reducedMotion.matches) {
      for (const stage of stages) resetStage(stage);
      stageCleanup = () => {};
      return;
    }

    const activeCleanups = stages.map((stage) => enhanceStage(stage));
    stageCleanup = () => {
      for (const cleanup of activeCleanups) cleanup();
    };
  };

  configureStages();
  stageMedia.addEventListener("change", configureStages);
  reducedMotion.addEventListener("change", configureStages);
  cleanups.push(() => {
    stageMedia.removeEventListener("change", configureStages);
    reducedMotion.removeEventListener("change", configureStages);
    stageCleanup();
  });

  return () => {
    disposed = true;
    lifecycleGeneration += 1;
    for (const cleanup of cleanups) cleanup();
    delete documentElement.dataset.artworkMotionReady;
    for (const element of revealElements) {
      delete element.dataset.artworkRevealState;
    }
  };
}

async function decodeDescendantImages(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map((image) => decodeImage(image)));
}

async function decodeImage(image: HTMLImageElement): Promise<boolean> {
  if (image.complete && image.naturalWidth > 0) return true;
  try {
    await image.decode();
  } catch {
    return false;
  }
  return image.complete && image.naturalWidth > 0;
}

function enhanceStage(stage: HTMLElement): () => void {
  const articles = Array.from(
    stage.querySelectorAll<HTMLElement>("[data-stage-event-index]"),
  );
  if (articles.length === 0) return () => {};

  let activeIndex = 0;
  let activationGeneration = 0;
  let disposed = false;
  let transitionTimer: number | null = null;
  let queuedIndex: number | null = null;
  let transitioning = false;

  stage.dataset.stageEnhanced = "true";
  setStageState(articles, activeIndex, null);

  const processQueuedActivation = async () => {
    if (disposed || transitioning || queuedIndex === null) return;

    const requestedIndex = queuedIndex;
    queuedIndex = null;
    const incoming = articles[requestedIndex];
    if (!incoming) {
      void processQueuedActivation();
      return;
    }
    if (requestedIndex === activeIndex) {
      setStageState(articles, activeIndex, null);
      void processQueuedActivation();
      return;
    }

    transitioning = true;
    const operationGeneration = activationGeneration;
    const image = incoming?.querySelector<HTMLImageElement>("figure img");
    if (image && (!image.complete || image.naturalWidth === 0)) {
      const ready = await decodeImage(image);
      if (disposed || operationGeneration !== activationGeneration) return;
      if (!ready) {
        transitioning = false;
        void processQueuedActivation();
        return;
      }
    }

    if (disposed || operationGeneration !== activationGeneration) return;
    if (queuedIndex !== null && queuedIndex !== requestedIndex) {
      transitioning = false;
      void processQueuedActivation();
      return;
    }
    if (queuedIndex === requestedIndex) queuedIndex = null;

    const outgoingIndex = activeIndex;
    setStageState(articles, outgoingIndex, requestedIndex);
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      if (disposed || operationGeneration !== activationGeneration) return;
      activeIndex = requestedIndex;
      transitioning = false;
      setStageState(articles, activeIndex, null);
      void processQueuedActivation();
    }, PUBLIC_ARTWORK_MOTION.artworkDurationMs);
  };

  const activate = (requestedIndex: number) => {
    if (disposed || !articles[requestedIndex]) return;
    queuedIndex = requestedIndex;
    void processQueuedActivation();
  };

  const focusHandlers: Array<Readonly<{ element: HTMLElement; handler: () => void }>> = [];
  for (const [index, article] of articles.entries()) {
    const summary = article.querySelector<HTMLElement>("[data-stage-summary]");
    if (!summary) continue;
    const handler = () => {
      void activate(index);
    };
    summary.addEventListener("focusin", handler);
    summary.addEventListener("pointerenter", handler);
    focusHandlers.push({ element: summary, handler });
  }

  const stageObserver = new IntersectionObserver(
    (entries) => {
      const strongest = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!strongest) return;
      const article = (strongest.target as HTMLElement).closest<HTMLElement>(
        "[data-stage-event-index]",
      );
      const index = Number(article?.dataset.stageEventIndex);
      if (Number.isInteger(index)) void activate(index);
    },
    { rootMargin: "-28% 0px -48% 0px", threshold: [0.08, 0.35, 0.7] },
  );
  for (const article of articles) {
    const summary = article.querySelector<HTMLElement>("[data-stage-summary]");
    if (summary) stageObserver.observe(summary);
  }

  return () => {
    disposed = true;
    activationGeneration += 1;
    queuedIndex = null;
    transitioning = false;
    stageObserver.disconnect();
    for (const { element, handler } of focusHandlers) {
      element.removeEventListener("focusin", handler);
      element.removeEventListener("pointerenter", handler);
    }
    if (transitionTimer !== null) window.clearTimeout(transitionTimer);
    transitionTimer = null;
    resetStage(stage);
  };
}

function setStageState(
  articles: readonly HTMLElement[],
  outgoingIndex: number,
  incomingIndex: number | null,
) {
  for (const [index, article] of articles.entries()) {
    const state =
      incomingIndex === index
        ? "incoming"
        : outgoingIndex === index
          ? incomingIndex === null
            ? "active"
            : "outgoing"
          : "idle";
    article.dataset.stageState = state;
    const active = state === "active" || state === "incoming";
    const summary = article.querySelector<HTMLElement>("[data-stage-summary]");
    const poster = article.querySelector<HTMLAnchorElement>(
      "[data-stage-poster]",
    );
    if (summary) summary.dataset.stageActive = String(active);
    if (poster) {
      poster.setAttribute("aria-hidden", String(!active));
      poster.tabIndex = active ? 0 : -1;
    }
  }
}

function resetStage(stage: HTMLElement) {
  delete stage.dataset.stageEnhanced;
  for (const article of stage.querySelectorAll<HTMLElement>(
    "[data-stage-event-index]",
  )) {
    delete article.dataset.stageState;
    const summary = article.querySelector<HTMLElement>("[data-stage-summary]");
    const poster = article.querySelector<HTMLAnchorElement>(
      "[data-stage-poster]",
    );
    if (summary) delete summary.dataset.stageActive;
    if (poster) {
      poster.removeAttribute("aria-hidden");
      poster.removeAttribute("tabindex");
    }
  }
}
