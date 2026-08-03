/**
 * Characterization safety net for `app-mode-chat.tsx` — the "app mode"
 * (uncontrolled) path. `UncontrolledChat` is internal (not exported), so it's
 * exercised indirectly through the exported `ConversationBoundChat`.
 *
 * `useConversationChat` (wraps `useChat`) and `useAgentMetadata` are both
 * effect-driven: no network call fires synchronously during `renderToString`,
 * so `agent` stays `null`/loading on the very first render. With no
 * `ConversationsProvider` in scope, `ConversationBoundChat` renders
 * `UncontrolledChat` directly (the simple, testable path) — the
 * provider-present branches (waiting for the active thread, or the picked
 * conversation) require a live `ConversationsProvider` wired to a store,
 * which isn't reachable via a bare SSR render without constructing a mock
 * store; they're intentionally left uncharacterized here.
 *
 * These tests describe current behaviour, not desired behaviour. If an
 * intentional change alters an output, update the assertion in the same
 * commit and say why.
 */
import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ConversationBoundChat } from "./app-mode-chat.tsx";

describe("ConversationBoundChat — app mode, no ConversationsProvider", () => {
  it("renders the initializing skeleton on first render when agentId is set (agent metadata not yet resolved)", () => {
    const html = renderToString(
      <ConversationBoundChat agentId="test-agent" api="/api/ag-ui" />,
    );
    assertStringIncludes(html, 'aria-busy="true"');
  });

  it("renders without throwing when agentId is omitted entirely", () => {
    const html = renderToString(<ConversationBoundChat api="/api/ag-ui" />);
    assertStringIncludes(html, "<");
  });

  it("renders a composer even while agent metadata is still resolving", () => {
    const html = renderToString(
      <ConversationBoundChat agentId="test-agent" api="/api/ag-ui" />,
    );
    assertStringIncludes(html, "Type a message...");
  });
});
