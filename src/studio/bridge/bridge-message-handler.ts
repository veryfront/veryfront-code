/**
 * Bridge Message Handler
 *
 * Dispatches incoming Studio messages to the appropriate bridge functions.
 */

import { logger } from "./bridge-logger.ts";
import { state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import { isFromStudio, postToStudio } from "./bridge-messaging.ts";
import {
  hideOverlay,
  scrollToElement,
  setColorMode,
  showHoverOverlay,
  showSelectionOverlay,
} from "./bridge-inspector.ts";
import { captureMultipleSections, captureScreenshot } from "./bridge-screenshot.ts";

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/** Returns true if the URL is safe for navigation (relative or http/https only). */
export function isSafeNavigationUrl(url: string): boolean {
  return sanitizeNavigationUrl(url) !== null;
}

/**
 * Return a sanitized URL safe for `window.location.href` assignment, or null
 * if the URL must be blocked. Relative paths are returned as-is; absolute URLs
 * must use http/https and target veryfront.com (or a subdomain) to prevent
 * open-redirect. The browser-normalized `parsed.href` is returned instead of
 * the raw input so tainted values never reach the DOM sink.
 */
export function sanitizeNavigationUrl(url: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;

  // Relative paths are same-origin by definition
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;

    // Allow same-origin navigation unconditionally
    if (parsed.origin === window.location.origin) return parsed.href;

    // For cross-origin, restrict to veryfront.com
    const host = parsed.hostname;
    if (host !== "veryfront.com" && !host.endsWith(".veryfront.com")) return null;

    return parsed.href;
  } catch {
    return null;
  }
}

function clearSelection(notifyStudio = false): void {
  state.selectedNodeId = null;
  hideOverlay(state.selectionOverlay);

  if (notifyStudio) {
    postToStudio({ action: "setSelectedNode", id: null });
  }
}

function disableInspectMode(deselectElements = false): void {
  state.inspectMode = false;
  hideOverlay(state.hoverOverlay);
  state.hoveredNodeId = null;

  if (deselectElements) {
    clearSelection();
  }
}

function postScreenshotResult(
  requestId: unknown,
  result: Awaited<ReturnType<typeof captureScreenshot>>,
): void {
  postToStudio({
    action: "screenshotResult",
    requestId,
    multiple: false,
    ...result,
  });
}

async function handleScreenshotRequest(message: {
  requestId?: unknown;
  multipleSections?: boolean;
  sectionCount?: number;
  options?: {
    scrollTo?: number;
    fullPage?: boolean;
    quality?: number;
  };
}): Promise<void> {
  if (message.multipleSections) {
    const results = await captureMultipleSections(message.sectionCount);
    postToStudio({
      action: "screenshotResult",
      requestId: message.requestId,
      multiple: true,
      results,
    });
    return;
  }

  const result = await captureScreenshot(message.options);
  postScreenshotResult(message.requestId, result);
}

export function handleStudioMessage(event: MessageEvent): void {
  if (!isFromStudio(event)) return;

  const message = event.data;
  if (!message?.action) return;

  const config = getConfig();

  switch (message.action) {
    case "routeChange": {
      const safeUrl = sanitizeNavigationUrl(message.url);
      if (!safeUrl) {
        logger.warn("[StudioBridge] Blocked unsafe URL in routeChange", { url: message.url });
        return;
      }
      if (state.selectedNodeId) {
        clearSelection(true);
      }
      postToStudio({
        action: "onPageTransitionStart",
        url: safeUrl,
        projectId: config.projectId,
      });
      window.location.href = safeUrl;
      return;
    }

    case "reload":
      window.location.reload();
      return;

    case "goBack":
      window.history.back();
      return;

    case "goForward":
      window.history.forward();
      return;

    case "colorMode":
      setColorMode(message.value);
      return;

    case "toggleInspectMode":
      state.inspectMode = message.value;
      if (state.inspectMode) return;

      disableInspectMode(message.deselectElements);
      return;

    case "setSelectedNode":
      state.selectedNodeId = message.id;
      showSelectionOverlay(message.id);
      if (message.scroll) scrollToElement(message.id);
      return;

    case "setHoveredNode":
      if (!state.inspectMode) showHoverOverlay(message.id);
      return;

    case "screenshot":
      void handleScreenshotRequest(message);
      return;

    default:
      logger.debug("Unknown action", { action: message.action });
      return;
  }
}
