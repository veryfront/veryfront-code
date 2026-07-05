/**
 * ChatSidebar — conversation-native rail. Proves the two entry points that
 * Step 5 introduced: it lists straight from a `ConversationsProvider` with no
 * props, and it also works controlled from explicit `conversations`/`activeId`.
 */
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatSidebar } from "./sidebar.tsx";
import { ConversationsProvider } from "../contexts/conversations-context.tsx";
import { memoryConversationStore } from "../persistence/memory-conversation-store.ts";
import type { Conversation, ConversationSummary } from "../persistence/conversation-store.ts";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "localStorage",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    localStorage: window.localStorage,
  });
  window.localStorage.clear();
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

function conversation(id: string, title: string, updatedAt: number): Conversation {
  return { id, title, messages: [], createdAt: updatedAt, updatedAt };
}

function summary(id: string, title: string, updatedAt: number): ConversationSummary {
  return { id, title, messageCount: 2, createdAt: updatedAt, updatedAt };
}

describe("ChatSidebar — conversation-native", () => {
  it("lists conversations straight from context with no props", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation("a", "First chat", 2000),
      conversation("b", "Second chat", 1000),
    ]);
    try {
      const root = createRoot(document.getElementById("root")!);
      root.render(
        <ConversationsProvider store={store} id="a">
          <ChatSidebar fill />
        </ConversationsProvider>,
      );
      await settle();

      const html = document.getElementById("root")!.innerHTML;
      assert(html.includes("First chat"), "lists the first conversation from context");
      assert(html.includes("Second chat"), "lists the second conversation from context");

      root.unmount();
    } finally {
      restoreDom();
    }
  });

  it("works controlled from explicit conversations/activeId (no provider)", async () => {
    const restoreDom = installDom();
    try {
      const root = createRoot(document.getElementById("root")!);
      root.render(
        <ChatSidebar
          fill
          conversations={[summary("x", "Controlled chat", 5000)]}
          activeId="x"
          onSelect={() => {}}
          onDelete={() => {}}
        />,
      );
      await settle();

      assert(
        document.getElementById("root")!.innerHTML.includes("Controlled chat"),
        "lists the controlled conversation",
      );

      root.unmount();
    } finally {
      restoreDom();
    }
  });
});
