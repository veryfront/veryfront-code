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
  // Relative URLs starting with / are always safe
  if (url.startsWith("/")) return true;

  try {
    const parsed = new URL(url, window.location.origin);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function handleStudioMessage(event: MessageEvent): void {
  if (!isFromStudio(event)) return;

  const message = event.data;
  if (!message?.action) return;

  const config = getConfig();

  switch (message.action) {
    case "routeChange":
      if (message.url) {
        if (!isSafeNavigationUrl(message.url)) {
          logger.warn("[StudioBridge] Blocked unsafe URL in routeChange", { url: message.url });
          return;
        }
        if (state.selectedNodeId) {
          state.selectedNodeId = null;
          hideOverlay(state.selectionOverlay);
          postToStudio({ action: "setSelectedNode", id: null });
        }
        postToStudio({
          action: "onPageTransitionStart",
          url: message.url,
          projectId: config.projectId,
        });
        window.location.href = message.url;
      }
      return;

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

      hideOverlay(state.hoverOverlay);
      state.hoveredNodeId = null;

      if (!message.deselectElements) return;

      hideOverlay(state.selectionOverlay);
      state.selectedNodeId = null;
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
      (async function () {
        if (message.multipleSections) {
          const results = await captureMultipleSections(message.sectionCount);
          postToStudio({
            action: "screenshotResult",
            requestId: message.requestId,
            multiple: true,
            results: results,
          });
          return;
        }

        const result = await captureScreenshot(message.options);
        postToStudio({
          action: "screenshotResult",
          requestId: message.requestId,
          multiple: false,
          ...result,
        });
      })();
      return;

    default:
      logger.debug("Unknown action", { action: message.action });
      return;
  }
}
