/**
 * useConversations — render-level tests for the stateful hook methods that the
 * pure-helper suite (`use-conversations.test.ts`) can't reach. Focus: `save`,
 * the whole-conversation upsert that backs `<Chat onUpdate>`'s provider
 * default.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  conversationSummary,
  createEmptyConversation,
  DEFAULT_CONVERSATION_TITLE,
  useConversations,
  type UseConversationsOptions,
  type UseConversationsPersistenceState,
  type UseConversationsResult,
} from "./use-conversations.ts";
import { memoryConversationStore } from "../persistence/memory-conversation-store.ts";
import {
  type Conversation,
  type ConversationStore,
  ConversationStoreError,
  type ConversationSummary,
} from "../persistence/conversation-store.ts";

type ConversationsHookResult = UseConversationsResult & UseConversationsPersistenceState;

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

function mount(
  store: ConversationStore,
  onError?: (error: ConversationStoreError) => void,
) {
  let latest: ConversationsHookResult | null = null;
  function Capture(): null {
    latest = useConversations({ store, onError });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return { root, get: () => latest! };
}

function mountOptions(initialOptions: UseConversationsOptions) {
  let latest: ConversationsHookResult | null = null;
  let options = initialOptions;
  function Capture(): null {
    latest = useConversations(options);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    root,
    get: () => latest!,
    render(nextOptions: UseConversationsOptions): void {
      options = nextOptions;
      flushSync(() => root.render(<Capture />));
    },
  };
}

function persistenceError(
  result: ConversationsHookResult,
): ConversationStoreError | null {
  return result.error;
}

function activeConversationLoading(result: ConversationsHookResult): boolean {
  return result.isActiveConversationLoading;
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

describe("react/components/chat/hooks/useConversations — active conversation loading", () => {
  it("keeps only the current controlled selection loading across stale completion", async () => {
    const restoreDom = installDom();
    const records = {
      a: conversation({ id: "a", title: "Alpha" }),
      b: conversation({ id: "b", title: "Beta" }),
    };
    const resolvers = new Map<string, (value: Conversation | null) => void>();
    const store: ConversationStore = {
      list: () => Promise.resolve(Object.values(records).map(conversationSummary)),
      load: (id) =>
        new Promise((resolve) => {
          resolvers.set(id, resolve);
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mountOptions({ store, id: "a" });
      await settle();
      assert(resolvers.has("a"));
      assertEquals(view.get().isLoading, false, "the initial list has settled");
      assertEquals(activeConversationLoading(view.get()), true);

      view.render({ store, id: "b" });
      await settle();
      assert(resolvers.has("b"));
      assertEquals(view.get().isLoading, false, "selection must not restart list loading");
      assertEquals(activeConversationLoading(view.get()), true);

      resolvers.get("a")!(records.a);
      await settle();
      assertEquals(view.get().activeConversation, null);
      assertEquals(activeConversationLoading(view.get()), true);

      resolvers.get("b")!(records.b);
      await settle();
      assertEquals(view.get().activeConversation?.id, "b");
      assertEquals(activeConversationLoading(view.get()), false);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps replacement-store loading isolated from an old scope", async () => {
    const restoreDom = installDom();
    let resolveFirst: ((value: Conversation | null) => void) | undefined;
    let resolveSecond: ((value: Conversation | null) => void) | undefined;
    const summary = conversationSummary(conversation({ id: "a" }));
    const first: ConversationStore = {
      list: () => Promise.resolve([summary]),
      load: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const second: ConversationStore = {
      list: () => Promise.resolve([summary]),
      load: () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mountOptions({ store: first, id: "a" });
      await settle();
      assert(resolveFirst);
      assertEquals(activeConversationLoading(view.get()), true);

      view.render({ store: second, id: "a" });
      await settle();
      assert(resolveSecond);
      assertEquals(activeConversationLoading(view.get()), true);

      resolveFirst(conversation({ id: "a", title: "Old scope" }));
      await settle();
      assertEquals(view.get().activeConversation, null);
      assertEquals(activeConversationLoading(view.get()), true);

      resolveSecond(conversation({ id: "a", title: "Current scope" }));
      await settle();
      assertEquals(view.get().activeConversation?.title, "Current scope");
      assertEquals(activeConversationLoading(view.get()), false);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("settles active loading when the store returns no record", async () => {
    const restoreDom = installDom();
    let resolveLoad: ((value: Conversation | null) => void) | undefined;
    const missing = conversation({ id: "missing", title: "Missing" });
    const store: ConversationStore = {
      list: () => Promise.resolve([conversationSummary(missing)]),
      load: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store);
      await settle();
      assert(resolveLoad);
      assertEquals(activeConversationLoading(view.get()), true);

      resolveLoad(null);
      await settle();
      assert(view.get().activeConversation);
      assert(view.get().activeConversation?.id !== "missing");
      assertEquals(activeConversationLoading(view.get()), false);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("settles active loading and reports the current load rejection", async () => {
    const restoreDom = installDom();
    let rejectLoad: ((reason: unknown) => void) | undefined;
    const failure = new Error("active load unavailable");
    const record = conversation({ id: "a" });
    const store: ConversationStore = {
      list: () => Promise.resolve([conversationSummary(record)]),
      load: () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mountOptions({ store, id: "a" });
      await settle();
      assert(rejectLoad);
      assertEquals(activeConversationLoading(view.get()), true);

      rejectLoad(failure);
      await settle();
      assertEquals(activeConversationLoading(view.get()), false);
      assertEquals(persistenceError(view.get())?.operation, "load");
      assertEquals(persistenceError(view.get())?.cause, failure);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("uses dirty active data without reporting a store load", async () => {
    const restoreDom = installDom();
    const alpha = conversation({ id: "a", title: "Alpha" });
    const beta = conversation({ id: "b", title: "Beta" });
    let betaLoads = 0;
    const store: ConversationStore = {
      list: () => Promise.resolve([conversationSummary(alpha)]),
      load: (id) => {
        if (id === "b") betaLoads += 1;
        return Promise.resolve(id === "a" ? alpha : null);
      },
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().save(beta);
        view.get().select("b");
      });
      await settle();

      assertEquals(view.get().activeConversation?.id, "b");
      assertEquals(activeConversationLoading(view.get()), false);
      assertEquals(betaLoads, 0);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps a pending active transaction loading until it supplies the record", async () => {
    const restoreDom = installDom();
    const alpha = conversation({ id: "a", title: "Alpha" });
    const beta = conversation({ id: "b", title: "Beta" });
    let betaRecord = beta;
    let resolveBeta: ((value: Conversation | null) => void) | undefined;
    let betaLoads = 0;
    const store: ConversationStore = {
      list: () => Promise.resolve([alpha, betaRecord].map(conversationSummary)),
      load: (id) => {
        if (id === "a") return Promise.resolve(alpha);
        betaLoads += 1;
        if (betaLoads > 1) return Promise.resolve(betaRecord);
        return new Promise((resolve) => {
          resolveBeta = resolve;
        });
      },
      save: (value) => {
        betaRecord = structuredClone(value);
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().update("b", { title: "Updated Beta" });
        view.get().select("b");
      });
      await settle();
      assert(resolveBeta);
      assertEquals(betaLoads, 1, "selection must reuse the pending transaction load");
      assertEquals(view.get().activeConversation, null);
      assertEquals(activeConversationLoading(view.get()), true);

      resolveBeta(beta);
      await settle();
      assertEquals(view.get().activeConversation?.title, "Updated Beta");
      assertEquals(activeConversationLoading(view.get()), false);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("consumes an active load rejection after unmount without reporting it", async () => {
    const restoreDom = installDom();
    let rejectLoad: ((reason: unknown) => void) | undefined;
    const reported: ConversationStoreError[] = [];
    const record = conversation({ id: "a" });
    const store: ConversationStore = {
      list: () => Promise.resolve([conversationSummary(record)]),
      load: () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mountOptions({ store, id: "a", onError: (error) => reported.push(error) });
      await settle();
      assert(rejectLoad);
      assertEquals(activeConversationLoading(view.get()), true);

      await unmountReactRoot(view.root);
      rejectLoad(new Error("late active load failure"));
      await settle();
      assertEquals(reported, []);
    } finally {
      restoreDom();
    }
  });
});

describe("react/components/chat/hooks/useConversations — save", () => {
  it("settles loading and exposes an initial list rejection", async () => {
    const restoreDom = installDom();
    const failure = new Error("list unavailable");
    const reported: ConversationStoreError[] = [];
    const store: ConversationStore = {
      list: () => Promise.reject(failure),
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, (error) => reported.push(error));
      await settle();

      assertEquals(view.get().isLoading, false);
      assert(persistenceError(view.get()) instanceof ConversationStoreError);
      assertEquals(persistenceError(view.get())?.operation, "list");
      assertEquals(persistenceError(view.get())?.cause, failure);
      assertEquals(reported, [persistenceError(view.get())]);
      assertEquals(view.get().conversations, []);
      flushSync(() => view.get().clearError?.());
      assertEquals(persistenceError(view.get()), null);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("consumes an initial list rejection after unmount", async () => {
    const restoreDom = installDom();
    let rejectList: ((reason: unknown) => void) | undefined;
    const reported: ConversationStoreError[] = [];
    const store: ConversationStore = {
      list: () =>
        new Promise((_resolve, reject) => {
          rejectList = reject;
        }),
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, (error) => reported.push(error));
      await Promise.resolve();
      assert(rejectList);
      await unmountReactRoot(view.root);
      rejectList(new Error("late list failure"));
      await settle();
      assertEquals(
        reported,
        [],
        "a list rejection that lands after unmount must not be reported to the consumer",
      );
      assertEquals(
        persistenceError(view.get()),
        null,
        "a post-unmount list rejection must not be written into state",
      );
    } finally {
      restoreDom();
    }
  });

  it("keeps the legacy active aliases aligned with the explicit fields", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
    ]);
    try {
      const view = mount(store);
      await settle();

      assertEquals(view.get().activeConversation?.id, "active");
      assertEquals(view.get().activeConversationId, "active");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("preserves an explicitly empty agent id through creation, summaries, and draft reuse", async () => {
    const fresh = createEmptyConversation({ agentId: "", id: "empty", now: 1 });
    assertEquals("agentId" in fresh, true);
    assertEquals(fresh.agentId, "");
    const summary = conversationSummary(fresh);
    assertEquals("agentId" in summary, true);
    assertEquals(summary.agentId, "");

    const restoreDom = installDom();
    const store = memoryConversationStore([fresh]);
    try {
      const view = mount(store);
      await settle();

      let reused: Conversation | undefined;
      flushSync(() => {
        reused = view.get().create("");
      });
      assertEquals(reused?.id, "empty");
      assertEquals("agentId" in reused!, true);
      assertEquals(reused?.agentId, "");
      assertEquals(view.get().conversations.map((item) => item.id), ["empty"]);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not reuse an empty draft assigned to another agent", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({
        id: "agent-a-draft",
        title: DEFAULT_CONVERSATION_TITLE,
        agentId: "agent-a",
        updatedAt: 10,
      }),
    ]);
    try {
      const view = mount(store);
      await settle();

      let created: Conversation | undefined;
      flushSync(() => {
        created = view.get().create("agent-b");
      });
      await settle();

      assert(created);
      assert(created.id !== "agent-a-draft");
      assertEquals(created.agentId, "agent-b");
      assertEquals(
        view.get().conversations.map((item) => item.id).sort(),
        ["agent-a-draft", created.id].sort(),
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

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

      await unmountReactRoot(view.root);
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
      await unmountReactRoot(view.root);
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
      await unmountReactRoot(view.root);
      await settle();
      await settle();
      assertEquals((await store.load("seed"))?.title, "Renamed");
    } finally {
      restoreDom();
    }
  });

  it("snapshots a save command before the caller can mutate it", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([conversation()]);
    try {
      const view = mount(store);
      await settle();

      const command = conversation({
        title: "Command snapshot",
        messages: [userMsg("original")],
        updatedAt: 9,
      });
      view.get().save(command);
      command.title = "Mutated later";
      command.messages.push(userMsg("late mutation"));

      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      const persisted = await store.load("seed");
      assertEquals(persisted?.title, "Command snapshot");
      assertEquals(persisted?.messages.length, 1);
      assertEquals(view.get().conversations[0]?.title, "Command snapshot");
      assertEquals(view.get().conversations[0]?.messageCount, 1);
      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("adopts an authoritative list that normalizes a successful save", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) =>
        base.save({
          ...value,
          title: `${value.title} (server)`,
          updatedAt: value.updatedAt + 100,
        }),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({ title: "Client title", updatedAt: 9 }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      assertEquals(view.get().conversations[0]?.title, "Client title (server)");
      assertEquals(view.get().conversations[0]?.updatedAt, 109);
      assertEquals(view.get().activeConversation?.title, "Client title (server)");
      await unmountReactRoot(view.root);
      await settle();
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
      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps a conversation visible when its delete is rejected", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    const failure = new Error("delete unavailable");
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: () => Promise.reject(failure),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().remove("seed");
      await settle();

      assertEquals(view.get().conversations.map((item) => item.id), ["seed"]);
      assertEquals(view.get().activeConversationId, "seed");
      assert(persistenceError(view.get()) instanceof ConversationStoreError);
      assertEquals(persistenceError(view.get())?.operation, "delete");
      assertEquals(persistenceError(view.get())?.cause, failure);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("confirms deletion only after an in-flight save finishes", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ updatedAt: 2 }),
      conversation({ id: "other", title: "Other", updatedAt: 1 }),
    ]);
    const events: string[] = [];
    let finishSave: (() => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => {
        events.push("save");
        return new Promise((resolve) => {
          finishSave = () => {
            void base.save(value).then(resolve);
          };
        });
      },
      delete: async (id) => {
        events.push("delete");
        await base.delete(id);
      },
    };
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({ title: "Latest", updatedAt: 2 }));
      view.get().remove("seed");
      await settle();

      assertEquals(events, ["save"]);
      assert(
        view.get().conversations.some((item) => item.id === "seed"),
        "the row stays visible until deletion is confirmed",
      );
      assert(finishSave);
      finishSave();
      await settle();

      assertEquals(events, ["save", "delete"]);
      assertEquals(await base.load("seed"), null);
      assertEquals(
        view.get().conversations.some((item) => item.id === "seed"),
        false,
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("exposes a debounced save rejection without losing the in-memory edit", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    const cause = new Error("save unavailable");
    const failure = new ConversationStoreError("save", cause);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: () => Promise.reject(failure),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({ title: "Unsaved edit", updatedAt: 2 }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      assertEquals(view.get().conversations[0]?.title, "Unsaved edit");
      assert(persistenceError(view.get()) instanceof ConversationStoreError);
      assertEquals(persistenceError(view.get())?.operation, "save");
      assertEquals(persistenceError(view.get()), failure);
      assertEquals(persistenceError(view.get())?.cause, cause);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("retains a failed full-conversation save across navigation", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ messages: [userMsg("persisted")], updatedAt: 2 }),
      conversation({ id: "other", title: "Other", updatedAt: 1 }),
    ]);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) =>
        value.id === "seed" ? Promise.reject(new Error("save unavailable")) : base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({
        title: "Unsaved edit",
        messages: [userMsg("unsaved")],
        updatedAt: 3,
      }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      flushSync(() => view.get().select("other"));
      await settle();
      assertEquals(view.get().activeConversation?.id, "other");

      flushSync(() => view.get().select("seed"));
      await settle();

      assertEquals(view.get().activeConversation?.title, "Unsaved edit");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "unsaved",
      );
      assertEquals(
        (await base.load("seed"))?.messages[0]?.parts[0],
        { type: "text", text: "persisted" },
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not let a stale active load overwrite a retained failed save", async () => {
    const restoreDom = installDom();
    const persisted = conversation({
      title: "Persisted",
      messages: [userMsg("persisted")],
      updatedAt: 2,
    });
    const base = memoryConversationStore([persisted]);
    let seedLoads = 0;
    let resolveSeedLoad: ((value: Conversation | null) => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id !== "seed" || ++seedLoads > 1) return base.load(id);
        return new Promise((resolve) => {
          resolveSeedLoad = resolve;
        });
      },
      save: () => Promise.reject(new Error("save unavailable")),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();
      assert(resolveSeedLoad);

      view.get().save(conversation({
        title: "Unsaved",
        messages: [userMsg("unsaved")],
        updatedAt: 3,
      }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();
      assertEquals(view.get().activeConversation?.title, "Unsaved");
      assertEquals(view.get().error?.operation, "save");

      resolveSeedLoad(persisted);
      await settle();

      assertEquals(view.get().activeConversation?.title, "Unsaved");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "unsaved",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("patches a retained failed full record without reloading stale storage", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({
        id: "seed",
        title: "Seed",
        messages: [userMsg("persisted")],
        updatedAt: 20,
      }),
      conversation({ id: "other", title: "Other", updatedAt: 10 }),
    ]);
    let rejectSeedLoads = false;
    let rejectedSeedLoads = 0;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id === "seed" && rejectSeedLoads) {
          rejectedSeedLoads += 1;
          return Promise.reject(new Error("seed reload unavailable"));
        }
        return base.load(id);
      },
      save: (value) =>
        value.id === "seed" ? Promise.reject(new Error("seed save unavailable")) : base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().save(conversation({
        id: "seed",
        title: "Unsaved seed",
        messages: [userMsg("retained full message")],
        updatedAt: 30,
      }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();
      assertEquals(view.get().error?.operation, "save");

      flushSync(() => view.get().select("other"));
      await settle();
      rejectSeedLoads = true;

      view.get().rename("seed", "Renamed retained seed");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();
      assertEquals(rejectedSeedLoads, 0, "the retained full aggregate must avoid store.load");

      flushSync(() => view.get().select("seed"));
      await settle();
      assertEquals(view.get().activeConversation?.title, "Renamed retained seed");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "retained full message",
      );
      assertEquals(
        (await base.load("seed"))?.messages[0]?.parts[0],
        { type: "text", text: "persisted" },
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("consumes a flushed save rejection after unmount", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    let rejectSave: ((reason: unknown) => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();
      view.get().save(conversation({ title: "Pending", updatedAt: 2 }));
      await unmountReactRoot(view.root);
      await settle();
      assert(rejectSave);
      rejectSave(new Error("late save failure"));
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("replaces a removed sole draft instead of reselecting its deleted id", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({
        id: "draft",
        title: "New Chat",
        messages: [],
        updatedAt: 2,
      }),
    ]);
    try {
      const view = mount(store);
      await settle();
      assertEquals(view.get().activeConversationId, "draft");

      flushSync(() => view.get().remove("draft"));
      await settle();

      const replacementId = view.get().activeConversationId;
      assert(replacementId);
      assert(replacementId !== "draft");
      assertEquals(view.get().conversations.map((item) => item.id), [replacementId]);
      assertEquals(view.get().activeConversation?.id, replacementId);
      assertEquals(await store.load("draft"), null);
      assert(await store.load(replacementId));

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("serializes a pre-delete non-active edit and keeps deletion final", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let resolveTargetLoad: ((value: Conversation | null) => void) | undefined;
    const savedIds: string[] = [];
    const deletedIds: string[] = [];
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id !== "target") return base.load(id);
        return new Promise((resolve) => {
          resolveTargetLoad = resolve;
        });
      },
      save: async (value) => {
        savedIds.push(value.id);
        await base.save(value);
      },
      delete: async (id) => {
        deletedIds.push(id);
        await base.delete(id);
      },
    };

    try {
      const view = mount(store);
      await settle();
      assertEquals(view.get().activeConversationId, "active");

      view.get().rename("target", "Late rename");
      await Promise.resolve();
      assert(resolveTargetLoad);
      view.get().remove("target");
      resolveTargetLoad(conversation({ id: "target", title: "Target", updatedAt: 10 }));
      await settle();

      assertEquals(deletedIds, ["target"]);
      assertEquals(savedIds.includes("target"), true);
      assertEquals(view.get().conversations.map((item) => item.id), ["active"]);
      assertEquals(await base.load("target"), null);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps same-count message content when a rename lands before the debounce", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation({ messages: [userMsg("partial")], updatedAt: 1 }),
    ]);
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().save(conversation({
          messages: [userMsg("complete")],
          agentId: "agent-latest",
          updatedAt: 2,
        }));
        view.get().rename("seed", "Renamed");
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      const persisted = await store.load("seed");
      assertEquals(
        (persisted?.messages[0]?.parts[0] as { text: string }).text,
        "complete",
      );
      assertEquals(persisted?.title, "Renamed");
      assertEquals(persisted?.agentId, "agent-latest");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "complete",
      );
      assertEquals(view.get().conversations[0]?.agentId, "agent-latest");
      assertEquals(view.get().conversations[0]?.updatedAt, persisted?.updatedAt);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("serializes complete non-active load-patch-save transactions", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let targetLoads = 0;
    let resolveFirstLoad: ((value: Conversation | null) => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id !== "target") return base.load(id);
        targetLoads += 1;
        if (targetLoads === 1) {
          return new Promise((resolve) => {
            resolveFirstLoad = resolve;
          });
        }
        return base.load(id);
      },
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().rename("target", "Renamed");
        view.get().update("target", { agentId: "agent-2" });
      });
      await Promise.resolve();
      assert(resolveFirstLoad);
      assertEquals(targetLoads, 1, "the second load must wait for the first transaction");

      resolveFirstLoad(conversation({ id: "target", title: "Target", updatedAt: 10 }));
      await settle();

      const persisted = await base.load("target");
      assertEquals(targetLoads, 2);
      assertEquals(persisted?.title, "Renamed");
      assertEquals(persisted?.agentId, "agent-2");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("preserves a normalized load failure from a non-active update", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    const cause = new Error("target load unavailable");
    const failure = new ConversationStoreError("load", cause);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => id === "target" ? Promise.reject(failure) : base.load(id),
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().rename("target", "Optimistic rename");
      await settle();

      assertEquals(view.get().error, failure);
      assertEquals(view.get().error?.operation, "load");
      assertEquals(view.get().error?.cause, cause);
      assertEquals(
        view.get().conversations.find((item) => item.id === "target")?.title,
        "Target",
        "a failed load must roll back metadata that was never applied",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("rolls consecutive failed non-active updates back to one stable baseline", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let targetLoads = 0;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id !== "target") return base.load(id);
        targetLoads += 1;
        return Promise.reject(new Error(`target load ${targetLoads} unavailable`));
      },
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().rename("target", "First optimistic title");
        view.get().rename("target", "Second optimistic title");
      });
      await settle();

      assertEquals(targetLoads, 2);
      assertEquals(
        view.get().conversations.find((item) => item.id === "target")?.title,
        "Target",
        "every failed revision must roll back to the pre-queue summary",
      );
      assertEquals((await base.load("target"))?.title, "Target");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("advances the rollback baseline after an earlier queued update persists", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let targetLoads = 0;
    let listCalls = 0;
    const store: ConversationStore = {
      list: () => {
        listCalls += 1;
        return listCalls === 1 ? base.list() : new Promise<ConversationSummary[]>(() => undefined);
      },
      load: (id) => {
        if (id !== "target") return base.load(id);
        targetLoads += 1;
        return targetLoads === 1
          ? base.load(id)
          : Promise.reject(new Error("second target load unavailable"));
      },
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      flushSync(() => {
        view.get().rename("target", "First persisted title");
        view.get().rename("target", "Second optimistic title");
      });
      await settle();

      assertEquals(targetLoads, 2);
      assertEquals(listCalls, 2, "the post-mutation refresh is intentionally held");
      assertEquals((await base.load("target"))?.title, "First persisted title");
      assertEquals(
        view.get().conversations.find((item) => item.id === "target")?.title,
        "First persisted title",
        "a later failure must retain the newest successfully persisted revision",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("retains a failed non-active update as a full selectable conversation", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({
        id: "target",
        title: "Target",
        messages: [userMsg("persisted")],
        updatedAt: 10,
      }),
    ]);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) =>
        value.id === "target"
          ? Promise.reject(new Error("target save unavailable"))
          : base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().update("target", {
        title: "Unsaved target",
        messages: [userMsg("unsaved")],
      });
      await settle();
      assertEquals(view.get().error?.operation, "save");

      flushSync(() => view.get().select("target"));
      await settle();

      assertEquals(view.get().activeConversation?.title, "Unsaved target");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "unsaved",
      );
      assertEquals((await base.load("target"))?.title, "Target");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("resumes a deferred active load from the retained full record after save failure", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let resolveTargetLoad: ((value: Conversation | null) => void) | undefined;
    let rejectTargetSave: ((reason: unknown) => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => {
        if (id !== "target") return base.load(id);
        return new Promise((resolve) => {
          resolveTargetLoad = resolve;
        });
      },
      save: (value) => {
        if (value.id !== "target") return base.save(value);
        return new Promise((_resolve, reject) => {
          rejectTargetSave = reject;
        });
      },
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().update("target", {
        title: "Unsaved target",
        messages: [userMsg("retained")],
      });
      await Promise.resolve();
      assert(resolveTargetLoad);

      flushSync(() => view.get().select("target"));
      await settle();
      assertEquals(view.get().activeConversationId, "target");
      assertEquals(view.get().activeConversation, null);

      resolveTargetLoad(conversation({ id: "target", title: "Target", updatedAt: 10 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(rejectTargetSave);
      rejectTargetSave(new Error("target save unavailable"));
      await settle();

      assertEquals(view.get().error?.operation, "save");
      assertEquals(view.get().activeConversation?.id, "target");
      assertEquals(view.get().activeConversation?.title, "Unsaved target");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "retained",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("resumes a deferred retained conversation when the list refresh fails", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    let listCalls = 0;
    let resolveTargetLoad: ((value: Conversation | null) => void) | undefined;
    const store: ConversationStore = {
      list: () => {
        listCalls += 1;
        return listCalls === 1
          ? base.list()
          : Promise.reject(new Error("list refresh unavailable"));
      },
      load: (id) => {
        if (id !== "target") return base.load(id);
        return new Promise((resolve) => {
          resolveTargetLoad = resolve;
        });
      },
      save: (value) =>
        value.id === "target"
          ? Promise.reject(new Error("target save unavailable"))
          : base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().update("target", {
        title: "Unsaved target",
        messages: [userMsg("retained")],
      });
      await Promise.resolve();
      assert(resolveTargetLoad);

      flushSync(() => view.get().select("target"));
      await settle();
      assertEquals(view.get().activeConversationId, "target");
      assertEquals(view.get().activeConversation, null);

      resolveTargetLoad(conversation({ id: "target", title: "Target", updatedAt: 10 }));
      await settle();

      assertEquals(listCalls, 2);
      assertEquals(view.get().error?.operation, "list");
      assertEquals(view.get().activeConversation?.id, "target");
      assertEquals(view.get().activeConversation?.title, "Unsaved target");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "retained",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("classifies a missing non-active update target as a load failure", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "target", title: "Target", updatedAt: 10 }),
    ]);
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
    };
    try {
      const view = mount(store);
      await settle();
      await base.delete("target");

      view.get().rename("target", "Cannot persist");
      await settle();

      assert(view.get().error instanceof ConversationStoreError);
      assertEquals(view.get().error?.operation, "load");
      assertEquals((view.get().error?.cause as Error)?.name, "ConversationNotFoundError");
      assertEquals(view.get().conversations.some((item) => item.id === "target"), false);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("prevents a late chat save from resurrecting a successful deletion", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "seed", title: "Seed", updatedAt: 20 }),
      conversation({ id: "other", title: "Other", updatedAt: 10 }),
    ]);
    let resolveDelete: (() => void) | undefined;
    const saves: Conversation[] = [];
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: async (value) => {
        saves.push(value);
        await base.save(value);
      },
      delete: (id) =>
        new Promise((resolve) => {
          resolveDelete = () => {
            void base.delete(id).then(resolve);
          };
        }),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().remove("seed");
      await Promise.resolve();
      assert(resolveDelete);
      view.get().save(conversation({
        id: "seed",
        title: "Late stream update",
        messages: [userMsg("late")],
        updatedAt: 30,
      }));
      resolveDelete();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      assertEquals(saves, []);
      assertEquals(await base.load("seed"), null);
      assertEquals(view.get().conversations.map((item) => item.id), ["other"]);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("requires an explicit same-id recreation after delete confirmation cannot refresh", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "seed", title: "Seed", updatedAt: 20 }),
      conversation({ id: "other", title: "Other", updatedAt: 10 }),
    ]);
    let rejectLists = false;
    const store: ConversationStore = {
      list: () => rejectLists ? Promise.reject(new Error("list offline")) : base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: async (id) => {
        await base.delete(id);
        rejectLists = true;
      },
    };
    try {
      const view = mount(store);
      await settle();

      view.get().remove("seed");
      await settle();
      assertEquals(await base.load("seed"), null);
      assertEquals(view.get().error?.operation, "list");

      const recreated = conversation({
        id: "seed",
        title: "Explicit recreation",
        updatedAt: 30,
      });
      view.get().save(recreated);
      await new Promise((resolve) => setTimeout(resolve, 350));
      assertEquals(await base.load("seed"), null, "ordinary late saves stay tombstoned");

      view.get().save(recreated, { recreateDeleted: true });
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();
      assertEquals((await base.load("seed"))?.title, "Explicit recreation");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("replays buffered chat state when deletion is rejected", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    let rejectDelete: ((reason: unknown) => void) | undefined;
    const failure = new Error("delete rejected");
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: () =>
        new Promise((_resolve, reject) => {
          rejectDelete = reject;
        }),
    };
    try {
      const view = mount(store);
      await settle();

      view.get().remove("seed");
      await Promise.resolve();
      assert(rejectDelete);
      view.get().save(conversation({
        title: "Buffered update",
        messages: [userMsg("buffered")],
        updatedAt: 3,
      }));
      rejectDelete(failure);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      const persisted = await base.load("seed");
      assertEquals(persisted?.title, "Buffered update");
      assertEquals(
        (persisted?.messages[0]?.parts[0] as { text: string }).text,
        "buffered",
      );
      assert(persistenceError(view.get()) instanceof ConversationStoreError);
      assertEquals(persistenceError(view.get())?.operation, "delete");
      assertEquals(persistenceError(view.get())?.cause, failure);
      assertEquals(view.get().conversations.map((item) => item.id), ["seed"]);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not block a same-id replacement-store write on a hung old scope", async () => {
    const restoreDom = installDom();
    const oldBase = memoryConversationStore([conversation()]);
    const newBase = memoryConversationStore([conversation()]);
    let oldSaveStarted = false;
    let newSaveCalls = 0;
    const oldStore: ConversationStore = {
      list: () => oldBase.list(),
      load: (id) => oldBase.load(id),
      save: () => {
        oldSaveStarted = true;
        return new Promise<void>(() => undefined);
      },
      delete: (id) => oldBase.delete(id),
    };
    const newStore: ConversationStore = {
      list: () => newBase.list(),
      load: (id) => newBase.load(id),
      save: async (value) => {
        newSaveCalls += 1;
        await newBase.save(value);
      },
      delete: (id) => newBase.delete(id),
    };
    try {
      const view = mountOptions({ store: oldStore });
      await settle();
      view.get().save(conversation({ title: "Version one", updatedAt: 2 }));
      view.render({ store: newStore });
      await settle();
      assertEquals(oldSaveStarted, true, "store handoff must flush the old pending save");

      view.get().save(conversation({ title: "Version two", updatedAt: 3 }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();
      assertEquals(newSaveCalls, 1);
      assertEquals((await newBase.load("seed"))?.title, "Version two");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("detaches retired mutation tails from replacement-scope refreshes", async () => {
    const restoreDom = installDom();
    const baseA = memoryConversationStore([conversation()]);
    const baseB = memoryConversationStore([conversation()]);
    let finishOldSave: (() => void) | undefined;
    let storeBListCalls = 0;
    const storeA: ConversationStore = {
      list: () => baseA.list(),
      load: (id) => baseA.load(id),
      save: (value) =>
        new Promise((resolve) => {
          finishOldSave = () => {
            void baseA.save(value).then(resolve);
          };
        }),
      delete: (id) => baseA.delete(id),
    };
    const storeB: ConversationStore = {
      list: () => {
        storeBListCalls += 1;
        return baseB.list();
      },
      load: (id) => baseB.load(id),
      save: (value) => baseB.save(value),
      delete: (id) => baseB.delete(id),
    };
    try {
      const view = mountOptions({ store: storeA });
      await settle();
      view.get().save(conversation({ title: "Retired write", updatedAt: 2 }));

      view.render({ store: storeB });
      await settle();
      assert(finishOldSave);
      assertEquals(storeBListCalls, 1);

      finishOldSave();
      await settle();
      assertEquals(
        storeBListCalls,
        1,
        "a retired scope completion must not schedule work in its replacement",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("accepts replacement-scope commands from a descendant layout effect", async () => {
    const restoreDom = installDom();
    // This distinct module instance is intentionally initialized after the DOM
    // exists so its isomorphic effect uses the real browser layout phase.
    const { useConversations: useBrowserLayoutConversations } = await import(
      "./use-conversations.ts?browser-layout-regression"
    );
    const baseA = memoryConversationStore([
      conversation({ id: "seed", title: "Store A", updatedAt: 10 }),
    ]);
    const baseB = memoryConversationStore([
      conversation({ id: "seed", title: "Store B", updatedAt: 20 }),
    ]);
    let storeBSaveCalls = 0;
    const storeB: ConversationStore = {
      list: () => baseB.list(),
      load: (id) => baseB.load(id),
      save: async (value) => {
        storeBSaveCalls += 1;
        await baseB.save(value);
      },
      delete: (id) => baseB.delete(id),
    };
    let options: UseConversationsOptions = { store: baseA };
    let phase: "a" | "b" = "a";
    let latest: ConversationsHookResult | null = null;
    function LayoutCommand(
      { result, currentPhase }: {
        result: ConversationsHookResult;
        currentPhase: "a" | "b";
      },
    ): null {
      React.useLayoutEffect(() => {
        if (currentPhase !== "b") return;
        result.save(conversation({
          id: "seed",
          title: "Saved from child layout",
          updatedAt: 30,
        }));
      }, [currentPhase, result.save]);
      return null;
    }
    function Capture(): React.ReactElement {
      const result = useBrowserLayoutConversations(options);
      latest = result;
      return <LayoutCommand result={result} currentPhase={phase} />;
    }
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await settle();

      options = { store: storeB };
      phase = "b";
      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      assertEquals(storeBSaveCalls, 1);
      assertEquals((await baseB.load("seed"))?.title, "Saved from child layout");
      assertEquals(
        (latest as unknown as ConversationsHookResult).conversations[0]?.title,
        "Saved from child layout",
      );

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("initializes a replacement store when layout effects use the passive fallback", async () => {
    const restoreDom = installDom();
    const storeA = memoryConversationStore([
      conversation({ id: "a", title: "Store A", updatedAt: 10 }),
    ]);
    const baseB = memoryConversationStore([
      conversation({ id: "b", title: "Store B", updatedAt: 20 }),
    ]);
    let listBCalls = 0;
    const storeB: ConversationStore = {
      list: () => {
        listBCalls += 1;
        return baseB.list();
      },
      load: (id) => baseB.load(id),
      save: (value) => baseB.save(value),
      delete: (id) => baseB.delete(id),
    };
    try {
      const view = mountOptions({ store: storeA });
      await settle();
      assertEquals(view.get().conversations.map((item) => item.id), ["a"]);

      view.render({ store: storeB });
      await settle();

      assertEquals(listBCalls, 1);
      assertEquals(view.get().isLoading, false);
      assertEquals(view.get().conversations.map((item) => item.id), ["b"]);
      assertEquals(view.get().activeConversationId, "b");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not block a replacement store on an unrelated hung old write", async () => {
    const restoreDom = installDom();
    const baseA = memoryConversationStore([
      conversation({ id: "a", title: "Store A", updatedAt: 10 }),
    ]);
    let oldSaveStarted = false;
    const storeA: ConversationStore = {
      list: () => baseA.list(),
      load: (id) => baseA.load(id),
      save: () => {
        oldSaveStarted = true;
        return new Promise<void>(() => undefined);
      },
      delete: (id) => baseA.delete(id),
    };
    const baseB = memoryConversationStore([
      conversation({ id: "b", title: "Store B", updatedAt: 20 }),
    ]);
    let listBCalls = 0;
    const storeB: ConversationStore = {
      list: () => {
        listBCalls += 1;
        return baseB.list();
      },
      load: (id) => baseB.load(id),
      save: (value) => baseB.save(value),
      delete: (id) => baseB.delete(id),
    };
    try {
      const view = mountOptions({ store: storeA });
      await settle();
      view.get().save(conversation({
        id: "a",
        title: "Never settles",
        updatedAt: 30,
      }));

      view.render({ store: storeB });
      await settle();

      assertEquals(oldSaveStarted, true);
      assertEquals(listBCalls, 1);
      assertEquals(view.get().isLoading, false);
      assertEquals(view.get().conversations.map((item) => item.id), ["b"]);
      assertEquals(view.get().activeConversationId, "b");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("makes callbacks retained across store handoff and unmount inert", async () => {
    const restoreDom = installDom();
    const baseA = memoryConversationStore([conversation()]);
    const baseB = memoryConversationStore([conversation()]);
    const callsA: string[] = [];
    const callsB: string[] = [];
    const trackedStore = (
      base: ConversationStore,
      calls: string[],
    ): ConversationStore => ({
      list: () => base.list(),
      load: (id) => {
        calls.push(`load:${id}`);
        return base.load(id);
      },
      save: (value) => {
        calls.push(`save:${value.id}`);
        return base.save(value);
      },
      delete: (id) => {
        calls.push(`delete:${id}`);
        return base.delete(id);
      },
    });
    try {
      const storeA = trackedStore(baseA, callsA);
      const storeB = trackedStore(baseB, callsB);
      const view = mountOptions({ store: storeA });
      await settle();
      const retainedA = view.get();
      view.render({ store: storeB });
      await settle();
      const afterSwitchA = [...callsA];
      const afterSwitchB = [...callsB];

      retainedA.save(conversation({ title: "Stale" }));
      retainedA.update("seed", { title: "Stale" });
      retainedA.rename("seed", "Stale");
      retainedA.bind("seed", { messages: [userMsg("stale")] });
      retainedA.remove("seed");
      retainedA.select("seed");
      retainedA.clearError();
      const staleError = assertThrows(
        () => retainedA.create(),
        Error,
        "inactive hook scope",
        "a retained create() from a handed-off scope is rejected",
      );
      assertEquals(
        (staleError as Error).name,
        "ConversationHookScopeError",
        "the stale create() rejection keeps its scope-error identity",
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assertEquals(callsA, afterSwitchA);
      assertEquals(callsB, afterSwitchB);

      const retainedB = view.get();
      await unmountReactRoot(view.root);
      retainedB.save(conversation({ title: "After unmount" }));
      retainedB.remove("seed");
      const unmountedError = assertThrows(
        () => retainedB.create(),
        Error,
        "inactive hook scope",
        "a retained create() from an unmounted scope is rejected",
      );
      assertEquals(
        (unmountedError as Error).name,
        "ConversationHookScopeError",
        "the post-unmount create() rejection keeps its scope-error identity",
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assertEquals(callsB, afterSwitchB);
    } finally {
      restoreDom();
    }
  });

  it("unsubscribes each scope but leaves injected store disposal to its owner", async () => {
    const restoreDom = installDom();
    const baseA = memoryConversationStore([
      conversation({ id: "a", title: "A" }),
    ]);
    const baseB = memoryConversationStore([
      conversation({ id: "b", title: "B" }),
    ]);
    let unsubscribesA = 0;
    let unsubscribesB = 0;
    let disposalsA = 0;
    let disposalsB = 0;
    const wrap = (
      base: ConversationStore,
      onUnsubscribe: () => void,
      onDispose: () => void,
    ): ConversationStore => ({
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
      subscribe: () => onUnsubscribe,
      dispose: onDispose,
    });
    const storeA = wrap(
      baseA,
      () => {
        unsubscribesA += 1;
      },
      () => {
        disposalsA += 1;
      },
    );
    const storeB = wrap(
      baseB,
      () => {
        unsubscribesB += 1;
      },
      () => {
        disposalsB += 1;
      },
    );

    try {
      const view = mountOptions({ store: storeA });
      await settle();

      view.render({ store: storeB });
      await settle();
      assertEquals(unsubscribesA, 1);
      assertEquals(unsubscribesB, 0);
      assertEquals(disposalsA, 0);
      assertEquals(disposalsB, 0);

      await unmountReactRoot(view.root);
      await settle();
      assertEquals(unsubscribesA, 1);
      assertEquals(unsubscribesB, 1);
      assertEquals(disposalsA, 0);
      assertEquals(disposalsB, 0);
    } finally {
      restoreDom();
    }
  });

  it("reconciles subscribed active deletion and active content updates", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "other", title: "Other", updatedAt: 10 }),
    ]);
    let notify: (() => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) => base.save(value),
      delete: (id) => base.delete(id),
      subscribe: (onChange) => {
        notify = () => onChange([]);
        return () => {};
      },
    };
    try {
      const view = mount(store);
      await settle();
      assertEquals(view.get().activeConversationId, "active");
      assert(notify);

      await base.delete("active");
      notify();
      await settle();
      assertEquals(view.get().conversations.map((item) => item.id), ["other"]);
      assertEquals(view.get().activeConversationId, "other");
      assertEquals(view.get().activeConversation?.id, "other");

      await base.save(conversation({
        id: "other",
        title: "Updated elsewhere",
        messages: [userMsg("remote")],
        updatedAt: 30,
      }));
      notify();
      await settle();
      assertEquals(view.get().activeConversation?.title, "Updated elsewhere");
      assertEquals(
        (view.get().activeConversation?.messages[0]?.parts[0] as { text: string }).text,
        "remote",
      );

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not let a stale subscribed list roll back an optimistic save", async () => {
    const restoreDom = installDom();
    const base = memoryConversationStore([conversation()]);
    let notify: (() => void) | undefined;
    let releaseSave: (() => void) | undefined;
    const store: ConversationStore = {
      list: () => base.list(),
      load: (id) => base.load(id),
      save: (value) =>
        new Promise((resolve) => {
          releaseSave = () => {
            void base.save(value).then(resolve);
          };
        }),
      delete: (id) => base.delete(id),
      subscribe: (onChange) => {
        notify = () => onChange([]);
        return () => {};
      },
    };
    try {
      const view = mount(store);
      await settle();
      assert(notify);

      view.get().save(conversation({ title: "Optimistic", updatedAt: 2 }));
      notify();
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert(releaseSave);
      assertEquals(view.get().conversations[0]?.title, "Optimistic");

      releaseSave();
      await settle();
      assertEquals(view.get().conversations[0]?.title, "Optimistic");
      assertEquals((await base.load("seed"))?.title, "Optimistic");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("does not relabel a throwing selection callback as a store failure", async () => {
    const restoreDom = installDom();
    const previousReportError =
      (globalThis as { reportError?: (error: unknown) => void }).reportError;
    const continuationErrors: unknown[] = [];
    (globalThis as { reportError?: (error: unknown) => void }).reportError = (cause) => {
      continuationErrors.push(cause);
    };
    const base = memoryConversationStore([
      conversation({ id: "active", title: "Active", updatedAt: 20 }),
      conversation({ id: "other", title: "Other", updatedAt: 10 }),
    ]);
    const reportedStoreErrors: ConversationStoreError[] = [];
    try {
      const view = mountOptions({
        store: base,
        id: "active",
        onSelect: () => {
          throw new Error("router failed");
        },
        onError: (nextError) => reportedStoreErrors.push(nextError),
      });
      await settle();

      view.get().remove("active");
      await settle();

      assertEquals(await base.load("active"), null);
      assertEquals(reportedStoreErrors, []);
      assertEquals(view.get().error, null);
      assertEquals((continuationErrors[0] as Error)?.message, "router failed");

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      if (previousReportError) {
        (globalThis as { reportError?: (error: unknown) => void }).reportError =
          previousReportError;
      } else {
        delete (globalThis as { reportError?: (error: unknown) => void }).reportError;
      }
      restoreDom();
    }
  });

  it("an abandoned concurrent render cannot replace committed error ownership", async () => {
    const restoreDom = installDom();
    let rejectList: ((reason: unknown) => void) | undefined;
    const store: ConversationStore = {
      list: () =>
        new Promise((_resolve, reject) => {
          rejectList = reject;
        }),
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const committedErrors: Error[] = [];
    const abandonedErrors: Error[] = [];
    let committed: ConversationsHookResult | null = null;
    let attemptedSuspendedRender = false;
    const never = new Promise<void>(() => undefined);
    const Capture = (
      { abandoned = false }: { abandoned?: boolean },
    ): null => {
      const result = useConversations({
        store,
        onError: abandoned
          ? (nextError) => abandonedErrors.push(nextError)
          : (nextError) => committedErrors.push(nextError),
      });
      React.useLayoutEffect(() => {
        committed = result;
      });
      if (abandoned) {
        attemptedSuspendedRender = true;
        throw never;
      }
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <React.Suspense fallback={null}>
            <Capture />
          </React.Suspense>,
        )
      );
      await Promise.resolve();
      assert(rejectList);

      React.startTransition(() => {
        root.render(
          <React.Suspense fallback={null}>
            <Capture abandoned />
          </React.Suspense>,
        );
      });
      await waitFor(() => attemptedSuspendedRender, {
        interval: 1,
        message: "Concurrent conversations render did not start",
      });
      assertEquals(attemptedSuspendedRender, true);

      const failure = new Error("committed list failed");
      rejectList(failure);
      await settle();
      assertEquals(committedErrors.length, 1);
      assertEquals(committedErrors[0]?.cause, failure);
      assertEquals(abandonedErrors, []);
      assertEquals((committed as unknown as ConversationsHookResult).error?.cause, failure);

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });
});
