/**
 * useConversations — render-level tests for the stateful hook methods that the
 * pure-helper suite (`use-conversations.test.ts`) can't reach. Focus: `save`,
 * the whole-conversation upsert that backs `<Chat onUpdate>`'s provider
 * default.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatMessage } from "#veryfront/agent/react";
import { useConversations, type UseConversationsResult } from "./use-conversations.ts";
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
  flushSync(() => {});
}

function mount(store: ConversationStore) {
  let latest: UseConversationsResult | null = null;
  function Capture(): null {
    latest = useConversations({ store });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return { root, get: () => latest! };
}

function userMsg(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "seed",
    title: "Seed",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("react/components/chat/hooks/useConversations — save", () => {
  it("selects the newest stored conversation in uncontrolled mode", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({ id: "older", title: "Older", updatedAt: 10 }),
      conversation({ id: "newer", title: "Newer", updatedAt: 20 }),
    ]);
    try {
      const view = mount(store);
      await settle();

      assertEquals(
        view.get().activeConversationId,
        "newer",
        "newest stored conversation should be active",
      );
      assertEquals(
        view.get().activeConversation?.title,
        "Newer",
        "active conversation should load",
      );

      flushSync(() => view.root.unmount());
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("upserts a new conversation into the list and persists it", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([conversation()]);
    try {
      const view = mount(store);
      await settle();

      const fresh = conversation({
        id: "new",
        title: "Hello world",
        messages: [userMsg("Hello world")],
        updatedAt: 5,
      });
      view.get().save(fresh);
      await settle();

      const summary = view.get().conversations.find((c) => c.id === "new");
      assert(summary, "new conversation is listed");
      assertEquals(summary.title, "Hello world");
      assertEquals(summary.messageCount, 1);

      // Persistence is debounced; unmount flushes the pending save.
      flushSync(() => view.root.unmount());
      await settle();
      await settle();
      assertEquals((await store.load("new"))?.title, "Hello world");
    } finally {
      restoreDom();
    }
  });

  it("updates an existing conversation in place (no duplicate)", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([conversation()]);
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({ title: "Renamed", updatedAt: 9 }));
      await settle();

      const matches = view.get().conversations.filter((c) => c.id === "seed");
      assertEquals(matches.length, 1, "no duplicate row");
      assertEquals(matches[0]?.title, "Renamed");

      // Persistence is debounced; unmount flushes the pending save.
      flushSync(() => view.root.unmount());
      await settle();
      await settle();
      assertEquals((await store.load("seed"))?.title, "Renamed");
    } finally {
      restoreDom();
    }
  });

  it("does not persist a pending save after that conversation is removed", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({ id: "seed", title: "Seed", updatedAt: 2 }),
      conversation({ id: "other", title: "Other", updatedAt: 1 }),
    ]);
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({
        id: "seed",
        title: "Pending delete",
        messages: [userMsg("soon gone")],
        updatedAt: 3,
      }));
      await settle();
      view.get().remove("seed");
      await new Promise((r) => setTimeout(r, 350));
      await settle();

      assertEquals(await store.load("seed"), null, "removed conversation must stay deleted");
      flushSync(() => view.root.unmount());
      await settle();
    } finally {
      restoreDom();
    }
  });
});
