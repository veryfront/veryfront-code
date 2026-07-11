import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for doctor server checks
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.ts";

async function withUnreachableFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("unreachable"))) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("doctor/server-checks", () => {
  describe("checkRSCFlag", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCFlag, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      const result = await checkRSCFlag();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "RSC Flag");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });
  });

  describe("checkRSCEndpoints", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCEndpoints, "function");
    });

    it("returns array of DiagnosticResult objects", async () => {
      // Note: This test will likely fail to connect since no server is running
      // The function should handle this gracefully with warnings
      const results = await checkRSCEndpoints();

      assertExists(results);
      assertEquals(Array.isArray(results), true);
      assertEquals(results.length > 0, true);

      // Each result should have required properties
      for (const result of results) {
        assertExists(result.name);
        assertExists(result.status);
        assertExists(result.message);
        assertEquals(["pass", "warn", "fail"].includes(result.status), true);
      }
    });

    it("handles unreachable server gracefully", async () => {
      const results = await withUnreachableFetch(() => checkRSCEndpoints());
      const hasWarning = results.some((r) => r.status === "warn");
      assertEquals(hasWarning, true);
    });

    it("uses the requested server port for every endpoint probe", async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = ((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        urls.push(url);

        const body = url.endsWith("/manifest")
          ? JSON.stringify({ hash: "test" })
          : url.endsWith("/_metrics")
          ? JSON.stringify({ counters: {} })
          : "ok";
        return Promise.resolve(new Response(body, { status: 200 }));
      }) as typeof fetch;

      try {
        await checkRSCEndpoints(4321);
        await checkRSCCounters(4321);
      } finally {
        globalThis.fetch = originalFetch;
      }

      assertEquals(urls, [
        "http://127.0.0.1:4321/_veryfront/rsc/manifest",
        "http://127.0.0.1:4321/_veryfront/rsc/stream",
        "http://127.0.0.1:4321/_metrics",
      ]);
    });
  });

  describe("checkRSCCounters", () => {
    it("is a function", () => {
      assertEquals(typeof checkRSCCounters, "function");
    });

    it("returns a DiagnosticResult object", async () => {
      // Note: This test will likely fail to connect since no server is running
      const result = await checkRSCCounters();

      assertExists(result);
      assertExists(result.name);
      assertExists(result.status);
      assertExists(result.message);
      assertEquals(result.name, "RSC Counters");
      assertEquals(["pass", "warn", "fail"].includes(result.status), true);
    });

    it("handles unreachable server gracefully", async () => {
      const result = await withUnreachableFetch(() => checkRSCCounters());
      assertEquals(["pass", "warn"].includes(result.status), true);
    });
  });
});
