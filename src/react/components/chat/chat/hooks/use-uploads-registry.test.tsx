import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { useAttachments } from "./use-uploads-registry.ts";

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
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    localStorage: window.localStorage,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  assert(globalThis.localStorage === window.localStorage);
  window.localStorage.clear();
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

/** Stub fetch: POST → an upload response; DELETE → configured status. Records DELETE ids. */
function stubFetch(
  options: { deleteStatus?: number } = {},
): { deletes: string[]; deleteUrls: string[]; gets: string[]; restore: () => void } {
  const previous = globalThis.fetch;
  const deletes: string[] = [];
  const deleteUrls: string[] = [];
  const gets: string[] = [];
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
      deleteUrls.push(url);
      deletes.push(new URL(url, "https://example.com").searchParams.get("id") ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ deleted: options.deleteStatus === undefined }), {
          status: options.deleteStatus ?? 200,
        }),
      );
    }
    gets.push(url);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return {
    deletes,
    deleteUrls,
    gets,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}

function mount(storageKey: string) {
  let latest: ReturnType<typeof useAttachments> | null = null;
  function Capture(): null {
    latest = useAttachments({ storageKey });
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

function mountOptions(
  options: Parameters<typeof useAttachments>[0],
) {
  let latest: ReturnType<typeof useAttachments> | null = null;
  function Capture(props: Parameters<typeof useAttachments>[0]): null {
    latest = useAttachments(props);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture {...options} />));
  return {
    root,
    get: () => latest!,
    render: (next: Parameters<typeof useAttachments>[0]) => {
      flushSync(() => root.render(<Capture {...next} />));
    },
  };
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

describe("react/components/chat/hooks/useAttachments", () => {
  it("keeps the canonical result interface structurally source-compatible", () => {
    const result = {
      items: [],
      isLoading: false,
      isUploading: false,
      uploadError: null,
      clearUploadError: () => undefined,
      storageError: null,
      clearStorageError: () => undefined,
      refreshError: null,
      clearRefreshError: () => undefined,
      removeError: null,
      clearRemoveError: () => undefined,
      upload: () => undefined,
      add: () => undefined,
      remove: () => Promise.resolve(),
      clear: () => undefined,
      refresh: () => Promise.resolve(),
    } satisfies ReturnType<typeof useAttachments>;
    assertEquals(result.items, []);
  });

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
      await unmountReactRoot(a.root);
      await flush(() => {});

      // Remount → the item is loaded back from localStorage.
      const b = mount(key);
      assertEquals(b.get().items.map((f) => f.id), ["srv-1"]);
      await unmountReactRoot(b.root);
      await flush(() => {});
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("is loading until the initial list fetch resolves", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const reg = mount("test-uploads-loading");
      // The mount effect fired the GET but its promise hasn't settled yet.
      assertEquals(reg.get().isLoading, true, "loading immediately after mount");
      await flush(() => {});
      assertEquals(reg.get().isLoading, false, "cleared once the initial fetch resolves");
      await unmountReactRoot(reg.root);
      await flush(() => {});
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("does not refetch forever when headers are passed inline", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      let latest: ReturnType<typeof useAttachments> | null = null;
      const Capture = (): null => {
        latest = useAttachments({
          storageKey: "test-inline-headers",
          headers: { authorization: "Bearer test" },
        });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));

      await flush(() => {});
      await flush(() => {});

      assertEquals((latest as unknown as ReturnType<typeof useAttachments>).isLoading, false);
      assertEquals(fetchStub.gets.length, 1, "inline headers should not retrigger refresh");
      await unmountReactRoot(root);
      await flush(() => {});
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("does not let a superseded endpoint refresh overwrite the current list", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending = new Map<string, {
      resolve: (response: Response) => void;
      signal?: AbortSignal | null;
    }>();
    globalThis.fetch =
      ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.set(String(input), { resolve, signal: init?.signal });
        })) as typeof fetch;

    let latest: ReturnType<typeof useAttachments> | null = null;
    const Capture = ({ url }: { url: string }): null => {
      latest = useAttachments({ storageKey: "test-endpoint-switch", url });
      return null;
    };
    const root = createRoot(document.getElementById("root")!);

    try {
      flushSync(() => root.render(<Capture url="/old" />));
      assert(pending.has("/old"));

      flushSync(() => root.render(<Capture url="/new" />));
      assert(pending.has("/new"));
      assertEquals(pending.get("/old")?.signal?.aborted, true);

      pending.get("/new")?.resolve(
        Response.json({
          items: [{ id: "new", name: "new.txt", mediaType: "text/plain" }],
        }),
      );
      await flush(() => {});
      assertEquals(
        (latest as unknown as ReturnType<typeof useAttachments>).items.map((item) => item.id),
        ["new"],
      );

      // A transport that ignores abort can still resolve late. Generation
      // ownership must prevent that stale body from replacing `/new`.
      pending.get("/old")?.resolve(
        Response.json({
          items: [{ id: "old", name: "old.txt", mediaType: "text/plain" }],
        }),
      );
      await flush(() => {});
      assertEquals(
        (latest as unknown as ReturnType<typeof useAttachments>).items.map((item) => item.id),
        ["new"],
      );

      await unmountReactRoot(root);
      await flush(() => {});
    } finally {
      globalThis.fetch = previousFetch;
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
      await unmountReactRoot(reg.root);
      await flush(() => {});
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });
  it("remove() replaces an endpoint id without disturbing other query state", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const reg = mountOptions({
        storageKey: "test-delete-query",
        url: "/api/uploads?source=panel&id=stale#details",
      });
      await flush(() => {});
      flushSync(() =>
        reg.get().add({
          id: "current",
          name: "current.txt",
          url: "/uploads/current",
        })
      );

      await reg.get().remove("current");
      await flush(() => {});

      assertEquals(
        fetchStub.deleteUrls.at(-1),
        "/api/uploads?source=panel&id=current#details",
      );
      assertEquals(reg.get().items, []);
      await unmountReactRoot(reg.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("remove() keeps the item when server cleanup is incomplete", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch({ deleteStatus: 502 });
    try {
      const reg = mount("test-uploads-del-retry");
      await flush(() => reg.get().upload([fakeFile("a.txt")]));
      const id = reg.get().items[0]!.id;

      await reg.get().remove(id);
      await flush(() => {});

      assert(fetchStub.deletes.includes(id), "a DELETE was attempted");
      assertEquals(reg.get().items.map((item) => item.id), [id]);
      assert(reg.get().removeError instanceof Error);
      flushSync(() => reg.get().clearRemoveError());
      assertEquals(reg.get().removeError, null);
      await unmountReactRoot(reg.root);
      await flush(() => {});
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("rejects malformed, oversized, and executable persisted registry data", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      localStorage.setItem(
        "test-invalid-cache",
        JSON.stringify([{
          id: "unsafe",
          name: "unsafe.html",
          url: "javascript:alert(1)",
        }]),
      );
      const invalid = mount("test-invalid-cache");
      assertEquals(invalid.get().items, []);
      assert(invalid.get().storageError instanceof Error);
      await unmountReactRoot(invalid.root);

      localStorage.setItem("test-oversized-cache", `"${"x".repeat(1_100_000)}"`);
      const oversized = mount("test-oversized-cache");
      assertEquals(oversized.get().items, []);
      assert(oversized.get().storageError instanceof Error);
      assertStringIncludes(
        oversized.get().storageError!.message,
        "exceeds",
        "an over-cap payload is rejected by the byte guard, not by its shape",
      );
      await unmountReactRoot(oversized.root);

      // A syntactically VALID registry that is simply too large: the shape
      // checks all pass, so only the byte cap can reject it.
      localStorage.setItem(
        "test-oversized-array-cache",
        JSON.stringify(
          Array.from({ length: 300 }, (_unused, index) => ({
            id: `i${index}`,
            name: "x".repeat(4_000),
            url: `/u/${index}`,
          })),
        ),
      );
      const oversizedArray = mount("test-oversized-array-cache");
      assertEquals(oversizedArray.get().items, []);
      assertStringIncludes(
        oversizedArray.get().storageError!.message,
        "exceeds",
        "a well-formed but over-cap registry array is rejected by the byte guard",
      );
      await unmountReactRoot(oversizedArray.root);

      // Small enough in bytes, but past the item cap.
      localStorage.setItem(
        "test-too-many-cache",
        JSON.stringify(
          Array.from({ length: 1_001 }, (_unused, index) => ({
            id: `i${index}`,
            name: "a.txt",
            url: `/u/${index}`,
          })),
        ),
      );
      const tooMany = mount("test-too-many-cache");
      assertEquals(tooMany.get().items, []);
      assertStringIncludes(
        tooMany.get().storageError!.message,
        "bounded array",
        "a registry past the item cap is rejected even when its bytes fit",
      );
      await unmountReactRoot(tooMany.root);

      localStorage.setItem(
        "test-duplicate-cache",
        JSON.stringify([
          { id: "same", name: "first.txt", url: "/uploads/first" },
          { id: "same", name: "second.txt", url: "/uploads/second" },
        ]),
      );
      const duplicate = mount("test-duplicate-cache");
      assertEquals(duplicate.get().items, []);
      assert(duplicate.get().storageError instanceof Error);
      await unmountReactRoot(duplicate.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("rejects executable URLs from list and upload responses", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          Response.json({
            id: "unsafe-upload",
            name: "unsafe.html",
            url: "data:text/html,<script>alert(1)</script>",
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          items: [{
            id: "unsafe-list",
            name: "unsafe.html",
            url: "javascript:alert(1)",
          }],
        }),
      );
    }) as typeof fetch;

    try {
      localStorage.setItem(
        "test-unsafe-server-url",
        JSON.stringify([{
          id: "cached",
          name: "cached.txt",
          url: "/uploads/cached",
        }]),
      );
      const reg = mount("test-unsafe-server-url");
      await flush(() => {});
      assertEquals(
        reg.get().items.map((item) => item.id),
        ["cached"],
        "an invalid list snapshot must not erase the validated cache",
      );

      await flush(() => reg.get().upload([fakeFile("unsafe.html")]));
      assertEquals(reg.get().items.map((item) => item.id), ["cached"]);
      assert(reg.get().uploadError instanceof Error);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("rejects invalid UTF-8 list responses without replacing the cache", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const invalidResponse = new Uint8Array([
      ...encoder.encode('{"items":[{"id":"server","name":"'),
      0xff,
      ...encoder.encode('","url":"/uploads/server"}]}'),
    ]);
    globalThis.fetch =
      (() => Promise.resolve(new Response(invalidResponse.slice()))) as typeof fetch;

    try {
      localStorage.setItem(
        "test-invalid-utf8-response",
        JSON.stringify([{
          id: "cached",
          name: "cached.txt",
          url: "/uploads/cached",
        }]),
      );
      const reg = mount("test-invalid-utf8-response");
      await flush(() => {});

      assertEquals(reg.get().items.map((item) => item.id), ["cached"]);
      assert(reg.get().refreshError instanceof Error);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("surfaces failed and duplicate refreshes without erasing the cache", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    let response = new Response("unavailable", { status: 503 });
    globalThis.fetch = (() => Promise.resolve(response.clone())) as typeof fetch;

    try {
      localStorage.setItem(
        "test-refresh-errors",
        JSON.stringify([{
          id: "cached",
          name: "cached.txt",
          url: "/uploads/cached",
        }]),
      );
      const reg = mount("test-refresh-errors");
      await flush(() => {});
      assertEquals(reg.get().items.map((item) => item.id), ["cached"]);
      assert(reg.get().refreshError instanceof Error);

      flushSync(() => reg.get().clearRefreshError());
      assertEquals(reg.get().refreshError, null);
      response = Response.json({
        items: [
          { id: "same", name: "first.txt", url: "/uploads/first" },
          { id: "same", name: "second.txt", url: "/uploads/second" },
        ],
      });
      await reg.get().refresh();
      await flush(() => {});

      assertEquals(
        reg.get().items.map((item) => item.id),
        ["cached"],
        "an ambiguous snapshot must not replace the validated cache",
      );
      assert(reg.get().refreshError instanceof Error);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("rejects a declared oversized list response before parsing it", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('{"items":[]}', {
          headers: { "content-length": String(9 * 1024 * 1024) },
        }),
      )) as typeof fetch;

    try {
      const reg = mount("test-oversized-response");
      await flush(() => {});
      assertEquals(reg.get().items, []);
      assert(reg.get().refreshError instanceof Error);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("rejects a declared oversized upload response", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          new Response('{"id":"x"}', {
            headers: { "content-length": String(70_000) },
          }),
        );
      }
      return Promise.resolve(Response.json({ items: [] }));
    }) as typeof fetch;

    try {
      const reg = mount("test-oversized-upload-response");
      await flush(() => {});
      await flush(() => reg.get().upload([fakeFile("a.txt")]));
      assertEquals(
        reg.get().items,
        [],
        "an oversized upload response must not add an item",
      );
      assert(reg.get().uploadError instanceof Error, "the upload failure is published");
      assertStringIncludes(
        reg.get().uploadError!.message,
        "exceeds 65536 bytes",
        "the upload response bound is reported",
      );
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("rejects a streamed upload response that crosses the bound mid-read", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        // No content-length, so the header pre-check is skipped and the
        // byte accumulation branch (plus reader.cancel()) is what rejects it.
        const chunk = new Uint8Array(10_000);
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (let i = 0; i < 7; i += 1) controller.enqueue(chunk);
                controller.close();
              },
            }),
          ),
        );
      }
      return Promise.resolve(Response.json({ items: [] }));
    }) as typeof fetch;

    try {
      const reg = mount("test-streamed-upload-response");
      await flush(() => {});
      await flush(() => reg.get().upload([fakeFile("a.txt")]));
      assertEquals(
        reg.get().items,
        [],
        "a streamed over-cap upload response must not add an item",
      );
      assert(reg.get().uploadError instanceof Error, "the upload failure is published");
      assertStringIncludes(
        reg.get().uploadError!.message,
        "exceeds 65536 bytes",
        "the bound is enforced while the body streams, not only from its header",
      );
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("surfaces localStorage write failures instead of reporting false persistence", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const reg = mount("test-storage-failure");
      await flush(() => {});

      const storage = globalThis.localStorage;
      const storagePrototype = Object.getPrototypeOf(storage) as Storage;
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        storagePrototype,
        "setItem",
      );
      Object.defineProperty(storagePrototype, "setItem", {
        configurable: true,
        value: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });

      await flush(() =>
        reg.get().add({
          id: "stored",
          name: "stored.txt",
          url: "/api/uploads?id=stored",
        })
      );
      assert(reg.get().storageError instanceof Error);
      assertEquals(reg.get().items.map((item) => item.id), ["stored"]);

      flushSync(() => reg.get().clearStorageError());
      assertEquals(reg.get().storageError, null);
      if (originalDescriptor) {
        Object.defineProperty(storagePrototype, "setItem", originalDescriptor);
      }
      await unmountReactRoot(reg.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("reports an oversized registry instead of attempting an unbounded cache write", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      const key = "test-oversized-write";
      const reg = mount(key);
      await flush(() => {});

      flushSync(() => {
        for (let index = 0; index < 260; index += 1) {
          reg.get().add({
            id: `large-${index}`,
            name: `${index}-${"x".repeat(4_080)}`,
            url: `/uploads/${index}`,
          });
        }
      });
      await flush(() => {});

      assertEquals(reg.get().items.length, 260);
      assert(reg.get().storageError instanceof Error);
      assertEquals(
        localStorage.getItem(key),
        null,
        "the oversized payload must not be handed to localStorage",
      );
      await unmountReactRoot(reg.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("aborts an upload on endpoint switch and ignores a transport that completes late", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending: Array<{
      method: string;
      url: string;
      signal?: AbortSignal | null;
      resolve: (response: Response) => void;
    }> = [];
    globalThis.fetch =
      ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({
            method: init?.method ?? "GET",
            url: String(input),
            signal: init?.signal,
            resolve,
          });
        })) as typeof fetch;

    try {
      const reg = mountOptions({
        storageKey: "test-stale-upload",
        url: "/old",
      });
      const oldGet = pending.find((request) => request.url === "/old" && request.method === "GET");
      assert(oldGet);
      oldGet.resolve(Response.json({ items: [] }));
      await flush(() => {});

      flushSync(() => reg.get().upload([fakeFile("old.txt")]));
      const oldPost = pending.find(
        (request) => request.url === "/old" && request.method === "POST",
      );
      assert(oldPost);

      reg.render({ storageKey: "test-stale-upload", url: "/new" });
      assertEquals(oldPost.signal?.aborted, true);
      const newGet = pending.find((request) => request.url === "/new" && request.method === "GET");
      assert(newGet);
      newGet.resolve(Response.json({ items: [] }));
      await flush(() => {});

      oldPost.resolve(
        Response.json({
          id: "stale",
          name: "stale.txt",
          url: "/old?id=stale",
        }),
      );
      await flush(() => {});
      assertEquals(reg.get().items, []);
      assertEquals(reg.get().uploadError, null);
      assertEquals(reg.get().isUploading, false);

      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("does not let a stale delete remove the current endpoint's item", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending: Array<{
      method: string;
      url: string;
      signal?: AbortSignal | null;
      resolve: (response: Response) => void;
    }> = [];
    globalThis.fetch =
      ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({
            method: init?.method ?? "GET",
            url: String(input),
            signal: init?.signal,
            resolve,
          });
        })) as typeof fetch;

    try {
      const reg = mountOptions({ storageKey: "test-stale-delete", url: "/old" });
      pending.find((request) => request.url === "/old" && request.method === "GET")?.resolve(
        Response.json({ items: [{ id: "same", name: "old.txt" }] }),
      );
      await flush(() => {});

      const removal = reg.get().remove("same");
      const oldDelete = pending.find((request) =>
        request.url.startsWith("/old?") && request.method === "DELETE"
      );
      assert(oldDelete);

      reg.render({ storageKey: "test-stale-delete", url: "/new" });
      assertEquals(oldDelete.signal?.aborted, true);
      pending.find((request) => request.url === "/new" && request.method === "GET")?.resolve(
        Response.json({ items: [{ id: "same", name: "current.txt" }] }),
      );
      await flush(() => {});

      oldDelete.resolve(Response.json({ deleted: true }));
      await removal;
      await flush(() => {});
      assertEquals(reg.get().items.map((item) => item.name), ["current.txt"]);

      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("latest refresh wins even when the endpoint identity is unchanged", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending: Array<{
      signal?: AbortSignal | null;
      resolve: (response: Response) => void;
    }> = [];
    globalThis.fetch =
      ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({ signal: init?.signal, resolve });
        })) as typeof fetch;

    try {
      const reg = mountOptions({ storageKey: "test-latest-refresh", url: "/uploads" });
      assertEquals(pending.length, 1);
      const first = pending[0]!;

      const secondPromise = reg.get().refresh();
      assertEquals(first.signal?.aborted, true);
      const second = pending[1]!;
      second.resolve(Response.json({ items: [{ id: "new", name: "new.txt" }] }));
      await secondPromise;
      await flush(() => {});

      first.resolve(Response.json({ items: [{ id: "old", name: "old.txt" }] }));
      await flush(() => {});
      assertEquals(reg.get().items.map((item) => item.id), ["new"]);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("follows bounded list pagination before publishing server truth", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const offset = Number(
        new URL(url, "https://example.com").searchParams.get("offset") ?? "0",
      );
      return Promise.resolve(
        Response.json(
          offset === 0
            ? {
              items: [{ id: "newest", name: "newest.txt" }],
              offset: 0,
              limit: 1,
              hasMore: true,
            }
            : {
              items: [{ id: "older", name: "older.txt" }],
              offset: 1,
              limit: 1,
              hasMore: false,
            },
        ),
      );
    }) as typeof fetch;

    try {
      const reg = mountOptions({
        storageKey: "test-paginated-refresh",
        url: "/uploads?scope=rag",
      });
      await flush(() => {});

      assertEquals(requested, [
        "/uploads?scope=rag",
        "/uploads?scope=rag&limit=1&offset=1",
      ]);
      assertEquals(
        reg.get().items.map((item) => item.id),
        ["newest", "older"],
      );
      assertEquals(reg.get().refreshError, null);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("rejects pagination loops without issuing unbounded requests", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return Promise.resolve(
        Response.json({
          items: [{ id: `item-${requested.length}`, name: "item.txt" }],
          offset: 0,
          limit: 1,
          hasMore: true,
        }),
      );
    }) as typeof fetch;

    try {
      localStorage.setItem(
        "test-pagination-loop",
        JSON.stringify([{ id: "cached", name: "cached.txt" }]),
      );
      const reg = mountOptions({
        storageKey: "test-pagination-loop",
        url: "/uploads",
      });
      await flush(() => {});

      assertEquals(requested, [
        "/uploads",
        "/uploads?limit=1&offset=1",
      ]);
      assertEquals(reg.get().items.map((item) => item.id), ["cached"]);
      assert(reg.get().refreshError instanceof Error);
      await unmountReactRoot(reg.root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("loads a changed storage key without copying the previous cache into it", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      localStorage.setItem(
        "test-cache-a",
        JSON.stringify([{ id: "a", name: "a.txt", url: "/uploads/a" }]),
      );
      localStorage.setItem(
        "test-cache-b",
        JSON.stringify([{ id: "b", name: "b.txt", url: "/uploads/b" }]),
      );
      const reg = mountOptions({ storageKey: "test-cache-a" });
      assertEquals(reg.get().items.map((item) => item.id), ["a"]);

      reg.render({ storageKey: "test-cache-b" });
      await flush(() => {});
      assertEquals(reg.get().items.map((item) => item.id), ["b"]);
      assertEquals(
        JSON.parse(localStorage.getItem("test-cache-b") ?? "[]").map(
          (item: { id: string }) => item.id,
        ),
        ["b"],
      );
      await unmountReactRoot(reg.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("makes retained cache commands inert after a storage-scope handoff", async () => {
    const restoreDom = installDom();
    const fetchStub = stubFetch();
    try {
      localStorage.setItem(
        "test-retained-cache-a",
        JSON.stringify([{ id: "a", name: "a.txt", url: "/uploads/a" }]),
      );
      localStorage.setItem(
        "test-retained-cache-b",
        JSON.stringify([{ id: "b", name: "b.txt", url: "/uploads/b" }]),
      );
      const reg = mountOptions({ storageKey: "test-retained-cache-a" });
      const retained = reg.get();

      reg.render({ storageKey: "test-retained-cache-b" });
      await flush(() => {});
      flushSync(() => {
        retained.add({ id: "stale", name: "stale.txt", url: "/uploads/stale" });
        retained.clear();
      });

      assertEquals(reg.get().items.map((item) => item.id), ["b"]);
      await unmountReactRoot(reg.root);
    } finally {
      fetchStub.restore();
      restoreDom();
    }
  });

  it("aborts every fetch owner on unmount and consumes late rejections", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending: Array<{
      signal?: AbortSignal | null;
      reject: (error: Error) => void;
    }> = [];
    globalThis.fetch =
      ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          pending.push({ signal: init?.signal, reject });
        })) as typeof fetch;

    try {
      const reg = mountOptions({ storageKey: "test-unmount", url: "/uploads" });
      flushSync(() =>
        reg.get().add({
          id: "existing",
          name: "existing.txt",
          url: "/uploads/existing",
        })
      );
      const removal = reg.get().remove("existing");
      flushSync(() => reg.get().upload([fakeFile("upload.txt")]));
      assertEquals(pending.length, 3, "GET, DELETE, and POST are all pending");

      const retained = reg.get();
      await unmountReactRoot(reg.root);
      assert(
        pending.every((request) => request.signal?.aborted),
        "all operation signals are aborted during cleanup",
      );
      retained.upload([fakeFile("retained.txt")]);
      retained.add({ id: "late", name: "late.txt", url: "/uploads/late" });
      retained.clear();
      retained.clearUploadError();
      retained.clearStorageError();
      retained.clearRefreshError();
      retained.clearRemoveError();
      await retained.remove("late");
      await retained.refresh();
      assertEquals(pending.length, 3, "retained callbacks must not start work after unmount");

      for (const request of pending) request.reject(new Error("late transport failure"));
      await removal;
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });

  it("an abandoned concurrent endpoint render cannot steal committed refresh ownership", async () => {
    const restoreDom = installDom();
    const previousFetch = globalThis.fetch;
    const pending: Array<{
      signal?: AbortSignal | null;
      resolve: (response: Response) => void;
    }> = [];
    globalThis.fetch =
      ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({ signal: init?.signal, resolve });
        })) as typeof fetch;
    let committed: ReturnType<typeof useAttachments> | null = null;
    let attemptedSuspendedRender = false;
    const never = new Promise<void>(() => undefined);

    try {
      const Capture = (
        { url, suspend = false }: { url: string; suspend?: boolean },
      ): null => {
        const result = useAttachments({
          storageKey: "test-abandoned-refresh",
          url,
        });
        React.useLayoutEffect(() => {
          committed = result;
        });
        if (suspend) {
          attemptedSuspendedRender = true;
          throw never;
        }
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() =>
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/committed" />
          </React.Suspense>,
        )
      );
      assertEquals(pending.length, 1);

      React.startTransition(() => {
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/abandoned" suspend />
          </React.Suspense>,
        );
      });
      await waitFor(() => attemptedSuspendedRender, {
        interval: 1,
        message: "Concurrent endpoint render did not start",
      });
      assertEquals(attemptedSuspendedRender, true);
      assertEquals(pending[0]?.signal?.aborted, false);
      assertEquals(pending.length, 1, "an uncommitted scope must not start a refresh");

      pending[0]?.resolve(
        Response.json({ items: [{ id: "committed", name: "committed.txt" }] }),
      );
      await flush(() => {});
      assertEquals(
        (committed as unknown as ReturnType<typeof useAttachments>).items.map(
          (item) => item.id,
        ),
        ["committed"],
      );

      flushSync(() =>
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/committed" />
          </React.Suspense>,
        )
      );
      await unmountReactRoot(root);
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });
});
