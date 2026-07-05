/**
 * useConversation — the singular loader. Proves it fetches one full
 * conversation by id from the store and reports a missing id as `null`.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useConversation, type UseConversationResult } from "./use-conversation.ts";
import { memoryConversationStore } from "../persistence/memory-conversation-store.ts";
import type { Conversation, ConversationStore } from "../persistence/conversation-store.ts";

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
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync(() => {});
}

function conversation(id: string, title: string): Conversation {
  return { id, title, messages: [], createdAt: 1, updatedAt: 1 };
}

function mount(store: ConversationStore, id: string | null) {
  let latest: UseConversationResult | null = null;
  const Capture = (): null => {
    latest = useConversation(id, { store });
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return { root, get: () => latest! };
}

describe("react/components/chat/hooks/useConversation", () => {
  it("loads a full conversation by id from the store", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([conversation("a", "Alpha")]);
    try {
      const view = mount(store, "a");
      await settle();
      assertEquals(view.get().conversation?.title, "Alpha");
      assertEquals(view.get().isLoading, false);
      flushSync(() => view.root.unmount());
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("returns null for a missing id", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([conversation("a", "Alpha")]);
    try {
      const view = mount(store, "does-not-exist");
      await settle();
      assert(view.get().conversation === null, "unknown id resolves to null");
      flushSync(() => view.root.unmount());
      await settle();
    } finally {
      restoreDom();
    }
  });
});
