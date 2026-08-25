import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { VeryfrontTokenAdapter } from "./adapter.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

describe("platform/adapters/token/veryfront/adapter", () => {
  function createConfig(overrides: Record<string, unknown> = {}) {
    return {
      type: "veryfront-api" as const,
      veryfront: {
        apiToken: "test-token",
        projectSlug: "test-project",
        apiBaseUrl: "http://localhost:9999",
        retry: { maxRetries: 0, initialDelay: 10, maxDelay: 50 },
        ...overrides,
      },
    };
  }

  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      assertEquals(typeof adapter, "object");
    });

    it("enforces retry policy at adapter construction", () => {
      for (
        const retry of [
          { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
          { maxRetries: 0, initialDelay: Number.NaN, maxDelay: 0 },
          { maxRetries: 0, initialDelay: 2, maxDelay: 1 },
        ]
      ) {
        assertThrows(
          () => new VeryfrontTokenAdapter(createConfig({ retry })),
          RangeError,
        );
      }

      const adapter = new VeryfrontTokenAdapter(
        createConfig({
          retry: {
            maxRetries: MAX_VERYFRONT_API_RETRIES,
            initialDelay: 0,
            maxDelay: 0,
          },
        }),
      );
      assertEquals(typeof adapter, "object");
    });
  });

  describe("initialize", () => {
    it("should throw when API is unreachable", async () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      await assertRejects(
        () => adapter.initialize(),
        VeryfrontError,
      );
    });

    it("coalesces concurrent connection checks", async () => {
      let requests = 0;
      installMockFetch(() => {
        requests++;
        return Promise.resolve(Response.json({ keys: [] }));
      });

      try {
        const adapter = new VeryfrontTokenAdapter(createConfig({
          apiBaseUrl: "https://api.example.com",
        }));
        await Promise.all([
          adapter.initialize(),
          adapter.initialize(),
          adapter.initialize(),
        ]);
        assertEquals(requests, 1);
      } finally {
        restoreMockFetch();
      }
    });

    it("does not let a late connection check resurrect a disposed adapter", async () => {
      let resolveResponse: ((response: Response) => void) | undefined;
      installMockFetch(() =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
      );

      try {
        const adapter = new VeryfrontTokenAdapter(createConfig({
          apiBaseUrl: "https://api.example.com",
        }));
        const initialization = adapter.initialize();
        await Promise.resolve();
        adapter.dispose();
        resolveResponse?.(Response.json({ keys: [] }));

        await assertRejects(
          () => initialization,
          DOMException,
          "invalidated",
        );

        let retries = 0;
        installMockFetch(() => {
          retries++;
          return Promise.resolve(Response.json({ keys: [] }));
        });
        await adapter.initialize();
        assertEquals(retries, 1);
      } finally {
        restoreMockFetch();
      }
    });
  });

  describe("dispose", () => {
    it("should not throw", () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      adapter.dispose();
    });

    it("should allow re-initialization attempt after dispose", async () => {
      const adapter = new VeryfrontTokenAdapter(createConfig());
      adapter.dispose();
      // Should attempt to re-init (will fail since API is unreachable)
      await assertRejects(() => adapter.initialize(), VeryfrontError);
    });

    it("clears the initialized flag so a disposed adapter re-pings the API", async () => {
      let requests = 0;
      installMockFetch(() => {
        requests++;
        return Promise.resolve(Response.json({ keys: [] }));
      });

      try {
        const adapter = new VeryfrontTokenAdapter(createConfig({
          apiBaseUrl: "https://api.example.com",
        }));
        await adapter.initialize();
        assertEquals(requests, 1, "the first initialize must ping the API");

        adapter.dispose();
        await adapter.initialize();
        assertEquals(
          requests,
          2,
          "dispose must clear the initialized flag so the next initialize re-pings the API",
        );
      } finally {
        restoreMockFetch();
      }
    });
  });
});
