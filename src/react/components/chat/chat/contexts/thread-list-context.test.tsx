import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ThreadListContextValue,
  ThreadsProvider,
  useThreadListContext,
} from "./thread-list-context.tsx";

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

/** Mount a ThreadsProvider and expose the latest context value via the returned getter. */
function mountThreads(storageKey: string) {
  let latest: ThreadListContextValue | null = null;
  function Capture(): null {
    latest = useThreadListContext();
    return null;
  }
  const rootElement = document.getElementById("root")!;
  const root = createRoot(rootElement);
  flushSync(() => {
    root.render(
      <ThreadsProvider storageKey={storageKey}>
        <Capture />
      </ThreadsProvider>,
    );
  });
  return { root, get: () => latest! };
}

async function tick(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("react/components/chat/contexts/ThreadsProvider + agentId", () => {
  it("shares one thread store and round-trips agentId through localStorage", async () => {
    const restore = installDom();
    const key = "test-threads-agent";
    try {
      // Mount: the provider seeds one empty thread via effect.
      const first = mountThreads(key);
      await tick(0); // let the initial-thread effect run
      const ctx = first.get();
      assert(ctx.threads.length >= 1, "provider seeds a thread");

      const id = ctx.activeThread?.id ?? ctx.threads[0]!.id;
      flushSync(() => ctx.updateThread(id, { agentId: "sales-agent" }));

      // State reflects the agent immediately.
      assertEquals(first.get().activeThread?.agentId, "sales-agent");

      // Wait past the 300ms debounce so the write reaches localStorage, THEN unmount
      // (unmount cancels a still-pending debounced write).
      await tick(400);
      first.root.unmount();

      // Remount fresh (new store, same storageKey) → agentId loaded from localStorage.
      const second = mountThreads(key);
      await tick(0);
      const reloaded = second.get().threads.find((t) => t.id === id);
      assertEquals(reloaded?.agentId, "sales-agent");
      second.root.unmount();
    } finally {
      restore();
    }
  });
});
