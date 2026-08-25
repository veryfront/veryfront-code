/**
 * useConversation — the singular loader. Proves it fetches one full
 * conversation by id from the store and reports a missing id as `null`.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useConversation,
  type UseConversationPersistenceState,
  type UseConversationResult,
} from "./use-conversation.ts";
import {
  type ConversationsContextValue,
  ConversationsProvider,
  useConversationsContext,
} from "../contexts/conversations-context.tsx";
import { ConversationStoreError } from "../persistence/conversation-store.ts";
import { localConversationStore } from "../persistence/local-conversation-store.ts";
import { memoryConversationStore } from "../persistence/memory-conversation-store.ts";
import type {
  Conversation,
  ConversationStore,
  ConversationSummary,
} from "../persistence/conversation-store.ts";

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

function mount(
  store: ConversationStore,
  initialId: string | null,
  onError?: (error: Error) => void,
) {
  let latest: (UseConversationResult & UseConversationPersistenceState) | null = null;
  let id = initialId;
  let currentStore = store;
  const Capture = (): null => {
    latest = useConversation(id, { store: currentStore, onError });
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    root,
    get: () => latest!,
    render(nextId: string | null, nextStore: ConversationStore = currentStore): void {
      id = nextId;
      currentStore = nextStore;
      flushSync(() => root.render(<Capture />));
    },
  };
}

function persistenceError(
  result: UseConversationResult & UseConversationPersistenceState,
): Error | null {
  return result.error;
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
      await unmountReactRoot(view.root);
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
      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("never touches the store for a nullish id", async () => {
    const restoreDom = installDom();
    let loads = 0;
    const store: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => {
        loads++;
        return Promise.resolve(null);
      },
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, null);
      await settle();
      assertEquals(loads, 0, "a nullish id never hits the store");
      assertEquals(view.get().conversation, null, "nullish id resolves to null");
      assertEquals(view.get().isLoading, false, "nullish id is not loading");
      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps a provider-owned active id isolated from default local storage while loading", async () => {
    const restoreDom = installDom();
    const storageKey = "provider-owned-active-id";
    const providerRecord = conversation("shared-id", "Provider record");
    const providerSummary: ConversationSummary = {
      id: providerRecord.id,
      title: providerRecord.title,
      messageCount: providerRecord.messages.length,
      createdAt: providerRecord.createdAt,
      updatedAt: providerRecord.updatedAt,
    };
    let resolveProviderLoad: ((value: Conversation | null) => void) | undefined;
    const providerStore: ConversationStore = {
      list: () => Promise.resolve([providerSummary]),
      load: () =>
        new Promise((resolve) => {
          resolveProviderLoad = resolve;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => unknown,
        ) => await callback(),
      },
    });
    await localConversationStore(storageKey).save(
      conversation("shared-id", "Conflicting local record"),
    );

    let latest: (UseConversationResult & UseConversationPersistenceState) | null = null;
    const Capture = (): null => {
      latest = useConversation("shared-id", { storageKey });
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ConversationsProvider store={providerStore} id="shared-id">
            <Capture />
          </ConversationsProvider>,
        )
      );
      await settle();

      assert(resolveProviderLoad, "the provider should own the active load");
      assertEquals(
        latest!.conversation,
        null,
        "a pending provider record must not fall through to default local storage",
      );
      assertEquals(
        latest!.isLoading,
        true,
        "the provider-owned record is still loading after the provider list settles",
      );

      resolveProviderLoad(providerRecord);
      await settle();
      assertEquals(latest!.conversation?.title, "Provider record");
      assertEquals(latest!.isLoading, false);
    } finally {
      await unmountReactRoot(root);
      await settle();
      restoreDom();
    }
  });

  it("reloads the provider-owned active record instead of an unrelated local store", async () => {
    const restoreDom = installDom();
    const first = conversation("shared-id", "First provider record");
    const second = conversation("shared-id", "Reloaded provider record");
    const summary: ConversationSummary = {
      id: first.id,
      title: first.title,
      messageCount: 0,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
    };
    let loadCalls = 0;
    const providerStore: ConversationStore = {
      list: () => Promise.resolve([summary]),
      load: () => Promise.resolve(loadCalls++ === 0 ? first : second),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    let latest: (UseConversationResult & UseConversationPersistenceState) | null = null;
    const Capture = (): null => {
      latest = useConversation("shared-id");
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ConversationsProvider store={providerStore} id="shared-id">
            <Capture />
          </ConversationsProvider>,
        )
      );
      await settle();
      assertEquals(latest!.conversation?.title, "First provider record");

      flushSync(() => latest!.reload());
      await settle();

      assertEquals(loadCalls, 2);
      assertEquals(latest!.conversation?.title, "Reloaded provider record");
    } finally {
      await unmountReactRoot(root);
      await settle();
      restoreDom();
    }
  });

  it("reports every provider-owned load attempt and clears the provider error", async () => {
    const restoreDom = installDom();
    const record = conversation("shared-id", "Provider record");
    const summary: ConversationSummary = {
      id: record.id,
      title: record.title,
      messageCount: 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const reusedFailure = new ConversationStoreError(
      "load",
      new Error("provider load unavailable"),
    );
    let loadCalls = 0;
    const providerStore: ConversationStore = {
      list: () => Promise.resolve([summary]),
      load: () => {
        loadCalls++;
        return Promise.reject(reusedFailure);
      },
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const reported: Error[] = [];
    let latest: (UseConversationResult & UseConversationPersistenceState) | null = null;
    const Capture = (): null => {
      latest = useConversation("shared-id", { onError: (error) => reported.push(error) });
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ConversationsProvider store={providerStore} id="shared-id">
            <Capture />
          </ConversationsProvider>,
        )
      );
      await settle();

      assertEquals(latest!.error, reusedFailure);
      assertEquals(reported, [reusedFailure]);

      flushSync(() => latest!.reload());
      await settle();
      assertEquals(loadCalls, 2);
      assertEquals(reported, [reusedFailure, reusedFailure]);

      flushSync(() => latest!.clearError());
      assertEquals(latest!.error, null);
    } finally {
      await unmountReactRoot(root);
      await settle();
      restoreDom();
    }
  });

  it("clears its provider load failure without erasing a newer unrelated provider error", async () => {
    const restoreDom = installDom();
    const active = conversation("active-id", "Active record");
    const other = conversation("other-id", "Other record");
    const summaries: ConversationSummary[] = [active, other].map((record) => ({
      id: record.id,
      title: record.title,
      messageCount: 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
    const loadFailure = new ConversationStoreError("load", new Error("load failed"));
    const deleteFailure = new ConversationStoreError("delete", new Error("delete failed"));
    const providerStore: ConversationStore = {
      list: () => Promise.resolve(summaries),
      load: () => Promise.reject(loadFailure),
      save: () => Promise.resolve(),
      delete: () => Promise.reject(deleteFailure),
    };
    let latest: (UseConversationResult & UseConversationPersistenceState) | null = null;
    let provider: ConversationsContextValue | null = null;
    const Capture = (): null => {
      latest = useConversation("active-id");
      provider = useConversationsContext();
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <ConversationsProvider store={providerStore} id="active-id">
            <Capture />
          </ConversationsProvider>,
        )
      );
      await settle();
      assertEquals(latest!.error, loadFailure);

      flushSync(() => provider!.remove("other-id"));
      await settle();
      assertEquals(provider!.error, deleteFailure);
      assertEquals(latest!.error, loadFailure);

      flushSync(() => latest!.clearError());
      assertEquals(latest!.error, null);
      assertEquals(provider!.error, deleteFailure);
    } finally {
      await unmountReactRoot(root);
      await settle();
      restoreDom();
    }
  });

  it("settles loading and exposes a rejected load", async () => {
    const restoreDom = installDom();
    const failure = new Error("load unavailable");
    const reported: Error[] = [];
    const store: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => Promise.reject(failure),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, "a", (error) => reported.push(error));
      await settle();

      assertEquals(view.get().conversation, null);
      assertEquals(view.get().isLoading, false);
      assertEquals(persistenceError(view.get())?.cause, failure);
      assertEquals(reported, [persistenceError(view.get())]);
      flushSync(() => view.get().clearError());
      assertEquals(persistenceError(view.get()), null);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("reports a throwing error callback without replacing the load failure", async () => {
    const restoreDom = installDom();
    const previousReportError =
      (globalThis as { reportError?: (error: unknown) => void }).reportError;
    const loadFailure = new Error("load unavailable");
    const callbackFailure = new Error("consumer callback failed");
    const callbackErrors: unknown[] = [];
    (globalThis as { reportError?: (error: unknown) => void }).reportError = (cause) => {
      callbackErrors.push(cause);
    };
    const store: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => Promise.reject(loadFailure),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, "a", () => {
        throw callbackFailure;
      });
      await settle();

      assertEquals(persistenceError(view.get())?.cause, loadFailure);
      assertEquals(callbackErrors, [callbackFailure]);

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

  it("consumes a load rejection after unmount", async () => {
    const restoreDom = installDom();
    let rejectLoad: ((reason: unknown) => void) | undefined;
    const store: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, "a");
      await Promise.resolve();
      assert(rejectLoad);
      await unmountReactRoot(view.root);
      rejectLoad(new Error("late load failure"));
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("consumes a stale rejection without replacing the latest load", async () => {
    const restoreDom = installDom();
    let resolveB: ((value: Conversation | null) => void) | undefined;
    let rejectA: ((reason: unknown) => void) | undefined;
    const store: ConversationStore = {
      list: () => Promise.resolve([]),
      load: (id) =>
        new Promise((resolve, reject) => {
          if (id === "a") rejectA = reject;
          else resolveB = resolve;
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(store, "a");
      await Promise.resolve();
      assert(rejectA);
      view.render("b");
      await Promise.resolve();
      assert(resolveB);
      resolveB(conversation("b", "Beta"));
      await settle();
      rejectA(new Error("stale failure"));
      await settle();

      assertEquals(view.get().conversation?.id, "b");
      assertEquals(view.get().isLoading, false);
      assertEquals(persistenceError(view.get()), null);

      await unmountReactRoot(view.root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("makes callbacks retained from an old store scope inert", async () => {
    const restoreDom = installDom();
    let firstLoads = 0;
    let secondLoads = 0;
    const first: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => {
        firstLoads += 1;
        return Promise.resolve(conversation("a", "First"));
      },
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const second: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => {
        secondLoads += 1;
        return Promise.resolve(conversation("a", "Second"));
      },
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    try {
      const view = mount(first, "a");
      await settle();
      const retained = view.get();

      view.render("a", second);
      await settle();
      assertEquals(view.get().conversation?.title, "Second");
      assertEquals([firstLoads, secondLoads], [1, 1]);

      flushSync(() => {
        retained.reload();
        retained.clearError();
      });
      await settle();
      assertEquals([firstLoads, secondLoads], [1, 1]);

      await unmountReactRoot(view.root);
      retained.reload();
      retained.clearError();
      await settle();
      assertEquals([firstLoads, secondLoads], [1, 1]);
    } finally {
      restoreDom();
    }
  });

  it("leaves injected store disposal to the caller across handoff and unmount", async () => {
    const restoreDom = installDom();
    let firstDisposals = 0;
    let secondDisposals = 0;
    const first: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => Promise.resolve(conversation("a", "First")),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      dispose: () => {
        firstDisposals += 1;
      },
    };
    const second: ConversationStore = {
      list: () => Promise.resolve([]),
      load: () => Promise.resolve(conversation("a", "Second")),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      dispose: () => {
        secondDisposals += 1;
      },
    };
    try {
      const view = mount(first, "a");
      await settle();

      view.render("a", second);
      await settle();
      assertEquals([firstDisposals, secondDisposals], [0, 0]);

      await unmountReactRoot(view.root);
      await settle();
      assertEquals([firstDisposals, secondDisposals], [0, 0]);
    } finally {
      restoreDom();
    }
  });
});
