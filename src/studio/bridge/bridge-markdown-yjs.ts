/**
 * Bridge Markdown Yjs
 *
 * Yjs collaboration layer for the markdown editor.
 * Manages Y.Doc, WebsocketProvider, Y.Text binding, presence/awareness,
 * and remote change observation.
 */

import { state, LEXICAL_YJS_ORIGIN } from "./bridge-state.ts";
import { computeTextDiff } from "./bridge-markdown-core.ts";
import {
  applyMarkdownContent,
  setMarkdownPresence,
  setMarkdownSelections,
} from "./bridge-markdown-editor.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarkdownYjsConnectionOptions {
  wsUrl: string;
  guid: string;
  fileId: string;
  token?: string;
}

interface PresenceUser {
  id: string;
  name: string;
  color: string;
  isCurrentUser: boolean;
  isAgent: boolean;
}

interface RemoteSelection {
  id: string;
  name: string;
  color: string;
  isCurrentUser: boolean;
  start: number;
  end: number;
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

  state.markdownYDoc.transact(() => {
    if (diff.deleteCount > 0) {
      state.markdownYText.delete(diff.index, diff.deleteCount);
    }
    if (diff.insertText) {
      state.markdownYText.insert(diff.index, diff.insertText);
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

  Promise.all([
    import("https://esm.sh/yjs@13.6.28?target=es2022"),
    import("https://esm.sh/y-websocket@2.1.0?deps=yjs@13.6.28&target=es2022"),
  ])
    .then((modules) => {
      // Abort if edit mode was closed while imports were loading
      if (setupId !== state.markdownYjsSetupId) {
        return;
      }

      const Y = modules[0];
      const WebsocketProvider = modules[1].WebsocketProvider;
      state.markdownYjsY = Y;

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

      // Filter non-binary messages to prevent y-websocket parse errors
      provider.on("status", (event: { status: string }) => {
        console.debug("[StudioBridge] Yjs status:", event.status);
        if (event.status === "connected" && provider.ws) {
          const origOnMessage = provider.ws.onmessage;
          provider.ws.onmessage = function (wsEvent: MessageEvent) {
            if (typeof wsEvent.data === "string") {
              return;
            }
            if (origOnMessage) {
              origOnMessage.call(provider.ws, wsEvent);
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
          const parts = cookieMatch[1].split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(
              atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
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
        const states: [number, Record<string, any>][] = Array.from(
          provider.awareness.getStates().entries(),
        );

        // Sync presence users
        const users: PresenceUser[] = [];
        for (let i = 0; i < states.length; i++) {
          const clientId = states[i][0];
          const st = states[i][1];
          const user = st.user;
          if (!user || typeof user.name !== "string") {
            continue;
          }
          users.push({
            id: user.id || String(clientId),
            name: user.name,
            color: user.color || "#6b7280",
            isCurrentUser: clientId === provider.awareness.clientID,
            isAgent: user.isAgent || false,
          });
        }
        setMarkdownPresence(users);

        // Sync remote selections
        const selections: RemoteSelection[] = [];
        for (let j = 0; j < states.length; j++) {
          const cId = states[j][0];
          const st = states[j][1];
          const u = st.user;
          const ranges = st.selection;
          if (!u || !Array.isArray(ranges) || ranges.length === 0) {
            continue;
          }
          for (let k = 0; k < ranges.length; k++) {
            const range = ranges[k];
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
              id: u.id || String(cId),
              name: u.name || "Anonymous",
              color: u.color || "#6b7280",
              isCurrentUser: cId === provider.awareness.clientID,
              start: Math.min(anchorPos.index, markerPos.index),
              end: Math.max(anchorPos.index, markerPos.index),
            });
          }
        }
        setMarkdownSelections(selections);
      }

      // ------------------------------------------------------------------

      provider.awareness.on("change", syncAwareness);

      provider.on("sync", (synced: boolean) => {
        if (synced && !state.markdownYjsConnected) {
          state.markdownYjsConnected = true;

          const ytextContent = ytext.toString();
          if (
            state.markdownCurrentContent &&
            state.markdownCurrentContent !== ytextContent
          ) {
            // User typed before sync completed - push local edits to Y.Text
            syncLocalChangeToYText(state.markdownCurrentContent);
          } else if (ytextContent) {
            // No local edits - seed editor from Y.Text
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
          ytext.observe((event: any) => {
            if (event.transaction.origin === LEXICAL_YJS_ORIGIN) {
              return;
            }
            const fullContent = ytext.toString();
            if (fullContent === state.markdownCurrentContent) {
              return;
            }
            applyMarkdownContent(fullContent);
          });

          // Initial awareness sync after Yjs is connected
          syncAwareness();

          console.debug(
            "[StudioBridge] Yjs synced, bound to Y.Text for fileId:",
            config.fileId,
          );
        }
      });
    })
    .catch((error) => {
      console.error("[StudioBridge] Failed to setup Yjs connection:", error);
    });
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
}
