import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ConversationsContextProvider,
  type ConversationsContextValue,
  ConversationsProvider,
  useConversationsContext,
  useConversationsContextOptional,
} from "./conversations-context.tsx";
import type { UseConversationsResult } from "../hooks/use-conversations.ts";
import type {
  Conversation,
  ConversationStore,
  ConversationSummary,
} from "../persistence/conversation-store.ts";

function noop(): void {}

const fakeResult: UseConversationsResult = {
  conversations: [],
  activeConversation: null,
  active: null,
  activeConversationId: null,
  activeId: null,
  isLoading: false,
  select: noop,
  create: () => ({
    id: "c-1",
    title: "New Chat",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  }),
  rename: noop,
  remove: noop,
  update: noop,
  save: noop,
  bind: noop,
};

describe("ConversationsContextProvider / useConversationsContext", () => {
  it("supplies the raw provider's value to a descendant", () => {
    function Consumer() {
      const ctx = useConversationsContext();
      return <div data-count={ctx.conversations.length} data-loading={String(ctx.isLoading)} />;
    }
    const html = renderToString(
      <ConversationsContextProvider value={fakeResult}>
        <Consumer />
      </ConversationsContextProvider>,
    );
    assertStringIncludes(html, 'data-count="0"');
    assertStringIncludes(html, 'data-loading="false"');
  });

  it("fails fast when used outside a ConversationsProvider", () => {
    function Orphan() {
      useConversationsContext();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useConversationsContext is a loud error, not silent");
  });

  it("useConversationsContextOptional returns null outside a provider, without throwing", () => {
    function OptionalConsumer() {
      const ctx = useConversationsContextOptional();
      return <div data-has-context={String(ctx !== null)} />;
    }
    const html = renderToString(<OptionalConsumer />);
    assertStringIncludes(html, 'data-has-context="false"');
  });
});

// Smoke test: the real component (not the raw provider) calls useConversations()
// itself and shares the live result. Under SSR no effect runs, so this only
// characterizes the synchronous first render — a fresh, still-loading result.
describe("ConversationsProvider — smoke test", () => {
  it("wires useConversations() and shares its result via context", () => {
    function Consumer() {
      const ctx = useConversationsContext();
      return (
        <div
          data-conversations={ctx.conversations.length}
          data-loading={String(ctx.isLoading)}
          data-active={String(ctx.activeConversation)}
        />
      );
    }
    const html = renderToString(
      <ConversationsProvider>
        <Consumer />
      </ConversationsProvider>,
    );
    assertStringIncludes(html, 'data-conversations="0"');
    assertStringIncludes(html, 'data-loading="true"');
    assertStringIncludes(html, 'data-active="null"');
  });
});

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

function summaryOf(record: Conversation): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    messageCount: record.messages.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

describe("ConversationsProvider — activeReady", () => {
  it("is false with no active id, false while the active record loads, true on match", async () => {
    const restoreDom = installDom();
    const recordA = conversation("a", "Alpha");
    const pendingLoads = new Map<string, (value: Conversation | null) => void>();
    const store: ConversationStore = {
      list: () => Promise.resolve([summaryOf(recordA)]),
      load: (id) =>
        new Promise((resolve) => {
          pendingLoads.set(id, resolve);
        }),
      save: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };

    let latest: ConversationsContextValue | null = null;
    let id: string | null = null;
    const Capture = (): null => {
      latest = useConversationsContext();
      return null;
    };
    const App = () => (
      <ConversationsProvider store={store} id={id}>
        <Capture />
      </ConversationsProvider>
    );
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<App />));
      await settle();
      assertEquals(latest!.activeId, null);
      assertEquals(latest!.activeReady, false, "no active id means not ready");

      id = "a";
      flushSync(() => root.render(<App />));
      await settle();
      assertEquals(latest!.activeId, "a");
      assertEquals(
        latest!.activeReady,
        false,
        "a still-loading active record is not ready",
      );

      pendingLoads.get("a")!(recordA);
      await settle();
      assertEquals(latest!.active?.id, "a");
      assertEquals(latest!.activeReady, true, "a matching active record is ready");

      id = "b";
      flushSync(() => root.render(<App />));
      await settle();
      assertEquals(latest!.activeId, "b");
      assertEquals(
        latest!.activeReady,
        false,
        "a mismatched active record is not ready",
      );

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });
});
