/**
 * Bridge Message Handler
 *
 * Dispatches incoming Studio messages to the appropriate bridge functions.
 */

import { logger } from "./bridge-logger.ts";
import { editorState } from "./bridge-editor-state.ts";
import { state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import { isFromStudio, postToStudio } from "./bridge-messaging.ts";
import {
  hideOverlay,
  isMarkdownPage,
  scrollToElement,
  setColorMode,
  showHoverOverlay,
  showSelectionOverlay,
} from "./bridge-inspector.ts";
import { captureMultipleSections, captureScreenshot } from "./bridge-screenshot.ts";
import { applyMarkdownContent } from "./bridge-markdown-editor.ts";
import { replaceYTextContent, writeToYText } from "./bridge-markdown-yjs.ts";

export function handleStudioMessage(event: MessageEvent): void {
  if (!isFromStudio(event)) return;

  const message = event.data;
  if (!message?.action) return;

  const config = getConfig();

  switch (message.action) {
    case "routeChange":
      if (message.url) {
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

    case "setMarkdownPersistState":
      return;

    case "agentWriteMarkdown": {
      const content = typeof message.content === "string" ? message.content : "";
      const mode: string = typeof message.mode === "string" ? message.mode : "replace";
      if (mode === "replace") {
        replaceYTextContent(content);
      } else if (mode === "append") {
        writeToYText(content);
      } else if (mode === "insert_at") {
        writeToYText(content, {
          position: typeof message.position === "number" ? message.position : 0,
          origin: "agent-write",
        });
      }
      return;
    }

    case "contentChanged": {
      if (!isMarkdownPage()) return;
      if (
        message.fileId && editorState.markdownFileId &&
        message.fileId !== editorState.markdownFileId
      ) {
        return;
      }

      const content = typeof message.content === "string" ? message.content : null;
      const isEditMode = !!editorState.markdownEditorRoot &&
        editorState.markdownEditorRoot.style.display === "block";

      if (isEditMode) {
        if (content !== null && !editorState.markdownYjsConnected) {
          applyMarkdownContent(content);
        }
      } else {
        window.location.reload();
      }
      return;
    }

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
