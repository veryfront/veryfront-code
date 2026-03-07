/**
 * Bridge Markdown Yjs
 *
 * Yjs collaboration layer for the markdown editor.
 * Manages Y.Doc, WebsocketProvider, Y.Text binding, presence/awareness,
 * and remote change observation.
 *
 * NOTE: This module participates in a circular import cycle with
 * bridge-markdown-core.ts and bridge-markdown-editor.ts.
 * All cross-module calls must remain in function bodies (never at module top-level).
 */

import { logger } from "./bridge-logger.ts";
import { editorState as state } from "./bridge-editor-state.ts";
import { LEXICAL_YJS_ORIGIN, type PresenceUser, type RemoteSelection } from "./bridge-state.ts";
import { computeTextDiff } from "./bridge-markdown-core.ts";
import { applyMarkdownContent, updateMarkdownOverlaySelections } from "./bridge-markdown-editor.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarkdownYjsConnectionOptions {
  wsUrl: string;
  guid: string;
  fileId: string;
  token?: string;
}

interface YTextEvent {
  transaction: { origin: unknown };
}

// ---------------------------------------------------------------------------
// syncLocalChangeToYText
// ---------------------------------------------------------------------------

/**
 * Compute the diff between the current Y.Text content and the provided full
 * content string, then apply the minimal set of Y.Text operations inside a
 * transaction tagged with LEXICAL_YJS_ORIGIN so that our own observe handler
 * ignores it.
 */
export function syncLocalChangeToYText(fullContent: string): void {
  if (!state.markdownYText || !state.markdownYDoc) {
    return;
  }

  const currentYContent: string = state.markdownYText.toString();
  if (currentYContent === fullContent) {
    return;
  }

  const diff = computeTextDiff(currentYContent, fullContent);
  if (diff.deleteCount === 0 && diff.insertText === "") {
    return;
  }

  const ytext = state.markdownYText;
  state.markdownYDoc.transact(() => {
    if (diff.deleteCount > 0) {
      ytext.delete(diff.index, diff.deleteCount);
    }
    if (diff.insertText) {
      ytext.insert(diff.index, diff.insertText);
    }
  }, LEXICAL_YJS_ORIGIN);
}

// ---------------------------------------------------------------------------
// setupMarkdownYjsConnection
// ---------------------------------------------------------------------------

/**
 * Dynamically imports Yjs + y-websocket, creates a Y.Doc & WebsocketProvider,
 * wires up awareness (presence + remote selections), and binds the Y.Text
 * instance to the markdown editor via observe callbacks.
 *
 * Successive calls while a connection is already live are no-ops.
 * A monotonically-increasing setupId guards against stale async callbacks
 * when the user leaves edit mode before the dynamic imports resolve.
 */
