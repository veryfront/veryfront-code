import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { requestWithRetry } from "./retry-handler.ts";
import { VeryfrontAPIError } from "./types.ts";

const originalFetch = globalThis.fetch;

function setFetch(
  handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

async function captureVeryfrontError(
  fn: () => Promise<unknown>,
): Promise<VeryfrontAPIError> {
  try {
    await fn();
  } catch (e) {
    return e as VeryfrontAPIError;
  }
  throw new Error("Expected function to throw");
}

describe("retry-handler", () => {
  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  describe("requestWithRetry", () => {
    it("should export requestWithRetry function", (): void => {
      assertExists(requestWithRetry);
      assertEquals(typeof requestWithRetry, "function");
    });

    describe("trace context propagation", () => {
      let capturedHeaders: Headers | undefined;

      beforeEach((): void => {
        capturedHeaders = undefined;
        setFetch((_url, init) => {
          capturedHeaders = init?.headers as Headers | undefined;
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });
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
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      async function expectNoRetry(
        status: number,
        statusText: string,
        body: string,
        token: string,
      ): Promise<void> {
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(new Response(body, { status, statusText }));
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            token,
            { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
          )
        );

        assertEquals(fetchCallCount, 1, `Should only call fetch once - no retries for ${status}`);
        assertEquals(error.status, status);
      }

      it("should NOT retry 401 errors - fail fast for auth failures", async () => {
        await expectNoRetry(401, "Unauthorized", "Unauthorized", "invalid-token");
      });

      it("should NOT retry 403 errors", async () => {
        await expectNoRetry(403, "Forbidden", "Forbidden", "test-token");
      });

      it("should NOT retry 404 errors", async () => {
        await expectNoRetry(404, "Not Found", "Not Found", "test-token");
      });

      it("should NOT retry 400 errors", async () => {
        await expectNoRetry(400, "Bad Request", "Bad Request", "test-token");
      });
    });

    describe("429 rate limiting - should retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry 429 errors with backoff", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Too Many Requests", {
                status: 429,
                statusText: "Too Many Requests",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

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
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry 500 errors with backoff", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            return Promise.resolve(
              new Response("Internal Server Error", {
                status: 500,
                statusText: "Internal Server Error",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 3, "Should retry 500 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 502 errors", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 502 errors");
        assertEquals(result, { ok: true });
      });

      it("should retry 503 errors", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) {
            return Promise.resolve(
              new Response("Service Unavailable", {
                status: 503,
                statusText: "Service Unavailable",
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 10, maxDelay: 100 },
        );

        assertEquals(fetchCallCount, 2, "Should retry 503 errors");
        assertEquals(result, { ok: true });
      });

      it("should fail after max retries exhausted", async () => {
        setFetch(() => {
          fetchCallCount++;
          return Promise.resolve(
            new Response("Internal Server Error", {
              status: 500,
              statusText: "Internal Server Error",
            }),
          );
        });

        const error = await captureVeryfrontError(() =>
          requestWithRetry(
            "https://api.test.com/endpoint",
            "test-token",
            { maxRetries: 2, initialDelay: 10, maxDelay: 100 },
          )
        );

        assertExists(error, "Should throw an error after retries exhausted");
        assertEquals(fetchCallCount, 3, "Should attempt 1 initial + 2 retries = 3 total");
      });
    });

    describe("network errors - should retry", () => {
      let fetchCallCount = 0;

      beforeEach((): void => {
        fetchCallCount = 0;
      });

      it("should retry network failures", async () => {
        setFetch(() => {
          fetchCallCount++;
          if (fetchCallCount < 2) return Promise.reject(new Error("Network error"));
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );
        });

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
      it("should return JSON response on success", async () => {
        setFetch(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: "test" }), { status: 200 }),
          )
        );

        const result = await requestWithRetry(
          "https://api.test.com/endpoint",
          "test-token",
          { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
        );

        assertEquals(result, { data: "test" });
      });

      it("should return text response when returnText option is true", async () => {
        setFetch(() => Promise.resolve(new Response("plain text response", { status: 200 })));

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
