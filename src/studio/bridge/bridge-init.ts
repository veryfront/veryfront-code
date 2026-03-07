/**
 * Bridge Init
 *
 * Initialization flow: sets up overlays, console capture, error handling,
 * inspect mode, markdown editor, mutation observer, and message listener.
 */

import { logger } from "./bridge-logger.ts";
import { state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import { postToStudio } from "./bridge-messaging.ts";
import { registerEditorCallbacks } from "./bridge-editor-callbacks.ts";
import { injectOverlayStyles } from "./bridge-styles.ts";
import {
  createOverlay,
  setColorMode,
  setupInspectMode,
  setupMutationObserver,
} from "./bridge-inspector.ts";
import { setupConsoleCapture, setupErrorHandling } from "./bridge-console.ts";
import { setupMarkdownEditor } from "./bridge-markdown-editor.ts";
import { handleStudioMessage } from "./bridge-message-handler.ts";

export function notifyAppLoaded(): void {
  const config = getConfig();

  postToStudio({ action: "appLoaded", url: window.location.href });

  postToStudio({
    action: "appUpdated",
    url: window.location.href,
    id: config.pageId,
    isInitialLoad: true,
    errors: [],
    warnings: [],
  });

  postToStudio({
    action: "onPageTransitionEnd",
    url: window.location.href,
    projectId: config.projectId,
    id: config.pageId,
    params: {},
  });
}

export function notifyAppUnloaded(): void {
  postToStudio({ action: "appUnloaded", url: window.location.href });
}

export function init(): void {
  const config = getConfig();
  const params = new URLSearchParams(window.location.search);
  const studioEmbed = params.get("studio_embed") === "true";
  const isStandalone = window.parent === window && !studioEmbed;

  if (isStandalone) {
    // Allow standalone markdown editing when WS_URL is available (server-injected Yjs config)
    if (!config.wsUrl) {
      logger.debug(
        "[StudioBridge] Not in iframe and not studio_embed mode, skipping initialization",
      );
      return;
    }
  }

  logger.debug("Initializing...");

  // Only set up Studio interaction features when embedded in Studio
  if (!isStandalone) {
    injectOverlayStyles();
    state.hoverOverlay = createOverlay("hover");
    state.selectionOverlay = createOverlay("selection");

    setupConsoleCapture();
    setupErrorHandling();
    setupInspectMode();
  }

  registerEditorCallbacks({
    onContentChange(fileId, filePath, content, save) {
      postToStudio({
        action: "markdownContentChange",
        fileId,
        filePath,
        content,
        ...(save ? { save: true } : {}),
      });
    },
    onEditorReady(fileId, filePath) {
      postToStudio({ action: "markdownEditorReady", fileId, filePath });
    },
    onOpenFile(filePath, lineNumber, columnNumber, symbolName) {
      const payload: Record<string, unknown> = {
        action: "openFile",
        filePath,
        lineNumber,
        columnNumber,
      };
      if (symbolName) {
        payload.symbolName = symbolName;
      }
      postToStudio(payload);
    },
  });

  setupMarkdownEditor(params);

  window.addEventListener("message", handleStudioMessage);

  if (!isStandalone) {
    // IMPORTANT: notifyAppLoaded() must be called BEFORE setupMutationObserver()
    // because notifyAppLoaded sends onPageTransitionEnd which sets previewId,
    // and treeUpdated (from setupMutationObserver) requires previewId to be set
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        notifyAppLoaded();
        setupMutationObserver();
      });
    } else {
      notifyAppLoaded();
      setupMutationObserver();
    }

    window.addEventListener("beforeunload", notifyAppUnloaded);
  }

  const colorMode = params.get("color_mode");
  if (colorMode) setColorMode(colorMode);

  if (!isStandalone) {
    const inspectModeParam = params.get("inspect_mode");
    if (inspectModeParam === "true") {
      state.inspectMode = true;
      logger.debug("Inspect mode enabled from query param");
    }
  }

  logger.debug("Initialized successfully");
}
