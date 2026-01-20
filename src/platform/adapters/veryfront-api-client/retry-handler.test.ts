import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { requestWithRetry } from "./retry-handler.ts";
import { VeryfrontAPIError } from "./types.ts";

describe("retry-handler", () => {
  describe("requestWithRetry", () => {
    it("should export requestWithRetry function", () => {
      assertExists(requestWithRetry);
      assertEquals(typeof requestWithRetry, "function");
    });

    describe("trace context propagation", () => {
      let originalFetch: typeof globalThis.fetch;
      let capturedHeaders: Headers | null = null;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
        capturedHeaders = null;
        globalThis.fetch = ((_url, init) => {
          capturedHeaders = init?.headers as Headers;
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should pass headers to fetch for trace context injection", async () => {
        await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 0, initialDelay: 100, maxDelay: 1000 },
        );

        assertExists(capturedHeaders, "Headers should be passed to fetch");
        assertEquals(capturedHeaders.get("Authorization"), "Bearer test-token");
        assertEquals(capturedHeaders.get("Content-Type"), "application/json");
      });
    });

    describe("4xx error handling - no retry", () => {
      let originalFetch: typeof globalThis.fetch;
      let fetchCallCount: number;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
        fetchCallCount = 0;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should NOT retry 401 errors - fail fast for auth failures", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
          );
        }) as typeof fetch;

        let caughtError: VeryfrontAPIError | null = null;
        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "invalid-token",
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          );
        } catch (e) {
          caughtError = e as VeryfrontAPIError;
        }

        assertExists(caughtError, "Should throw an error");
        assertEquals(fetchCallCount, 1, "Should only call fetch once - no retries for 401");
        assertEquals(caughtError.status, 401);
      });

      it("should NOT retry 403 errors", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
          );
        }) as typeof fetch;

        let caughtError: VeryfrontAPIError | null = null;
        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          );
        } catch (e) {
          caughtError = e as VeryfrontAPIError;
        }

        assertExists(caughtError, "Should throw an error");
        assertEquals(fetchCallCount, 1, "Should only call fetch once - no retries for 403");
        assertEquals(caughtError.status, 403);
      });

      it("should NOT retry 404 errors", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Not Found", { status: 404, statusText: "Not Found" }),
          );
        }) as typeof fetch;

        let caughtError: VeryfrontAPIError | null = null;
        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          );
        } catch (e) {
          caughtError = e as VeryfrontAPIError;
        }

        assertExists(caughtError, "Should throw an error");
        assertEquals(fetchCallCount, 1, "Should only call fetch once - no retries for 404");
        assertEquals(caughtError.status, 404);
      });

      it("should NOT retry 400 errors", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Bad Request", { status: 400, statusText: "Bad Request" }),
          );
        }) as typeof fetch;

        let caughtError: VeryfrontAPIError | null = null;
        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          );
        } catch (e) {
          caughtError = e as VeryfrontAPIError;
        }

        assertExists(caughtError, "Should throw an error");
        assertEquals(fetchCallCount, 1, "Should only call fetch once - no retries for 400");
        assertEquals(caughtError.status, 400);
      });
    });

    describe("429 rate limiting - should retry", () => {
      let originalFetch: typeof globalThis.fetch;
      let fetchCallCount: number;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
        fetchCallCount = 0;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should retry 429 errors with backoff", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 3, "Should retry 429 errors");
        assertEquals(result, { ok: true });
      });
    });

    describe("5xx server errors - should retry", () => {
      let originalFetch: typeof globalThis.fetch;
      let fetchCallCount: number;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
        fetchCallCount = 0;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should retry 500 errors with backoff", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 3, "Should retry 500 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 502 errors", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 502 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 503 errors", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 503 errors");
        assertEquals(result, { ok: true });
      });

      it("should fail after max retries exhausted", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
          );
        }) as typeof fetch;

        let caughtError: VeryfrontAPIError | null = null;
        try {
          await requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 2, initialDelay: 10, maxDelay: 100 },
          );
        } catch (e) {
          caughtError = e as VeryfrontAPIError;
        }

        assertExists(caughtError, "Should throw an error after retries exhausted");
        assertEquals(fetchCallCount, 3, "Should attempt 1 initial + 2 retries = 3 total");
      });
    });

    describe("network errors - should retry", () => {
      let originalFetch: typeof globalThis.fetch;
      let fetchCallCount: number;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
        fetchCallCount = 0;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should retry network failures", async () => {
        globalThis.fetch = (() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.reject(new Error("Network error"));
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry network errors");
        assertEquals(result, { ok: true });
      });
    });

    describe("successful requests", () => {
      let originalFetch: typeof globalThis.fetch;

      beforeEach(() => {
        originalFetch = globalThis.fetch;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      it("should return JSON response on success", async () => {
        globalThis.fetch = (() => {
          return Promise.resolve(
            new Response(JSON.stringify({ data: "test" }), { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
        );

        assertEquals(result, { data: "test" });
      });

      it("should return text response when returnText option is true", async () => {
        globalThis.fetch = (() => {
          return Promise.resolve(
            new Response("plain text response", { status: 200 }),
          );
        }) as typeof fetch;

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          { returnText: true },
        );

        assertEquals(result, "plain text response");
      });
    });
  });
});
