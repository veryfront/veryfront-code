import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { TokenStorageApiClient } from "./api-client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { VeryfrontTokenConfig } from "./types.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

function createConfig(overrides: Partial<VeryfrontTokenConfig> = {}): VeryfrontTokenConfig {
  return {
    apiBaseUrl: "https://api.example.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    retry: { maxRetries: 0, initialDelay: 10, maxDelay: 50 },
    timeoutMs: 1000,
    ...overrides,
  };
}

function createUnreachableConfig(): VeryfrontTokenConfig {
  return createConfig({ apiBaseUrl: "http://127.0.0.1:19999" });
}

describe("platform/adapters/token/veryfront/api-client", () => {
  describe("cleanup observability", () => {
    it("does not swallow failed response body cancellation without debug logging", async () => {
      const contents = await Deno.readTextFile(
        "src/platform/adapters/token/veryfront/api-client.ts",
      );

      assertEquals(
        contents.includes("response.body?.cancel().catch(() => {})"),
        false,
        "non-OK response cleanup should not use an empty catch",
      );
      assertEquals(
        contents.includes("cancelResponseBody"),
        true,
        "non-OK response cleanup should go through the shared debug-logging helper",
      );
    });
  });

  describe("constructor", () => {
    it("should create client with valid config", () => {
      const client = new TokenStorageApiClient(createConfig());
      assertExists(client);
    });

    it("enforces retry policy for direct client construction", () => {
      assertThrows(
        () =>
          new TokenStorageApiClient(
            createConfig({
              retry: { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
            }),
          ),
        RangeError,
        "maxRetries",
      );
      assertExists(
        new TokenStorageApiClient(
          createConfig({
            retry: {
              maxRetries: MAX_VERYFRONT_API_RETRIES,
              initialDelay: 0,
              maxDelay: 0,
            },
          }),
        ),
      );
    });
  });

  describe("get", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      await assertRejects(
        () => client.get("test-key"),
        VeryfrontError,
      );
    });

    it("validates successful response payloads", async () => {
      installMockFetch(() => Promise.resolve(Response.json({ value: 42 })));

      try {
        const client = new TokenStorageApiClient(createConfig());
        await assertRejects(
          () => client.get("test-key"),
          VeryfrontError,
          "Malformed get response",
        );
      } finally {
        restoreMockFetch();
      }
    });
  });

  describe("set", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      await assertRejects(
        () => client.set("test-key", "test-value"),
        VeryfrontError,
      );
    });
  });

  describe("delete", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      await assertRejects(
        () => client.delete("test-key"),
        VeryfrontError,
      );
    });
  });

  describe("list", () => {
    it("should throw VeryfrontError when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      await assertRejects(
        () => client.list(),
        VeryfrontError,
      );
    });

    it("should throw VeryfrontError with prefix when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      await assertRejects(
        () => client.list("user:"),
        VeryfrontError,
      );
    });

    it("validates the returned key array", async () => {
      installMockFetch(() => Promise.resolve(Response.json({ keys: ["valid", 42] })));

      try {
        const client = new TokenStorageApiClient(createConfig());
        await assertRejects(
          () => client.list(),
          VeryfrontError,
          "Malformed list response",
        );
      } finally {
        restoreMockFetch();
      }
    });
  });

  describe("ping", () => {
    it("should return false when API is unreachable", async () => {
      const client = new TokenStorageApiClient(createUnreachableConfig());
      const result = await client.ping();
      assertEquals(result, false);
    });
  });

  describe("request and response lifecycle", () => {
    it("preserves configured base paths for every endpoint", async () => {
      const requests: string[] = [];
      installMockFetch(
        ((url: RequestInfo | URL, init?: RequestInit) => {
          requests.push(String(url));
          if (init?.method === "PUT" || init?.method === "DELETE") {
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          if (String(url).endsWith("/tokens")) {
            return Promise.resolve(Response.json({ keys: [] }));
          }
          return Promise.resolve(Response.json({ value: "encrypted" }));
        }) as typeof fetch,
      );

      try {
        const client = new TokenStorageApiClient(createConfig({
          apiBaseUrl: "https://api.example.com/control/",
        }));
        await client.get("user/key");
        await client.set("user/key", "encrypted");
        await client.delete("user/key");
        await client.list();

        assertEquals(requests, [
          "https://api.example.com/control/v1/projects/test-project/tokens/user%2Fkey",
          "https://api.example.com/control/v1/projects/test-project/tokens/user%2Fkey",
          "https://api.example.com/control/v1/projects/test-project/tokens/user%2Fkey",
          "https://api.example.com/control/v1/projects/test-project/tokens",
        ]);
      } finally {
        restoreMockFetch();
      }
    });

    it("consumes successful and not-found response bodies before returning", async () => {
      const createdResponses = [
        new Response("missing", { status: 404 }),
        new Response("stored", { status: 200 }),
        new Response("already absent", { status: 404 }),
      ];
      const responses = [...createdResponses];
      installMockFetch(() => Promise.resolve(responses.shift()!));

      try {
        const client = new TokenStorageApiClient(createConfig());
        assertEquals(await client.get("missing"), null);
        await client.set("key", "value");
        await client.delete("missing");

        assertEquals(responses.length, 0);
        assertEquals(createdResponses.every((response) => response.bodyUsed), true);
      } finally {
        restoreMockFetch();
      }
    });

    it("rejects empty keys at the client boundary before fetching", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(Response.json({ value: "unexpected" }));
        }) as typeof fetch,
      );

      try {
        const client = new TokenStorageApiClient(createConfig());
        await assertRejects(() => client.get(""), TypeError, "non-empty");
        assertEquals(fetchCalls, 0);
      } finally {
        restoreMockFetch();
      }
    });

    it("bounds and cancels oversized successful response bodies", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      });
      installMockFetch(() => Promise.resolve(new Response(body)));

      try {
        const client = new TokenStorageApiClient(createConfig());
        await assertRejects(
          () => client.get("key"),
          VeryfrontError,
          "exceeds 1048576 bytes",
        );
        assertEquals(cancelled, true);
      } finally {
        restoreMockFetch();
      }
    });

    it("retries rate-limited reads instead of failing the caller", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          if (fetchCalls === 1) {
            return Promise.resolve(new Response("slow down", { status: 429 }));
          }
          return Promise.resolve(Response.json({ value: "secret" }));
        }) as typeof fetch,
      );

      try {
        const client = new TokenStorageApiClient(createConfig({
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        }));
        assertEquals(
          await client.get("key"),
          "secret",
          "a 429 must be retried, not surfaced as a failed token read",
        );
        assertEquals(fetchCalls, 2, "the rate-limited attempt must be retried exactly once");
      } finally {
        restoreMockFetch();
      }
    });

    it("cancels the unread body of a retried server error", async () => {
      let cancelled = false;
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          if (fetchCalls === 1) {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(16));
              },
              cancel() {
                cancelled = true;
              },
            });
            return Promise.resolve(new Response(body, { status: 500 }));
          }
          return Promise.resolve(Response.json({ value: "ok" }));
        }) as typeof fetch,
      );

      try {
        const client = new TokenStorageApiClient(createConfig({
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        }));
        assertEquals(
          await client.get("key"),
          "ok",
          "the retried attempt must serve the caller",
        );
        assertEquals(
          cancelled,
          true,
          "a retried 5xx body must be cancelled so the connection is not held open",
        );
      } finally {
        restoreMockFetch();
      }
    });
  });
});
