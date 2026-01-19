import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { requestWithRetry } from "./retry-handler.ts";

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
        // injectContext adds traceparent header when OTEL is active
        // In tests without OTEL init, it's a no-op, but Headers object is used
      });
    });
  });
});
