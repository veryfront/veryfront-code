import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "jsdom";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useUploadsRegistry, type UseUploadsRegistryResult } from "./use-uploads-registry.ts";

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

/** Stub fetch: POST → an upload response; DELETE → ok. Records DELETE ids. */
function stubFetch(): { deletes: string[]; restore: () => void } {
  const previous = globalThis.fetch;
  const deletes: string[] = [];
  let counter = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      counter += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: `srv-${counter}`,
            url: `/api/uploads?id=srv-${counter}`,
            name: `file-${counter}.txt`,
            size: 10,
            mediaType: "text/plain",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (method === "DELETE") {
      deletes.push(new URL(url, "https://example.com").searchParams.get("id") ?? "");
      return Promise.resolve(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return {
    deletes,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}

function mount(storageKey: string) {
  let latest: UseUploadsRegistryResult | null = null;
  function Capture(): null {
    latest = useUploadsRegistry({ storageKey });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  // `flushSync` renders + runs effects synchronously. React 19 schedules
  // passive effects on `MessageChannel`, which JSDOM never delivers, so plain
  // `setTimeout` ticks never flush them — `flushSync` is what makes the hook's
  // persist-to-localStorage effect actually run.
  flushSync(() => root.render(<Capture />));
  return { root, get: () => latest! };
}

/** Run an async interaction, then flush the resulting render + passive effects. */
async function flush(fn: () => void): Promise<void> {
  fn();
  // Let the stubbed fetch promise chain settle so its setState is queued...
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  // ...then force React to flush that update and its passive effects.
  flushSync(() => {});
}

function fakeFile(name: string): File {
  return new File(["1234567890"], name, { type: "text/plain" });
}

describe("react/components/chat/hooks/useUploadsRegistry", () => {
  it("uploads a file, captures the server id, and persists it", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const key = "test-uploads";
      const a = mount(key);

      await flush(() => a.get().upload([fakeFile("a.txt")]));

      const items = a.get().items;
      assertEquals(items.length, 1);
      assertEquals(items[0]!.id, "srv-1", "the server id is captured (needed for DELETE)");
      assertEquals(items[0]!.type, "text/plain");
      assert((localStorage.getItem(key) ?? "").includes("srv-1"), "persisted to localStorage");
      flushSync(() => a.root.unmount());

      // Remount → the item is loaded back from localStorage.
      const b = mount(key);
      assertEquals(b.get().items.map((f) => f.id), ["srv-1"]);
      flushSync(() => b.root.unmount());
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("remove() deletes from storage and drops the item", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const reg = mount("test-uploads-del");
      await flush(() => reg.get().upload([fakeFile("a.txt")]));
      assertEquals(reg.get().items.length, 1);
      const id = reg.get().items[0]!.id;

      await reg.get().remove(id);
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
      flushSync(() => {});

      assert(fetchStub.deletes.includes(id), "a DELETE was sent for the removed id");
      assertEquals(reg.get().items.length, 0, "the item is gone from the registry");
      flushSync(() => reg.root.unmount());
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });
});