export function setupMarkdownYjsConnection(config: MarkdownYjsConnectionOptions): void {
  if (state.markdownYDoc) {
    return;
  }

  const setupId = ++state.markdownYjsSetupId;

  void (async () => {
    try {
      const modules = await Promise.all([
        import("https://esm.sh/yjs@13.6.28?target=es2022"),
        import("https://esm.sh/y-websocket@2.1.0?deps=yjs@13.6.28&target=es2022"),
      ]);

      // Abort if edit mode was closed while imports were loading
      if (setupId !== state.markdownYjsSetupId) {
        return;
      }

      const Y = modules[0];
      const WebsocketProvider = modules[1].WebsocketProvider;
      state.markdownYjsY = Y as unknown as import("./bridge-editor-state.ts").YjsModule;

      logger.debug("Yjs setup", {
        wsUrl: config.wsUrl,
        guid: config.guid,
        fileId: config.fileId,
      });

      const doc = new Y.Doc({ guid: config.guid });
      // Cookie auth: authToken cookie on .veryfront.com is sent automatically
      // with the WebSocket upgrade request. No explicit token param needed.
      const provider = new WebsocketProvider(config.wsUrl, config.guid, doc, {
        resyncInterval: -1,
      });

      const ytext = doc.getText(config.fileId);

      state.markdownYDoc = doc;
      state.markdownYProvider = provider;
      state.markdownYText = ytext;
      const isCurrentSetup = (): boolean =>
        setupId === state.markdownYjsSetupId &&
        state.markdownYProvider === provider &&
        state.markdownYDoc === doc &&
        state.markdownYText === ytext;

      // Filter non-binary messages to prevent y-websocket parse errors
      provider.on("status", (event: { status: string }) => {
        if (!isCurrentSetup()) {
          return;
        }
        logger.debug("Yjs status", {
          status: event.status,
          hasWs: !!provider.ws,
          wsReadyState: provider.ws?.readyState,
        });
        if (event.status !== "connected") {
          state.markdownYjsConnected = false;
          return;
        }
        if (provider.ws) {
          const ws = provider.ws;
          const origOnMessage = ws.onmessage;
          ws.onmessage = function (wsEvent: MessageEvent) {
            if (typeof wsEvent.data === "string") {
              logger.debug("Yjs filtered string message", {
                preview: (wsEvent.data as string).slice(0, 120),
              });
              return;
            }
            if (origOnMessage) {
              origOnMessage.call(ws, wsEvent);
            }
          };
        }
      });

      // Extract user identity from authToken JWT cookie for presence
      const presenceUser: { id: string; name: string } = {
        id: "preview-" + Math.random().toString(36).slice(2),
        name: "Preview",
      };
      try {
        const cookieMatch = document.cookie.match(/authToken=([^;]+)/);
        if (cookieMatch) {
          const parts = (cookieMatch[1] ?? "").split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(
              atob((parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")),
            );
            if (payload.userId) {
              presenceUser.id = payload.userId;
            }
            if (payload.email) {
              const local = payload.email.split("@")[0] || "";
              if (local.includes(".") || local.includes("_")) {
                presenceUser.name = local
                  .split(/[._]/)
                  .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
                  .join(" ");
              } else {
                presenceUser.name = local.charAt(0).toUpperCase() + local.slice(1);
              }
            }
          }
        }
      } catch (_e) {
        // Fall back to defaults on any parse error
      }

      // Set local user on awareness for presence
      provider.awareness.setLocalStateField("user", {
        id: presenceUser.id,
        name: presenceUser.name,
        color: "#10b981",
      });

      // ------------------------------------------------------------------
      // Nested: syncAwareness
      // ------------------------------------------------------------------

      /**
       * Read all awareness states, derive presence users and remote text
       * selections, and push both to the editor UI.
       */
      function syncAwareness(): void {
        if (!isCurrentSetup()) {
          return;
        }
        const states = Array.from(
          provider.awareness.getStates().entries(),
        ) as [number, Record<string, unknown>][];

        // Sync presence users (stored for overlay name labels)
        const users: PresenceUser[] = [];
        for (const [clientId, st] of states) {
          const user = st.user as Record<string, unknown> | undefined;
          if (!user || typeof user.name !== "string") {
            continue;
          }
          users.push({
            id: (user.id as string) || String(clientId),
            name: user.name,
            color: (user.color as string) || "#6b7280",
            isCurrentUser: clientId === provider.awareness.clientID,
            isAgent: (user.isAgent as boolean) || false,
          });
        }
        state.markdownLatestPresenceUsers = users;

        // Sync remote selections → overlay cursors
        const selections: RemoteSelection[] = [];
        for (const [cId, st] of states) {
          const u = st.user as Record<string, unknown> | undefined;
          const ranges = st.selection;
          if (!u || !Array.isArray(ranges) || ranges.length === 0) {
            continue;
          }
          for (const range of ranges) {
            const anchorPos = Y.createAbsolutePositionFromRelativePosition(
              range.anchor,
              doc,
            );
            const markerPos = Y.createAbsolutePositionFromRelativePosition(
              range.marker,
              doc,
            );
            if (
              !anchorPos ||
              !markerPos ||
              anchorPos.type !== ytext ||
              markerPos.type !== ytext
            ) {
              continue;
            }
            selections.push({
              id: (u.id as string) || String(cId),
              name: (u.name as string) || "Anonymous",
              color: (u.color as string) || "#6b7280",
              isCurrentUser: cId === provider.awareness.clientID,
              start: Math.min(anchorPos.index, markerPos.index),
              end: Math.max(anchorPos.index, markerPos.index),
            });
          }
        }
        updateMarkdownOverlaySelections(selections);
      }

      // ------------------------------------------------------------------

      provider.awareness.on("change", syncAwareness);

      // Register Y.Text observer once (outside sync handler to prevent
      // duplicate registration on reconnect — sync can fire multiple times)
      let ytextObserverRegistered = false;

      provider.on("sync", (synced: boolean) => {
        if (!isCurrentSetup()) {
          return;
        }
        logger.debug("Yjs sync", {
          synced,
          ytextLength: ytext.length,
          contentPreview: ytext.toString().slice(0, 80),
        });
        if (!synced) {
          state.markdownYjsConnected = false;
          return;
        }
        if (!state.markdownYjsConnected) {
          state.markdownYjsConnected = true;

          const ytextContent = ytext.toString();
          if (
            state.markdownHasUnsavedChanges &&
            state.markdownCurrentContent !== ytextContent
          ) {
            // User made actual edits before sync completed - push to Y.Text
            syncLocalChangeToYText(state.markdownCurrentContent);
          } else {
            // No conflicting local edits - seed editor from Y.Text (including empty content)
            applyMarkdownContent(ytextContent);
          }

          // Replay any selection queued before Yjs was ready
          if (state.markdownPendingSelection) {
            const ps = state.markdownPendingSelection;
            state.markdownPendingSelection = null;
            const cs = Math.max(0, Math.min(ytext.length, ps.start));
            const ce = Math.max(0, Math.min(ytext.length, ps.end));
            provider.awareness.setLocalStateField("selection", [
              {
                anchor: Y.createRelativePositionFromTypeIndex(ytext, cs),
                marker: Y.createRelativePositionFromTypeIndex(ytext, ce),
              },
            ]);
          }

          // Observe Y.Text for remote changes (from other users / Monaco)
          if (!ytextObserverRegistered) {
            ytextObserverRegistered = true;
            ytext.observe((event: unknown) => {
              if (!isCurrentSetup()) {
                return;
              }
              const origin = (event as YTextEvent).transaction.origin;
              if (origin === LEXICAL_YJS_ORIGIN) {
                return;
              }
              const fullContent = ytext.toString();
              const contentMatch = fullContent === state.markdownCurrentContent;
              logger.debug("Yjs Y.Text observer", {
                origin: String(origin),
                contentMatch,
                ytextLength: fullContent.length,
              });
              if (contentMatch) {
                return;
              }
              applyMarkdownContent(fullContent);
            });
          }

          // Initial awareness sync after Yjs is connected
          syncAwareness();

          logger.debug("Yjs synced, bound to Y.Text for fileId", {
            fileId: config.fileId,
          });
        }
      });
    } catch (error) {
      logger.error(
        "Failed to setup Yjs connection",
        error instanceof Error ? error : { error: String(error) },
      );
    }
  })();
}

// ---------------------------------------------------------------------------
// writeToYText (programmatic write, e.g. from agent or debug)
// ---------------------------------------------------------------------------

/**
 * Write content into Y.Text at a given position or at the end.
 * The write appears as coming from a distinct "agent" presence.
 * Returns true if the write succeeded (Yjs is connected and Y.Text exists).
 */
export function writeToYText(
  text: string,
  options?: { position?: number; origin?: string },
): boolean {
  if (!state.markdownYText || !state.markdownYDoc || !state.markdownYjsConnected) {
    logger.warn("writeToYText: Yjs not connected or not synced");
    return false;
  }

  const origin = options?.origin ?? "agent-write";
  const pos = options?.position ?? state.markdownYText.length;
  const safePos = Math.max(0, Math.min(pos, state.markdownYText.length));

  const yt = state.markdownYText;
  state.markdownYDoc.transact(() => {
    yt.insert(safePos, text);
  }, origin);

  return true;
}

/**
 * Replace all Y.Text content with new content.
 * Returns true if the write succeeded.
 */
export function replaceYTextContent(content: string): boolean {
  if (!state.markdownYText || !state.markdownYDoc || !state.markdownYjsConnected) {
    logger.warn("replaceYTextContent: Yjs not connected or not synced");
    return false;
  }

  const yt2 = state.markdownYText;
  state.markdownYDoc.transact(() => {
    yt2.delete(0, yt2.length);
    yt2.insert(0, content);
  }, "agent-write");

  return true;
}

// ---------------------------------------------------------------------------
// disposeMarkdownYjs
// ---------------------------------------------------------------------------

/**
 * Tear down the Yjs connection: disconnect + destroy the provider and doc,
 * then reset all related shared state fields.
 */
export function disposeMarkdownYjs(): void {
  state.markdownYjsSetupId++;

  if (state.markdownYProvider) {
    state.markdownYProvider.awareness.setLocalStateField("selection", null);
    state.markdownYProvider.disconnect();
    state.markdownYProvider.destroy();
    state.markdownYProvider = null;
  }
  if (state.markdownYDoc) {
    state.markdownYDoc.destroy();
    state.markdownYDoc = null;
  }

  state.markdownYText = null;
  state.markdownYjsConnected = false;
  state.markdownYjsY = null;
  state.markdownPendingSelection = null;
  state.markdownLastRemoteContent = null;
  state.markdownApplyingRemoteUpdate = false;
  state.markdownLatestPresenceUsers = [];
  updateMarkdownOverlaySelections([]);
}
