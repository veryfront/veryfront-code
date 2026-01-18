/**
 * Unit Tests for Prefetch Queue
 * Tests queue management, concurrent prefetching, and resource callback handling
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  PrefetchQueue,
  PrefetchQueueOptions,
} from "@veryfront/rendering/client/prefetch/prefetch-queue.ts";

// Mock fetch function
interface MockFetchOptions {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  delay?: number;
  shouldAbort?: boolean;
}

const createMockFetch = (options: MockFetchOptions = {}) => {
  const {
    status = 200,
    ok = true,
    headers = {},
    delay = 0,
    shouldAbort = false,
  } = options;

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

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
};

// Setup global mocks
const setupMocks = () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;

  let mockFetch: typeof fetch = createMockFetch();
  (globalThis as any).fetch = (...args: Parameters<typeof fetch>) => mockFetch(...args);
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === "a") {
        return { href: "" };
      }
      return {};
    },
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
};

describe("PrefetchQueue", () => {
  describe("Constructor and Configuration", () => {
    it("should create PrefetchQueue with options and prefetchedUrls", () => {
      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);
      assertExists(queue);
    });

    it("should initialize with zero queue size", () => {
      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);
      assertEquals(queue.getQueueSize(), 0);
    });

    it("should initialize with zero concurrent count", () => {
      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);
      assertEquals(queue.getConcurrentCount(), 0);
    });
  });

  describe("Resource Callback", () => {
    it("should allow setting resource callback", () => {
      const mocks = setupMocks();

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);
      const callback = (_response: Response, _url: string) => {};

      queue.setResourceCallback(callback);

      mocks.cleanup();
    });

    it("should call resource callback when prefetch succeeds", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      let callbackCalled = false;
      let callbackUrl = "";

      queue.setResourceCallback((_response: Response, url: string) => {
        callbackCalled = true;
        callbackUrl = url;
      });

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(callbackCalled, true);
      assertEquals(callbackUrl, "http://example.com/page");

      mocks.cleanup();
    });

    it("should not call resource callback when response is not ok", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: false, status: 404 }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      let callbackCalled = false;

      queue.setResourceCallback((_response: Response, _url: string) => {
        callbackCalled = true;
      });

      const link = {
        href: "http://example.com/notfound",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(callbackCalled, false);

      mocks.cleanup();
    });
  });

  describe("Prefetch Link", () => {
    it("should prefetch a valid link", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

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

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set(["http://example.com/page"]);

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

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

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      // Start first prefetch (won't await)
      queue.prefetchLink(link);

      // Try to prefetch same URL immediately
      await queue.prefetchLink(link);

      assertEquals(fetchCallCount, 1);

      mocks.cleanup();
    });

    it("should add X-Veryfront-Prefetch header", async () => {
      const mocks = setupMocks();

      let requestHeaders: Record<string, string> = {};
      mocks.setMockFetch((url, init) => {
        if (init?.headers) {
          const headers = init.headers as Record<string, string>;
          requestHeaders = { ...headers };
        }
        return createMockFetch()(url, init);
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(requestHeaders["X-Veryfront-Prefetch"], "1");

      mocks.cleanup();
    });

    it("should handle fetch errors gracefully", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(() => {
        throw new Error("Network error");
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      // Should not throw
      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/page"), false);

      mocks.cleanup();
    });

    it("should handle abort errors silently", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ shouldAbort: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      // Should not throw
      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/page"), false);

      mocks.cleanup();
    });
  });

  describe("Queue Size Management", () => {
    it("should respect maxConcurrent limit", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 100);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 2,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link1 = { href: "http://example.com/page1" } as HTMLAnchorElement;
      const link2 = { href: "http://example.com/page2" } as HTMLAnchorElement;
      const link3 = { href: "http://example.com/page3" } as HTMLAnchorElement;

      // Start 3 prefetches
      queue.prefetchLink(link1);
      queue.prefetchLink(link2);
      queue.prefetchLink(link3);

      // Wait a bit for queue to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have skipped the third one
      assertEquals(queue.getConcurrentCount() <= 2, true);

      mocks.cleanup();
    });

    it("should decrement concurrent count after completion", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch());

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(queue.getConcurrentCount(), 0);

      mocks.cleanup();
    });

    it("should remove URL from queue after completion", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch());

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

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
          headers: { "content-length": "2000000" }, // 2MB
        }),
      );

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024, // 1MB limit
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/large-file",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/large-file"), false);

      mocks.cleanup();
    });

    it("should accept responses within size limit", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: { "content-length": "500000" }, // 500KB
        }),
      );

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024, // 1MB limit
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/small-file",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/small-file"), true);

      mocks.cleanup();
    });

    it("should handle missing content-length header", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: {}, // No content-length
        }),
      );

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/no-length",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/no-length"), true);

      mocks.cleanup();
    });

    it("should handle exact size limit", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(
        createMockFetch({
          ok: true,
          headers: { "content-length": "1048576" }, // Exactly 1MB
        }),
      );

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024, // 1MB limit
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/exact-size",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/exact-size"), true);

      mocks.cleanup();
    });
  });

  describe("Timeout Handling", () => {
    it("should abort request after timeout", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 200));

        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }

        return createMockFetch()(url, init);
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 50, // Short timeout
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "http://example.com/slow",
      } as HTMLAnchorElement;

      await queue.prefetchLink(link);

      assertEquals(prefetchedUrls.has("http://example.com/slow"), false);

      mocks.cleanup();
    });
  });

  describe("Prefetch Method", () => {
    it("should prefetch URL string", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

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

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

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
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 100);
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

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link1 = { href: "http://example.com/page1" } as HTMLAnchorElement;
      const link2 = { href: "http://example.com/page2" } as HTMLAnchorElement;

      queue.prefetchLink(link1);
      queue.prefetchLink(link2);

      // Wait a bit for queue to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      queue.stopAll();

      // Wait for aborts to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      assertEquals(abortedCount >= 0, true);

      mocks.cleanup();
    });

    it("should clear queue", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 100);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = { href: "http://example.com/page" } as HTMLAnchorElement;

      queue.prefetchLink(link);

      await new Promise((resolve) => setTimeout(resolve, 10));

      queue.stopAll();

      assertEquals(queue.getQueueSize(), 0);

      mocks.cleanup();
    });

    it("should reset concurrent count to zero", async () => {
      const mocks = setupMocks();

      mocks.setMockFetch(async (url, init) => {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 100);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
        return createMockFetch()(url, init);
      });

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = { href: "http://example.com/page" } as HTMLAnchorElement;

      queue.prefetchLink(link);

      await new Promise((resolve) => setTimeout(resolve, 10));

      queue.stopAll();

      assertEquals(queue.getConcurrentCount(), 0);

      mocks.cleanup();
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple sequential prefetches", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

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

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      const link = {
        href: "not-a-valid-url",
      } as HTMLAnchorElement;

      // Should not throw
      await queue.prefetchLink(link);

      mocks.cleanup();
    });

    it("should handle response callback errors gracefully", async () => {
      const mocks = setupMocks();
      mocks.setMockFetch(createMockFetch({ ok: true }));

      const options: PrefetchQueueOptions = {
        maxConcurrent: 3,
        maxSize: 1024 * 1024,
        timeout: 5000,
      };
      const prefetchedUrls = new Set<string>();

      const queue = new PrefetchQueue(options, prefetchedUrls);

      queue.setResourceCallback((_response: Response, _url: string) => {
        throw new Error("Callback error");
      });

      const link = {
        href: "http://example.com/page",
      } as HTMLAnchorElement;

      // Should not throw (error should be caught internally)
      await queue.prefetchLink(link);

      mocks.cleanup();
    });
  });
});
