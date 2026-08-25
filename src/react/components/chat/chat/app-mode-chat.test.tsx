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
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ConversationBoundChat } from "./app-mode-chat.tsx";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    self: dom.window,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

describe("ConversationBoundChat — app mode, no ConversationsProvider", () => {
  it("renders the initializing skeleton on first render when agentId is set (agent metadata not yet resolved)", () => {
    const html = renderToString(
      <ConversationBoundChat agentId="test-agent" api="/api/ag-ui" />,
    );
    assertStringIncludes(html, 'aria-busy="true"');
  });

  it("renders without throwing when agentId is omitted entirely", () => {
    const html = renderToString(<ConversationBoundChat api="/api/ag-ui" />);
    assertStringIncludes(html, "Type a message...", "composer renders when agentId is omitted");
    assert(
      !html.includes('aria-busy="true"'),
      "no initializing skeleton without an agentId to resolve",
    );
  });

  it("renders a composer even while agent metadata is still resolving", () => {
    const html = renderToString(
      <ConversationBoundChat agentId="test-agent" api="/api/ag-ui" />,
    );
    assertStringIncludes(html, "Type a message...");
  });

  it("omits agent descriptions but preserves an explicit empty-state description", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({
          agent: {
            id: "test-agent",
            name: "Test Agent",
            description: "Metadata description",
            avatar_url: null,
          },
        })),
      )) as typeof fetch;
    let root: ReturnType<typeof createRoot> | undefined;
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => createdRoot.render(<ConversationBoundChat agentId="test-agent" />));
      await settle();

      assertStringIncludes(rootElement.textContent ?? "", "Test Agent");
      assert(
        !rootElement.textContent?.includes("Metadata description"),
        "agent metadata description is not rendered",
      );

      flushSync(() =>
        createdRoot.render(
          <ConversationBoundChat
            agentId="test-agent"
            emptyState={{ title: "Custom title", description: "Custom description" }}
          />,
        )
      );
      assertStringIncludes(rootElement.textContent ?? "", "Custom description");
    } finally {
      if (root) await unmountReactRoot(root);
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });
});
