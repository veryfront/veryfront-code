/**
 * Bridge Init
 *
 * Initialization flow: sets up overlays, console capture, error handling,
 * inspect mode, mutation observer, and message listener.
 */

import { logger } from "./bridge-logger.ts";
import { state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import { disposeMessaging, postToStudio } from "./bridge-messaging.ts";
import { injectOverlayStyles } from "./bridge-styles.ts";
import {
  createOverlay,
  disposeInspector,
  setColorMode,
  setupInspectMode,
  setupMutationObserver,
} from "./bridge-inspector.ts";
import {
  disposeConsoleCapture,
  disposeErrorHandling,
  setupConsoleCapture,
  setupErrorHandling,
} from "./bridge-console.ts";
import {
  handleStudioMessage,
  invalidateStudioMessageOperations,
} from "./bridge-message-handler.ts";
import { getStudioLocationHref } from "./bridge-location.ts";

let initialized = false;
let appLifecycleActive = false;
let domContentLoadedListener: (() => void) | null = null;
let ownedOverlayStyle: HTMLStyleElement | null = null;
let ownedHoverOverlay: HTMLElement | null = null;
let ownedSelectionOverlay: HTMLElement | null = null;

function notifyAppLoaded(isInitialLoad: boolean): void {
  if (appLifecycleActive) return;
  const config = getConfig();
  const url = getStudioLocationHref();
  appLifecycleActive = true;

  postToStudio({ action: "appLoaded", url });

  postToStudio({
    action: "appUpdated",
    url,
    id: config.pageId,
    isInitialLoad,
    errors: [],
    warnings: [],
  });

  postToStudio({
    action: "onPageTransitionEnd",
    url,
    projectId: config.projectId,
    id: config.pageId,
    params: {},
  });
}

function notifyAppUnloaded(): void {
  if (!appLifecycleActive) return;
  appLifecycleActive = false;
  invalidateStudioMessageOperations();
  postToStudio({ action: "appUnloaded", url: getStudioLocationHref() });
}

function handlePageHide(_event: PageTransitionEvent): void {
  notifyAppUnloaded();
}

function handlePageShow(event: PageTransitionEvent): void {
  // A non-persisted pageshow is the initial document activation, which the DOM
  // readiness path already announces. A persisted pageshow restores this same
  // bridge instance from the back-forward cache and starts a new active cycle.
  if (!event.persisted || appLifecycleActive) return;
  notifyAppLoaded(false);
  setupMutationObserver();
}

export function init(): void {
  if (initialized) return;
  if (globalThis.window.parent === globalThis.window) {
    logger.debug(
      "[StudioBridge] No parent browsing context, skipping initialization",
    );
    return;
  }
  const params = new URLSearchParams(globalThis.window.location.search);

  initialized = true;
  logger.debug("Initializing...");
  try {
    ownedOverlayStyle = injectOverlayStyles(getConfig().nonce);
    ownedHoverOverlay = createOverlay("hover");
    ownedSelectionOverlay = createOverlay("selection");
    state.hoverOverlay = ownedHoverOverlay;
    state.selectionOverlay = ownedSelectionOverlay;

    setupConsoleCapture();
    setupErrorHandling();
    setupInspectMode();

    globalThis.window.addEventListener("message", handleStudioMessage);

    // IMPORTANT: notifyAppLoaded() must be called BEFORE setupMutationObserver()
    // because notifyAppLoaded sends onPageTransitionEnd which sets previewId,
    // and treeUpdated (from setupMutationObserver) requires previewId to be set
    if (document.readyState === "loading") {
      domContentLoadedListener = () => {
        domContentLoadedListener = null;
        notifyAppLoaded(true);
        setupMutationObserver();
      };
      document.addEventListener("DOMContentLoaded", domContentLoadedListener, { once: true });
    } else {
      notifyAppLoaded(true);
      setupMutationObserver();
    }

    globalThis.window.addEventListener("pagehide", handlePageHide);
    globalThis.window.addEventListener("pageshow", handlePageShow);

    const colorMode = params.get("color_mode");
    if (colorMode) setColorMode(colorMode);

    const inspectModeParam = params.get("inspect_mode");
    if (inspectModeParam === "true") {
      state.inspectMode = true;
      logger.debug("Inspect mode enabled from query param");
    }

    logger.debug("Initialized successfully");
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Release every global listener and DOM node owned by the Studio bridge. */
export function dispose(): void {
  invalidateStudioMessageOperations();
  if (domContentLoadedListener) {
    document.removeEventListener("DOMContentLoaded", domContentLoadedListener);
    domContentLoadedListener = null;
  }
  globalThis.window.removeEventListener("message", handleStudioMessage);
  globalThis.window.removeEventListener("pagehide", handlePageHide);
  globalThis.window.removeEventListener("pageshow", handlePageShow);
  disposeInspector();
  disposeErrorHandling();
  disposeConsoleCapture();
  disposeMessaging();

  ownedOverlayStyle?.remove();
  ownedHoverOverlay?.remove();
  ownedSelectionOverlay?.remove();
  if (state.hoverOverlay === ownedHoverOverlay) state.hoverOverlay = null;
  if (state.selectionOverlay === ownedSelectionOverlay) state.selectionOverlay = null;
  ownedOverlayStyle = null;
  ownedHoverOverlay = null;
  ownedSelectionOverlay = null;
  state.inspectMode = false;
  state.hoveredNodeId = null;
  state.selectedNodeId = null;
  appLifecycleActive = false;
  initialized = false;
}
