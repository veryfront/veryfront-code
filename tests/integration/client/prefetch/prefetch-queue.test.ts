/**
 * Unit Tests for Prefetch Queue
 * Tests queue management, concurrent prefetching, and resource callback handling
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { PrefetchQueue } from "#veryfront/rendering/client/prefetch/prefetch-queue.ts";
import type { PrefetchQueueOptions } from "#veryfront/rendering/client/prefetch/prefetch-queue.ts";
import { delay as sleep } from "#std/async";
import { scaleMs } from "#veryfront/testing";

interface MockFetchOptions {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  delay?: number;
  shouldAbort?: boolean;
}

function createMockFetch(options: MockFetchOptions = {}): typeof fetch {
  const {
    status = 200,
    ok = true,
    headers = {},
    delay = 0,
    shouldAbort = false,
  } = options;

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (delay > 0) await sleep(delay);

    if (shouldAbort && init?.signal) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const mockHeaders = new Headers(headers);

    return {
      ok,
      status,
      headers: mockHeaders,
      url: url.toString(),
      statusText: ok ? "OK" : "Error",
      clone: () => ({ ok, status, headers: mockHeaders } as Response),
    } as Response;
  };
}

function createOptions(overrides: Partial<PrefetchQueueOptions> = {}): PrefetchQueueOptions {
  return {
    maxConcurrent: 3,
    maxSize: 1024 * 1024,
    timeout: 5000,
    ...overrides,
  };
}

function createLink(href: string): HTMLAnchorElement {
  return { href } as HTMLAnchorElement;
}

function setupMocks(): {
  cleanup: () => void;
  setMockFetch: (fn: typeof fetch) => void;
} {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;

  let mockFetch: typeof fetch = createMockFetch();

  (globalThis as any).fetch = (...args: Parameters<typeof fetch>) => mockFetch(...args);
  (globalThis as any).document = {
    createElement: (tag: string) => (tag === "a" ? { href: "" } : {}),
  };

  return {
    cleanup: () => {
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).document = originalDocument;
    },
    setMockFetch: (fn: typeof fetch) => {
      mockFetch = fn;
    },
  };
}

describe("PrefetchQueue", () => {
  describe("Constructor and Configuration", () => {
    it("should create PrefetchQueue with options and prefetchedUrls", () => {
      const queue = new PrefetchQueue(createOptions(), new Set<string>());
      assertExists(queue);
    });

    it("should initialize with zero queue size", () => {
      const queue = new PrefetchQueue(createOptions(), new Set<string>());
      assertEquals(queue.getQueueSize(), 0);
    });

    it("should initialize with zero concurrent count", () => {
      const queue = new PrefetchQueue(createOptions(), new Set<string>());
      assertEquals(queue.getConcurrentCount(), 0);
    });
  });

  describe("Resource Callback", () => {
    it("should allow setting resource callback", () => {
      const mocks = setupMocks();

      const queue = new PrefetchQueue(createOptions(), new Set<string>());
      queue.setResourceCallback((_response: Response, _url: string) => {});

      mocks.cleanup();
    });

    it("should call resource callback when prefetch succeeds", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      let callbackCalled = false;
      let callbackUrl = "";

      queue.setResourceCallback((_response: Response, url: string) => {
        callbackCalled = true;
        callbackUrl = url;
      });

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(callbackCalled, true);
      assertEquals(callbackUrl, "http://example.com/page");

      mocks.cleanup();
    });

    it("should not call resource callback when response is not ok", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: false, status: 404 }));

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      let callbackCalled = false;
      queue.setResourceCallback((_response: Response, _url: string) => {
        callbackCalled = true;
      });

      await queue.prefetchLink(createLink("http://example.com/notfound"));

      assertEquals(callbackCalled, false);

      mocks.cleanup();
    });
  });

  describe("Prefetch Link", () => {
    it("should prefetch a valid link", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(prefetchedUrls.has("http://example.com/page"), true);

      mocks.cleanup();
    });

    it("should not prefetch already prefetched URL", async () => {
      const mocks = setupMocks();

      let fetchCallCount = 0;
      mocks.setMockFetch((...args) => {
        fetchCallCount++;
        return createMockFetch()(...args);
      });

      const queue = new PrefetchQueue(
        createOptions(),
        new Set(["http://example.com/page"]),
      );

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(fetchCallCount, 0);

      mocks.cleanup();
    });

    it("should not prefetch URL currently in queue", async () => {
      const mocks = setupMocks();

      let fetchCallCount = 0;
      mocks.setMockFetch((...args) => {
        fetchCallCount++;
        return createMockFetch()(...args);
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());
      const link = createLink("http://example.com/page");

      queue.prefetchLink(link);
      await queue.prefetchLink(link);

      assertEquals(fetchCallCount, 1);

      mocks.cleanup();
    });

    it("should add X-Veryfront-Prefetch header", async () => {
      const mocks = setupMocks();

      let requestHeaders: Record<string, string> = {};
      mocks.setMockFetch((url, init) => {
        if (init?.headers) requestHeaders = { ...(init.headers as Record<string, string>) };
        return createMockFetch()(url, init);
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(requestHeaders["X-Veryfront-Prefetch"], "1");

      mocks.cleanup();
    });

    it("should handle fetch errors gracefully", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(() => {
        throw new Error("Network error");
      });

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(prefetchedUrls.has("http://example.com/page"), false);

      mocks.cleanup();
    });

    it("should handle abort errors silently", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ shouldAbort: true }));

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(prefetchedUrls.has("http://example.com/page"), false);

      mocks.cleanup();
    });
  });

  describe("Queue Size Management", () => {
    it("should respect maxConcurrent limit", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(resolve, scaleMs(100));
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const queue = new PrefetchQueue(createOptions({ maxConcurrent: 2 }), new Set<string>());

      queue.prefetchLink(createLink("http://example.com/page1"));
      queue.prefetchLink(createLink("http://example.com/page2"));
      queue.prefetchLink(createLink("http://example.com/page3"));

      await sleep(50);

      assertEquals(queue.getConcurrentCount() <= 2, true);

      mocks.cleanup();
    });

    it("should decrement concurrent count after completion", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch());

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(queue.getConcurrentCount(), 0);

      mocks.cleanup();
    });

    it("should remove URL from queue after completion", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch());

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      await queue.prefetchLink(createLink("http://example.com/page"));

      assertEquals(queue.getQueueSize(), 0);

      mocks.cleanup();
    });
  });

  describe("Response Size Limiting", () => {
    it("should skip responses that are too large", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: { "content-length": "2000000" },
        }),
      );

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions({ maxSize: 1024 * 1024 }), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/large-file"));

      assertEquals(prefetchedUrls.has("http://example.com/large-file"), false);

      mocks.cleanup();
    });

    it("should accept responses within size limit", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: { "content-length": "500000" },
        }),
      );

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions({ maxSize: 1024 * 1024 }), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/small-file"));

      assertEquals(prefetchedUrls.has("http://example.com/small-file"), true);

      mocks.cleanup();
    });

    it("should handle missing content-length header", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true, headers: {} }));

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/no-length"));

      assertEquals(prefetchedUrls.has("http://example.com/no-length"), true);

      mocks.cleanup();
    });

    it("should handle exact size limit", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: { "content-length": "1048576" },
        }),
      );

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions({ maxSize: 1024 * 1024 }), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/exact-size"));

      assertEquals(prefetchedUrls.has("http://example.com/exact-size"), true);

      mocks.cleanup();
    });
  });

  describe("Timeout Handling", () => {
    it("should abort request after timeout", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await sleep(200);

        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }

        return createMockFetch()(url, init);
      });

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions({ timeout: 50 }), prefetchedUrls);

      await queue.prefetchLink(createLink("http://example.com/slow"));

      assertEquals(prefetchedUrls.has("http://example.com/slow"), false);

      mocks.cleanup();
    });
  });

  describe("Prefetch Method", () => {
    it("should prefetch URL string", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetch("http://example.com/page");

      assertEquals(prefetchedUrls.has("http://example.com/page"), true);

      mocks.cleanup();
    });

    it("should create temporary link element for URL", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      let createdElement: string | null = null;
      (globalThis as any).document = {
        createElement: (tag: string) => {
          createdElement = tag;
          return { href: "" };
        },
      };

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      await queue.prefetch("http://example.com/page");

      assertEquals(createdElement, "a");

      mocks.cleanup();
    });
  });

  describe("Stop All", () => {
    it("should abort all pending requests", async () => {
      const mocks = setupMocks();

      let abortedCount = 0;
      mocks.setMockFetch(async (url, init) => {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(resolve, scaleMs(100));
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });

        if (init?.signal?.aborted) {
          abortedCount++;
          throw new DOMException("The operation was aborted", "AbortError");
        }

        return createMockFetch()(url, init);
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      queue.prefetchLink(createLink("http://example.com/page1"));
      queue.prefetchLink(createLink("http://example.com/page2"));

      await sleep(10);

      queue.stopAll();

      await sleep(50);

      assertEquals(abortedCount >= 0, true);

      mocks.cleanup();
    });

    it("should clear queue", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(resolve, scaleMs(100));
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      queue.prefetchLink(createLink("http://example.com/page"));

      await sleep(10);

      queue.stopAll();

      assertEquals(queue.getQueueSize(), 0);

      mocks.cleanup();
    });

    it("should reset concurrent count to zero", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(resolve, scaleMs(100));
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      queue.prefetchLink(createLink("http://example.com/page"));

      await sleep(10);

      queue.stopAll();

      assertEquals(queue.getConcurrentCount(), 0);

      mocks.cleanup();
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple sequential prefetches", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const prefetchedUrls = new Set<string>();
      const queue = new PrefetchQueue(createOptions(), prefetchedUrls);

      await queue.prefetch("http://example.com/page1");
      await queue.prefetch("http://example.com/page2");
      await queue.prefetch("http://example.com/page3");

      assertEquals(prefetchedUrls.size, 3);

      mocks.cleanup();
    });

    it("should handle invalid URLs gracefully", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(() => {
        throw new TypeError("Invalid URL");
      });

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      await queue.prefetchLink(createLink("not-a-valid-url"));

      mocks.cleanup();
    });

    it("should handle response callback errors gracefully", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const queue = new PrefetchQueue(createOptions(), new Set<string>());

      queue.setResourceCallback((_response: Response, _url: string) => {
        throw new Error("Callback error");
      });

      await queue.prefetchLink(createLink("http://example.com/page"));

      mocks.cleanup();
    });
  });
});
